/**
 * The engine: the one object the CLI and the agent loop talk to.
 *
 * It owns the store, the sandbox backend, the policy engine and the set of live
 * containers. Nothing above it needs to know how any of those work — which is
 * what allows the agent loop to be written against a small, honest surface
 * instead of against the filesystem.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SandboxBackend, SandboxCapabilityReport } from '@plif/sandbox';
import { selectBackend } from '@plif/sandbox';

import { AuditLog } from '../audit/log.js';
import { PlifError } from '../errors.js';
import { EventBus } from '../events/bus.js';
import { layerFromDirectory } from '../fs/overlay.js';
import { QuestionBroker } from '../harness/ask.js';
import { MemoryStore } from '../harness/memory.js';
import { ApprovalBroker } from '../policy/approval.js';
import { DEVELOPER_POLICY, PolicyEngine } from '../policy/policy.js';
import type { PolicyDocument } from '../policy/policy.js';
import { SessionStore } from '../session/store.js';
import { ContentStore } from '../store/content.js';
import { ImageStore, LayerStore } from '../store/images.js';
import { StorePaths } from '../store/paths.js';
import { DEFAULT_CAPABILITIES } from '../types.js';
import type { CapabilitySet, ContainerSpec, Image, Ref } from '../types.js';
import { Container } from './container.js';
import type { ContainerDeps } from './container.js';
import { generateName, isValidName } from './names.js';

/**
 * Where the store lives when nothing overrides it.
 *
 * Global rather than per-project, for two reasons: layers deduplicate across
 * repositories (six projects on the same toolchain store it once), and nobody
 * wants a `.plif` directory appearing in every repo they touch. Sessions are
 * still scoped per workspace — see `SessionStore`.
 */
export function defaultRoot(): string {
  const home = os.homedir();
  return path.join(home, '.plif');
}

export interface EngineOptions {
  /** Plif root. Defaults to `~/.plif`. */
  readonly root?: string;
  readonly policy?: PolicyDocument;
  /** Override backend selection. Tests use this; production should not. */
  readonly backend?: SandboxBackend;
  /** How long an approval prompt waits before denying. */
  readonly approvalTimeoutMs?: number;
  /** Ceiling on simultaneously running containers. */
  readonly maxContainers?: number;
}

export class Engine {
  readonly paths: StorePaths;
  readonly bus: EventBus;
  readonly content: ContentStore;
  readonly layers: LayerStore;
  readonly images: ImageStore;
  readonly sessions: SessionStore;
  readonly audit: AuditLog;
  readonly approvals: ApprovalBroker;
  /** The agent asking the human for information, as opposed to permission. */
  readonly questions: QuestionBroker;
  readonly memory: MemoryStore;
  readonly policy: PolicyEngine;

  #backend: SandboxBackend | null = null;
  #report: SandboxCapabilityReport | null = null;
  #containers = new Map<string, Container>();
  #options: EngineOptions;
  #started = false;

  constructor(options: EngineOptions = {}) {
    this.#options = options;
    this.paths = new StorePaths(options.root ?? defaultRoot());
    this.bus = new EventBus();
    this.content = new ContentStore(this.paths);
    this.layers = new LayerStore(this.paths);
    this.images = new ImageStore(this.paths);
    this.sessions = new SessionStore(this.paths);
    this.audit = new AuditLog(this.paths);
    this.approvals = new ApprovalBroker(this.bus, options.approvalTimeoutMs);
    this.questions = new QuestionBroker(this.bus);
    this.memory = new MemoryStore(this.paths);
    this.policy = new PolicyEngine(options.policy ?? DEVELOPER_POLICY);
  }

  /** Create the store layout, pick a backend, and report what it can enforce. */
  async start(): Promise<SandboxCapabilityReport> {
    if (this.#started && this.#report) return this.#report;

    // Independent directories, so they are created together rather than in a
    // serial chain of round trips to the filesystem.
    await Promise.all(
      this.paths.bootstrapDirs().map((dir) => fs.mkdir(dir, { recursive: true })),
    );
    await this.audit.open();

    if (this.#options.backend) {
      this.#backend = this.#options.backend;
      this.#report = await this.#backend.probe();
    } else {
      const selection = await selectBackend();
      this.#backend = selection.backend;
      this.#report = selection.report;
      for (const { id, reason } of selection.rejected) {
        this.bus.emit('log', {
          level: 'warn',
          message: `sandbox backend "${id}" was rejected`,
          detail: { reason },
        });
      }
    }

    this.#started = true;
    this.bus.emit('engine.ready', { root: this.paths.root, sandbox: this.#report });
    return this.#report;
  }

  get sandboxReport(): SandboxCapabilityReport {
    if (!this.#report) {
      throw new PlifError('INTERNAL', 'engine.start() has not been called');
    }
    return this.#report;
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  /**
   * Build the image every workspace container starts from: an empty tree with
   * the standard directories, no network, no host writes.
   */
  async ensureBaseImage(reference = 'plif/base:0.1'): Promise<Image> {
    // Deliberately rebuilt every time rather than returned from cache.
    //
    // Returning the tagged image if it existed meant that changing this
    // definition had no effect on any machine that had already run once — the
    // capability ceiling below was raised and the store kept handing out the
    // old one, so a fixed bug stayed broken and the store was the only place
    // that said why. Building is cheap and idempotent: the scaffold is three
    // directories and one file, blobs deduplicate, and the image digest is
    // derived from the content, so an unchanged definition re-resolves to the
    // exact same image without writing anything new.
    const scratchRoot = path.join(this.paths.root, 'temp', 'base-images');
    await fs.mkdir(scratchRoot, { recursive: true });
    const scaffold = await fs.mkdtemp(path.join(scratchRoot, 'base-'));
    try {
      const directories = ['tmp', 'cache'];
      if (process.platform === 'linux') {
        directories.push('usr', 'proc', 'dev', 'etc', 'project');
      }
      for (const dir of directories) {
        await fs.mkdir(path.join(scaffold, dir), { recursive: true });
      }
      if (process.platform === 'linux') {
        await Promise.all([
          fs.symlink('usr/bin', path.join(scaffold, 'bin')),
          fs.symlink('usr/lib', path.join(scaffold, 'lib')),
          fs.symlink('usr/lib64', path.join(scaffold, 'lib64')),
          fs.symlink('usr/sbin', path.join(scaffold, 'sbin')),
        ]);
      }

      const layer = await layerFromDirectory(this.content, this.layers, {
        source: scaffold,
        name: 'base-scaffold',
        mountAt: '/',
      });

      return await this.images.build({
        reference,
        layers: [layer.digest],
        config: {
          workdir: '/',
          env: {},
          entrypoint: [],
          // The image capability set is a *ceiling*, not a default. Container
          // specs intersect with it (`base && override`), so anything false
          // here can never be granted by any container built from this image —
          // which previously made `--write` silently impossible, because the
          // base image withheld hostWrite and the intersection always won.
          //
          // Callers are expected to pass an explicit, narrower set. `Engine.run`
          // below refuses to widen anything they leave out.
          capabilities: {
            fsRead: true,
            fsWrite: true,
            exec: true,
            envRead: true,
            hostWrite: true,
            network: true,
            spawnContainers: true,
          },
        },
        labels: { 'plif.builtin': 'true' },
      });
    } finally {
      await fs.rm(scaffold, { recursive: true, force: true });
    }
  }

  /** Snapshot a host directory into a new image. This is `plif build`. */
  async buildImage(options: {
    readonly reference: string;
    readonly source: string;
    readonly mountAt?: string;
    readonly from?: string;
    readonly exclude?: readonly string[];
  }): Promise<Image> {
    const base = options.from ? await this.images.require(options.from) : await this.ensureBaseImage();

    const layer = await layerFromDirectory(this.content, this.layers, {
      source: options.source,
      name: path.basename(path.resolve(options.source)),
      mountAt: options.mountAt ?? '/',
      exclude: options.exclude ?? ['node_modules', '.git', 'dist', '.plif', '.next', 'target'],
    });

    return await this.images.build({
      reference: options.reference,
      layers: [...base.layers, layer.digest],
      config: base.config,
      labels: { ...base.labels, 'plif.source': path.resolve(options.source) },
    });
  }

  // -------------------------------------------------------------------------
  // Containers
  // -------------------------------------------------------------------------

  async create(spec: Omit<ContainerSpec, 'name'> & { name?: string }): Promise<Container> {
    if (!this.#backend) await this.start();

    const max = this.#options.maxContainers ?? 16;
    const live = [...this.#containers.values()].filter(
      (container) => container.state === 'running',
    );
    if (live.length >= max) {
      throw new PlifError(
        'CONTAINER_LIMIT_REACHED',
        `already running ${live.length} containers (limit ${max})`,
        {
          detail: { running: live.map((c) => c.name) },
          hint: 'Stop a container, or raise maxContainers when constructing the engine.',
        },
      );
    }

    const taken = new Set([...this.#containers.values()].map((container) => container.name));
    const name = spec.name ?? generateName(taken);

    if (!isValidName(name)) {
      throw new PlifError(
        'INVALID_ARGUMENT',
        `"${name}" is not a valid container name`,
        {
          detail: { name },
          hint: 'Use lowercase letters, digits, hyphens and underscores; start with a letter or digit.',
        },
      );
    }
    if (taken.has(name)) {
      throw new PlifError('CONTAINER_EXISTS', `a container named "${name}" already exists`, {
        detail: { name },
      });
    }

    const image = await this.images.require(spec.image);
    const id = randomUUID().replace(/-/g, '').slice(0, 12);

    // The image grants a ceiling; this decides what is actually asked for.
    //
    // Always resolve to a *complete* set, starting from the restrictive
    // defaults, so that omitting a capability means "withheld" rather than
    // "inherit whatever the image allows". Without this, raising the image
    // ceiling to make `--write` possible would silently hand host-write to
    // every container that forgot to mention it.
    const capabilities: CapabilitySet = { ...DEFAULT_CAPABILITIES, ...spec.capabilities };
    const fullSpec: ContainerSpec = { ...spec, name, capabilities };
    await fs.mkdir(this.paths.container(id), { recursive: true });
    await fs.writeFile(
      this.paths.containerSpec(id),
      JSON.stringify({ id, ...fullSpec }, null, 2),
      'utf8',
    );

    const deps: ContainerDeps = {
      paths: this.paths,
      content: this.content,
      layers: this.layers,
      images: this.images,
      backend: this.#backend as SandboxBackend,
      bus: this.bus,
      audit: this.audit,
      approvals: this.approvals,
      policy: this.policy,
    };

    const container = new Container(id, fullSpec, image, deps);
    this.#containers.set(id, container);

    await this.audit.append('container.create', id, {
      name,
      image: image.reference,
      capabilities: container.capabilities,
      limits: container.limits,
    });
    return container;
  }

  /** Create and start in one step — what the CLI's `run` does. */
  async run(spec: Omit<ContainerSpec, 'name'> & { name?: string }): Promise<Container> {
    const container = await this.create(spec);
    await container.start();
    return container;
  }

  /** Look up by name, full id, or unambiguous id prefix. */
  get(ref: Ref): Container | null {
    const direct = this.#containers.get(ref);
    if (direct) return direct;

    const byName = [...this.#containers.values()].find((container) => container.name === ref);
    if (byName) return byName;

    const prefixed = [...this.#containers.values()].filter((container) =>
      container.id.startsWith(ref),
    );
    if (prefixed.length === 1) return prefixed[0] ?? null;
    if (prefixed.length > 1) {
      throw new PlifError('INVALID_ARGUMENT', `"${ref}" matches ${prefixed.length} containers`, {
        detail: { candidates: prefixed.map((c) => c.name) },
      });
    }
    return null;
  }

  require(ref: Ref): Container {
    const container = this.get(ref);
    if (!container) {
      throw new PlifError('CONTAINER_NOT_FOUND', `no container matches "${ref}"`, {
        detail: { ref },
        hint: 'Run `plif ps` to list containers.',
      });
    }
    return container;
  }

  list(): Container[] {
    return [...this.#containers.values()].filter((container) => container.state !== 'removed');
  }

  async remove(ref: Ref): Promise<void> {
    const container = this.require(ref);
    await container.remove();
    this.#containers.delete(container.id);
  }

  /**
   * Stop everything and flush the audit log.
   *
   * Must be safe to call twice and from a signal handler — that is precisely
   * when it matters, and a shutdown path that throws leaves orphaned jails.
   */
  async shutdown(reason = 'engine shutdown'): Promise<void> {
    this.approvals.denyAll(reason);
    this.questions.abandonAll();
    await Promise.allSettled(
      [...this.#containers.values()]
        .filter((container) => container.state === 'running')
        .map((container) => container.stop(reason)),
    );
    await this.audit.flush();
    this.bus.removeAll();
    this.#started = false;
  }
}
