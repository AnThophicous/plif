/**
 * A running container.
 *
 * This is where the layers meet: the path jail decides *where* an operation
 * lands, the policy engine decides *whether* it happens, the sandbox jail
 * decides *how confined* it is while it runs, and the audit log records that it
 * did. Every one of those is mandatory — there is no code path in this class
 * that touches the filesystem or spawns a process without passing all four.
 *
 * The invariant to preserve when editing: **no public method reaches the
 * filesystem or the sandbox without going through `#authorize` first.** If you
 * add a method that does, you have added a hole.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { SandboxBackend, SandboxJail, TerminalSignal } from '@plif/sandbox';
import { isolationAtLeast } from '@plif/sandbox';

import type { AuditLog } from '../audit/log.js';
import {
  normalizeEnvironmentMap,
  normalizeEnvironmentNames,
  type EnvironmentMap,
  type EnvironmentNameSelection,
  type SessionEnvironmentScope,
  type SessionEnvironmentStatus,
  type SessionEnvironmentStore,
} from '../auth/session-env.js';
import { PlifError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import { commit as commitOverlay, materialize } from '../fs/overlay.js';
import { PathJail, normalizeVirtualPath } from '../fs/vpath.js';
import type { ApprovalBroker } from '../policy/approval.js';
import { denialError } from '../policy/approval.js';
import type { PolicyAction, PolicyEngine, TrustTier } from '../policy/policy.js';
import type { ContentStore } from '../store/content.js';
import type { ImageStore, LayerStore } from '../store/images.js';
import type { StorePaths } from '../store/paths.js';
import { TerminalSession } from './terminal-session.js';
import type {
  CapabilitySet,
  ContainerSpec,
  ContainerState,
  ContainerStatus,
  ExecRequest,
  ExecResult,
  Image,
  Layer,
  Mount,
  ResourceLimits,
  ResourceUsage,
} from '../types.js';
import { ZERO_USAGE } from '../types.js';

/** The weakest sandbox each trust tier will accept. */
const TRUST_FLOOR: Record<TrustTier, Parameters<typeof isolationAtLeast>[1]> = {
  trusted: 'none',
  'semi-trusted': 'job',
  untrusted: 'namespace',
};

const REDACTED_ENVIRONMENT_VALUE = '[secret omitted]';

function environmentSecrets(values: Readonly<Record<string, string>>): string[] {
  return Object.values(values)
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length);
}

function redactEnvironmentValues(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    // Splitting avoids a regular-expression interpretation of tokens such as
    // `a+b` or `key[0]`. Empty values are filtered above so this always makes
    // progress and cannot loop.
    redacted = redacted.split(secret).join(REDACTED_ENVIRONMENT_VALUE);
  }
  return redacted;
}

export interface ContainerDeps {
  readonly paths: StorePaths;
  readonly content: ContentStore;
  readonly layers: LayerStore;
  readonly images: ImageStore;
  readonly backend: SandboxBackend;
  readonly bus: EventBus;
  readonly audit: AuditLog;
  readonly approvals: ApprovalBroker;
  readonly policy: PolicyEngine;
  /** Optional session binding. Omit it for containers not owned by a session. */
  readonly sessionEnvironment?: ContainerEnvironmentBinding;
}

export interface ContainerEnvironmentBinding {
  readonly store: SessionEnvironmentStore;
  readonly scope: SessionEnvironmentScope;
}

/** Safe runtime view; environment values never appear here. */
export interface RuntimeEnvironmentStatus {
  readonly count: number;
  readonly names: readonly string[];
}

export interface TerminalStartRequest {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly reason: string;
  readonly ownerId?: string;
  readonly sessionId?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface TerminalChunk {
  readonly stream: 'stdout' | 'stderr';
  readonly chunk: string;
  readonly at: number;
}

export class Container {
  readonly id: string;
  readonly name: string;
  readonly spec: ContainerSpec;
  readonly image: Image;
  readonly capabilities: CapabilitySet;
  readonly limits: ResourceLimits;
  readonly mounts: readonly Mount[];
  readonly workdir: string;

  #deps: ContainerDeps;
  #jail: PathJail;
  #sandbox: SandboxJail | null = null;
  #state: ContainerState = 'created';
  #startedAt: string | undefined;
  #exitedAt: string | undefined;
  #exitCode: number | undefined;
  #killedBy: string | undefined;
  #usage: ResourceUsage = ZERO_USAGE;
  #diskWritten = 0;
  #execCount = 0;
  #lifetimeTimer: NodeJS.Timeout | undefined;
  #abort = new AbortController();
  /** In-flight execs by id, so a single one can be cancelled by name. */
  #running = new Map<string, AbortController>();
  #terminals = new Map<string, TerminalSession>();
  #finishedTerminals = new Set<string>();
  /** Session/runtime variables; never copied from the host environment. */
  #runtimeEnvironment: Record<string, string> = {};

  constructor(
    id: string,
    spec: ContainerSpec,
    image: Image,
    deps: ContainerDeps,
  ) {
    this.id = id;
    this.name = spec.name;
    this.spec = spec;
    this.image = image;
    this.#deps = deps;

    // Narrow-only: a container may drop a capability the image granted, never
    // add one it did not. This is what makes an image a real trust boundary.
    this.capabilities = intersectCapabilities(image.config.capabilities, spec.capabilities);
    this.limits = tightenLimits(image.config.limits, spec.limits);
    this.mounts = spec.mounts;
    this.workdir = normalizeVirtualPath(spec.workdir ?? image.config.workdir);

    // The materialised rootfs *is* the writable layer. There is deliberately no
    // second "upper" directory: the API writes and the sandboxed processes must
    // land in the same tree, or `commit` would snapshot one and miss the other.
    this.#jail = new PathJail({
      upperDir: deps.paths.containerRootfs(id),
      lowerDirs: [],
      mounts: spec.mounts,
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  get state(): ContainerState {
    return this.#state;
  }

  status(): ContainerStatus {
    return {
      state: this.#state,
      startedAt: this.#startedAt,
      exitedAt: this.#exitedAt,
      exitCode: this.#exitCode,
      killedBy: this.#killedBy,
      usage: { ...this.#usage, diskWrittenBytes: this.#diskWritten, execCount: this.#execCount },
    };
  }

  get rootfs(): string {
    return this.#deps.paths.containerRootfs(this.id);
  }

  async start(): Promise<void> {
    this.#requireState('created', 'exited');

    // Refuse before doing any work if the machine cannot confine this tier.
    const report = await this.#deps.backend.probe();
    const floor = TRUST_FLOOR[this.#deps.policy.trust];
    if (!isolationAtLeast(report.isolation, floor)) {
      throw new PlifError(
        'SANDBOX_UNAVAILABLE',
        `policy trust tier "${this.#deps.policy.trust}" requires ${floor} isolation, but this machine provides "${report.isolation}"`,
        {
          detail: {
            required: floor,
            actual: report.isolation,
            degradations: report.degradations,
          },
          hint: 'Lower the policy trust tier, or run on a host with a stronger sandbox backend.',
        },
      );
    }
    const missing = requiredSandboxCapabilities(this.#deps.policy.trust, report, this.capabilities.network);
    if (missing.length > 0) {
      throw new PlifError(
        'SANDBOX_UNAVAILABLE',
        `policy trust tier "${this.#deps.policy.trust}" requires unavailable sandbox capabilities: ${missing.join(', ')}`,
        {
          detail: { missing, backend: report.backend, degradations: report.degradations },
          hint: 'Use a host with delegated cgroup v2 controllers, or lower the policy trust tier.',
        },
      );
    }
    if (report.degradations.length > 0) {
      await this.#deps.audit.append('sandbox.degraded', this.id, {
        backend: report.backend,
        isolation: report.isolation,
        degradations: report.degradations,
      });
    }

    // A restart re-materialises from the image, deliberately: a container is a
    // reproducible instance of an image, not a mutable VM. Anything worth
    // keeping across restarts must be committed to a layer first.
    await fs.rm(this.rootfs, { recursive: true, force: true });

    await materialize(this.#deps.content, this.#deps.layers, {
      layers: this.image.layers,
      rootfs: this.rootfs,
      mode: 'copy',
    });

    // The workdir must exist or the first exec fails with a confusing ENOENT
    // from deep inside child_process.
    const workdirHost = path.join(this.rootfs, ...this.workdir.split('/').filter(Boolean));
    await fs.mkdir(workdirHost, { recursive: true });

    this.#sandbox = await this.#deps.backend.createJail({
      id: `plif-${this.id}`,
      root: this.rootfs,
      memoryBytes: this.limits.memoryBytes,
      maxProcesses: this.limits.maxProcesses,
      cpuCores: this.limits.cpuCores,
      writablePaths: this.#jail.writableHostPaths(),
      allowNetwork: this.capabilities.network,
      mounts: this.mounts.map((mount) => ({
        source: mount.source,
        target: normalizeVirtualPath(mount.target),
        mode: mount.mode,
        ...(mount.mask ? { mask: mount.mask } : {}),
      })),
    });

    // Loading is deliberately separate from the host process environment. The
    // values are held only in this Container and are passed to children by
    // #buildEnv; they are never mounted as a .env file. Mark the container as
    // running before loading them: a session secret is not injected into a
    // container that has not completed its Plif startup transition.
    this.#runtimeEnvironment = {};

    if (this.limits.lifetimeMs > 0) {
      this.#lifetimeTimer = setTimeout(() => {
        void this.stop(`lifetime limit of ${this.limits.lifetimeMs}ms reached`);
      }, this.limits.lifetimeMs);
      this.#lifetimeTimer.unref?.();
    }

    this.#startedAt = new Date().toISOString();
    this.#transition('running');
    await this.#deps.audit.append('container.start', this.id, {
      image: this.image.reference,
      isolation: report.isolation,
      mounts: this.mounts.map((m) => `${m.source} -> ${m.target} (${m.mode})`),
    });

    const sessionBinding = this.#deps.sessionEnvironment;
    if (sessionBinding) {
      try {
        this.#runtimeEnvironment = {
          ...(await sessionBinding.store.loadForExecution(sessionBinding.scope)),
        };
      } catch {
        // Secure-store failures are fail-closed for values and must not leave
        // a half-started container behind. The bound store exposes the warning
        // through its status surface; this container simply starts with no
        // session variables until a later explicit reload.
        this.#runtimeEnvironment = {};
      }
    }
  }

  async stop(reason = 'stopped by request'): Promise<void> {
    if (this.#state === 'exited' || this.#state === 'removed') return;

    clearTimeout(this.#lifetimeTimer);
    this.#abort.abort();
    this.#deps.approvals.denyAll(`container ${this.name} stopped`);

    if (this.#sandbox) {
      // Snapshot usage before teardown; the OS counters die with the job.
      await this.#syncUsage();
      await this.#sandbox.kill(reason);
      await this.#sandbox.dispose();
      this.#sandbox = null;
    }
    await Promise.allSettled([...this.#terminals.values()].map((terminal) => terminal.close()));
    this.#terminals.clear();
    this.#finishedTerminals.clear();

    this.#killedBy = reason;
    this.#exitedAt = new Date().toISOString();
    // Do not keep session secrets in a stopped container object. A restart can
    // reload the encrypted session record, while runtime-only values expire.
    this.#runtimeEnvironment = {};
    this.#transition('exited');
    await this.#deps.audit.append('container.stop', this.id, { reason, usage: this.#usage });
  }

  async remove(): Promise<void> {
    if (this.#state === 'running') await this.stop('removed');
    await fs.rm(this.#deps.paths.container(this.id), { recursive: true, force: true });
    this.#transition('removed');
    await this.#deps.audit.append('container.remove', this.id, {});
  }

  /** Snapshot the current rootfs as a new image layer. */
  async commit(name: string): Promise<Layer> {
    await this.#authorize('container.commit', name, undefined, 'snapshot the workspace');
    const layer = await commitOverlay(this.#deps.content, this.#deps.layers, {
      rootfs: this.rootfs,
      baseLayers: this.image.layers,
      name,
    });
    await this.#deps.audit.append('container.commit', this.id, {
      layer: layer.digest,
      name,
      entries: layer.entries.length,
      bytes: layer.size,
    });
    return layer;
  }

  // -------------------------------------------------------------------------
  // Filesystem — the agent's read/write tools land here
  // -------------------------------------------------------------------------

  async readFile(virtualPath: string): Promise<string> {
    this.#requireCapability('fsRead', 'read files');
    await this.#authorize('fs.read', virtualPath);

    const resolved = await this.#jail.resolveRead(virtualPath);
    const stat = await fs.stat(resolved.host);
    if (stat.isDirectory()) {
      throw new PlifError('PATH_NOT_A_FILE', `${virtualPath} is a directory`, {
        detail: { path: virtualPath },
      });
    }
    return await fs.readFile(resolved.host, 'utf8');
  }

  async writeFile(virtualPath: string, contents: string): Promise<void> {
    this.#requireCapability('fsWrite', 'write files');
    await this.#authorize('fs.write', virtualPath);

    const bytes = Buffer.byteLength(contents, 'utf8');
    this.#chargeDisk(bytes);

    const resolved = await this.#jail.resolveWrite(virtualPath);
    if (resolved.mount && resolved.mount.mode === 'rw') {
      // Writing through a mount mutates real host state, which is a strictly
      // bigger deal than writing to the container layer.
      this.#requireCapability('hostWrite', `write to the host through ${resolved.mount.target}`);
    }

    await fs.mkdir(path.dirname(resolved.host), { recursive: true });
    await fs.writeFile(resolved.host, contents, 'utf8');
    await this.#deps.audit.append('fs.write', this.id, { path: virtualPath, bytes });
  }

  async deleteFile(virtualPath: string): Promise<void> {
    this.#requireCapability('fsWrite', 'delete files');
    await this.#authorize('fs.delete', virtualPath);

    const resolved = await this.#jail.resolveWrite(virtualPath);
    if (resolved.mount && resolved.mount.mode === 'rw') {
      this.#requireCapability('hostWrite', `delete on the host through ${resolved.mount.target}`);
    }
    await fs.rm(resolved.host, { recursive: true, force: true });
    await this.#deps.audit.append('fs.delete', this.id, { path: virtualPath });
  }

  /**
   * Where a container path really lives on the host.
   *
   * Needed by the language server, which is a real process reading real files
   * and cannot see the virtual path space. It matters that this goes through
   * the jail rather than joining strings: with a host tree mounted the answer
   * is the mount source, and without one it is the container rootfs — so a
   * server rooted by hand would analyse whichever of the two happened to be
   * stale.
   *
   * Translation is not write intent. Resolving this for writing made a
   * read-only mount — the default for `plif prompt` — fail before the agent had
   * said anything, because rooting a language server at the workspace looked
   * to the jail like an attempt to modify it. The write path is kept only as
   * the fallback for a location that does not exist yet, where reading has
   * nothing to find.
   */
  async hostPathFor(virtualPath: string): Promise<string> {
    try {
      return (await this.#jail.resolveRead(virtualPath)).host;
    } catch (error) {
      if (!PlifError.is(error) || error.code !== 'PATH_NOT_FOUND') throw error;
      return (await this.#jail.resolveWrite(virtualPath)).host;
    }
  }

  /**
   * Permission to talk to one host over the network.
   *
   * The same two gates every other capability goes through, in the same order:
   * the container's ceiling first, then policy per target. A withheld
   * capability is a flat no; a granted one still asks, and the target is the
   * host, so allowing `api.duckduckgo.com` once does not also allow whatever
   * the next call decides to reach.
   *
   * What this does *not* do is route the traffic. The request is made by this
   * process, outside the sandbox — the sandbox report has always said
   * `networkBlock: false`, and this makes an existing hole reachable through a
   * checked door rather than only through `run_command curl`.
   */
  async reachNetwork(host: string, reason: string): Promise<void> {
    this.#requireCapability('network', 'reach the network');
    await this.#authorize('net.connect', host, undefined, reason);
  }

  /**
   * Permission to run a subagent on a model that costs money.
   *
   * No capability gate, because there is nothing to contain: this is not the
   * agent reaching somewhere it should not, it is the agent spending the
   * developer's credit. Policy decides, the fallback is `ask`, and
   * auto-approve says yes — which is the whole shape of the answer.
   *
   * Free models never call this. A permission prompt for spending nothing is
   * how people learn to approve without reading.
   */
  async authorizeModel(ref: string, reason: string): Promise<void> {
    await this.#authorize('model.spawn', ref, undefined, reason);
  }

  async listDir(virtualPath: string): Promise<{ name: string; kind: string }[]> {
    this.#requireCapability('fsRead', 'list directories');
    await this.#authorize('fs.read', virtualPath);

    const resolved = await this.#jail.resolveRead(virtualPath);
    const stat = await fs.stat(resolved.host);
    if (!stat.isDirectory()) {
      throw new PlifError('PATH_NOT_A_DIRECTORY', `${virtualPath} is not a directory`, {
        detail: { path: virtualPath },
      });
    }
    const dirents = await fs.readdir(resolved.host, { withFileTypes: true });
    return dirents.map((dirent) => ({
      name: dirent.name,
      kind: dirent.isDirectory() ? 'directory' : dirent.isSymbolicLink() ? 'symlink' : 'file',
    }));
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  async exec(request: ExecRequest): Promise<ExecResult> {
    this.#requireCapability('exec', 'run processes');
    this.#requireState('running');

    if (request.argv.length === 0) {
      throw new PlifError('INVALID_ARGUMENT', 'exec requires a non-empty argv');
    }
    if (!this.#sandbox) {
      throw new PlifError('SANDBOX_UNAVAILABLE', 'container has no active sandbox jail');
    }

    const argv0 = request.argv[0] as string;
    await this.#authorize('exec', argv0, request.argv, request.reason);

    const execId = randomUUID().slice(0, 8);
    const cwdVirtual = normalizeVirtualPath(request.cwd ?? this.workdir);
    const cwdResolved = await this.#jail.resolveRead(cwdVirtual).catch(() => null);
    const cwdHost =
      cwdResolved?.host ?? path.join(this.rootfs, ...cwdVirtual.split('/').filter(Boolean));

    this.#deps.bus.emit('exec.start', {
      containerId: this.id,
      execId,
      argv: request.argv,
      cwd: cwdVirtual,
    });
    await this.#deps.audit.append('exec.start', this.id, {
      execId,
      argv: request.argv,
      cwd: cwdVirtual,
      reason: request.reason,
    });

    const timeoutMs = Math.min(
      request.timeoutMs ?? this.limits.execTimeoutMs,
      this.limits.execTimeoutMs,
    );

    // Capture the values belonging to this child. A later `/env delete` or
    // session switch must not make output from an already-running process
    // visible for the few milliseconds before that process exits.
    const redactionSecrets = environmentSecrets({
      ...this.#runtimeEnvironment,
      ...(request.env ?? {}),
    });

    // Two ways to stop this exec: the container going down, or the caller
    // cancelling just this one. Both must work, so they are merged rather than
    // the caller's signal replacing the container's.
    const cancel = new AbortController();
    const onContainerAbort = (): void => cancel.abort();
    const onRequestAbort = (): void => cancel.abort();
    this.#abort.signal.addEventListener('abort', onContainerAbort, { once: true });
    request.signal?.addEventListener('abort', onRequestAbort, { once: true });
    this.#running.set(execId, cancel);

    let spawned;
    try {
      spawned = await this.#sandbox.spawn({
        argv: request.argv,
        cwd: cwdHost,
        virtualCwd: cwdVirtual,
        env: this.#buildEnv(request.env),
        timeoutMs,
        maxOutputBytes: this.limits.outputBytes,
        signal: cancel.signal,
        onOutput: (stream, chunk) => {
          this.#deps.bus.emit('exec.output', {
            containerId: this.id,
            execId,
            stream,
            chunk: redactEnvironmentValues(chunk, redactionSecrets),
          });
        },
        ...(request.stdin !== undefined ? { stdin: request.stdin } : {}),
      });
    } finally {
      this.#running.delete(execId);
      this.#abort.signal.removeEventListener('abort', onContainerAbort);
      request.signal?.removeEventListener('abort', onRequestAbort);
    }

    this.#execCount += 1;
    await this.#syncUsage();

    const result: ExecResult = {
      exitCode: spawned.exitCode,
      stdout: redactEnvironmentValues(spawned.stdout, redactionSecrets),
      stderr: redactEnvironmentValues(spawned.stderr, redactionSecrets),
      truncated: spawned.truncated,
      durationMs: spawned.durationMs,
      ...(spawned.killedBy ? { killedBy: spawned.killedBy } : {}),
    };

    this.#deps.bus.emit('exec.end', { containerId: this.id, execId, result });
    await this.#deps.audit.append('exec.end', this.id, {
      execId,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      killedBy: result.killedBy ?? null,
      truncated: result.truncated,
    });

    if (result.killedBy === 'timeout') {
      this.#deps.bus.emit('limit.exceeded', {
        containerId: this.id,
        limit: 'execTimeoutMs',
        actual: result.durationMs,
        ceiling: timeoutMs,
      });
    }
    return result;
  }

  async startTerminal(request: TerminalStartRequest): Promise<{ terminalId: string; ownerId: string }> {
    this.#requireCapability('exec', 'run processes');
    this.#requireState('running');
    if (request.argv.length === 0) {
      throw new PlifError('INVALID_ARGUMENT', 'terminal requires a non-empty argv');
    }
    if (!this.#sandbox) {
      throw new PlifError('SANDBOX_UNAVAILABLE', 'container has no active sandbox jail');
    }
    const ownerId = request.ownerId?.trim() || 'primary';
    const argv0 = request.argv[0] as string;
    await this.#authorize('exec', argv0, request.argv, request.reason);
    const cwdVirtual = normalizeVirtualPath(request.cwd ?? this.workdir);
    const cwdResolved = await this.#jail.resolveRead(cwdVirtual).catch(() => null);
    const cwdHost = cwdResolved?.host ?? path.join(this.rootfs, ...cwdVirtual.split('/').filter(Boolean));
    const redactionSecrets = environmentSecrets({
      ...this.#runtimeEnvironment,
      ...(request.env ?? {}),
    });
    const terminal = new TerminalSession({
      terminal: await this.#sandbox.openTerminal({
        argv: request.argv,
        cwd: cwdHost,
        virtualCwd: cwdVirtual,
        env: this.#buildEnv(request.env),
        maxOutputBytes: this.limits.outputBytes,
        ownerId,
        sessionId: request.sessionId,
        containerId: this.id,
      }),
      ownerId,
      containerId: this.id,
      redact: (text) => redactEnvironmentValues(text, redactionSecrets),
    });
    this.#terminals.set(terminal.id, terminal);
    this.#deps.bus.emit('exec.start', {
      containerId: this.id,
      execId: terminal.id,
      argv: request.argv,
      cwd: cwdVirtual,
    });
    await this.#deps.audit.append('exec.start', this.id, {
      execId: terminal.id,
      argv: request.argv,
      cwd: cwdVirtual,
      reason: request.reason,
      terminal: true,
      ownerId,
    });
    return { terminalId: terminal.id, ownerId };
  }

  async writeTerminal(id: string, ownerId: string, input: string): Promise<readonly TerminalChunk[]> {
    const terminal = this.#terminal(id, ownerId);
    await terminal.write(input);
    return this.#readTerminalChunks(terminal);
  }

  async readTerminal(id: string, ownerId: string): Promise<readonly TerminalChunk[]> {
    return this.#readTerminalChunks(this.#terminal(id, ownerId));
  }

  async resizeTerminal(id: string, ownerId: string, columns: number, rows: number): Promise<void> {
    await this.#terminal(id, ownerId).resize(columns, rows);
  }

  async signalTerminal(id: string, ownerId: string, signal: TerminalSignal): Promise<void> {
    await this.#terminal(id, ownerId).signal(signal);
  }

  async waitTerminal(id: string, ownerId: string): Promise<ExecResult> {
    const terminal = this.#terminal(id, ownerId);
    const result = await terminal.wait();
    await this.#finishTerminal(terminal, result);
    return result;
  }

  async closeTerminal(id: string, ownerId: string): Promise<ExecResult> {
    const terminal = this.#terminal(id, ownerId);
    await terminal.close();
    const result = await terminal.wait();
    await this.#finishTerminal(terminal, result);
    this.#terminals.delete(id);
    this.#finishedTerminals.delete(id);
    return result;
  }

  #terminal(id: string, ownerId: string): TerminalSession {
    const terminal = this.#terminals.get(id);
    if (!terminal || terminal.ownerId !== ownerId) {
      throw new PlifError('POLICY_DENIED', 'terminal "' + id + '" is not owned by this agent');
    }
    return terminal;
  }

  async #readTerminalChunks(terminal: TerminalSession): Promise<readonly TerminalChunk[]> {
    const chunks = await terminal.readAvailable();
    for (const item of chunks) {
      this.#deps.bus.emit('exec.output', {
        containerId: this.id,
        execId: terminal.id,
        stream: item.stream,
        chunk: item.chunk,
      });
    }
    return chunks;
  }

  async #finishTerminal(terminal: TerminalSession, result: ExecResult): Promise<void> {
    if (this.#finishedTerminals.has(terminal.id)) return;
    this.#finishedTerminals.add(terminal.id);
    this.#deps.bus.emit('exec.end', { containerId: this.id, execId: terminal.id, result });
    await this.#deps.audit.append('exec.end', this.id, {
      execId: terminal.id,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      killedBy: result.killedBy ?? null,
      truncated: result.truncated,
      terminal: true,
    });
  }

  /**
   * Apply variables to the already-running container. This changes only future
   * execs; existing child processes keep the environment they were spawned
   * with. The returned view contains names and counts, never values.
   */
  applyEnvironment(values: EnvironmentMap): RuntimeEnvironmentStatus {
    this.#requireState('running');
    const normalized = normalizeEnvironmentMap(values);
    this.#runtimeEnvironment = { ...this.#runtimeEnvironment, ...normalized };
    return this.runtimeEnvironmentStatus();
  }

  /** Remove variables by name, or by the keys of a map whose values are ignored. */
  removeEnvironment(selection: EnvironmentNameSelection): RuntimeEnvironmentStatus {
    this.#requireState('running');
    for (const name of normalizeEnvironmentNames(selection)) delete this.#runtimeEnvironment[name];
    return this.runtimeEnvironmentStatus();
  }

  clearEnvironment(): RuntimeEnvironmentStatus {
    this.#requireState('running');
    this.#runtimeEnvironment = {};
    return this.runtimeEnvironmentStatus();
  }

  /** Safe view for a TUI; it cannot disclose an environment value. */
  runtimeEnvironmentStatus(): RuntimeEnvironmentStatus {
    const names = Object.keys(this.#runtimeEnvironment).sort();
    return { count: names.length, names };
  }

  /**
   * Remove session-environment values from a tool result before it is
   * persisted, streamed into the TUI, or sent back to a model. This also
   * protects non-exec tools (for example read_file or an MCP response) if a
   * command wrote a session credential into a file or response.
   */
  redactSensitiveOutput(text: string): string {
    return redactEnvironmentValues(text, environmentSecrets(this.#runtimeEnvironment));
  }

  /** Reload the encrypted session environment without restarting the container. */
  async reloadSessionEnvironment(): Promise<SessionEnvironmentStatus | undefined> {
    this.#requireState('running');
    const binding = this.#deps.sessionEnvironment;
    if (!binding) {
      this.#runtimeEnvironment = {};
      return undefined;
    }
    this.#runtimeEnvironment = {
      ...(await binding.store.loadForExecution(binding.scope)),
    };
    return binding.store.status(binding.scope);
  }

  /** Safe persistence/backend status for a TUI, when this container is bound. */
  sessionEnvironmentStatus(): Promise<SessionEnvironmentStatus | undefined> {
    const binding = this.#deps.sessionEnvironment;
    return binding ? binding.store.status(binding.scope) : Promise.resolve(undefined);
  }

  /**
   * Cancel work without tearing the container down.
   *
   * This is the Escape key: the developer wants *this command* to stop, not the
   * whole workspace to be thrown away. Stopping the container instead would
   * discard the uncommitted rootfs, which is almost never what they meant.
   * Returns how many execs were signalled.
   */
  cancelRunning(): number {
    const count = this.#running.size;
    for (const controller of this.#running.values()) controller.abort();
    return count;
  }

  get runningExecs(): number {
    return this.#running.size;
  }

  /**
   * The environment a sandboxed process sees.
   *
   * Built by allowlist, not by filtering the host environment. A denylist would
   * need updating every time a new tool invents a credential variable, and the
   * failure mode of missing one is leaking a secret into a process that may
   * print it.
   */
  #buildEnv(overrides: Readonly<Record<string, string>> | undefined): Record<string, string> {
    const env: Record<string, string> = {};

    if (this.capabilities.envRead) {
      const passthrough = [
        'PATH',
        'SystemRoot',
        'SystemDrive',
        'ComSpec',
        'PATHEXT',
        'NUMBER_OF_PROCESSORS',
        'PROCESSOR_ARCHITECTURE',
        'LANG',
        'LC_ALL',
        'TZ',
      ];
      for (const key of passthrough) {
        const value = process.env[key];
        if (value !== undefined) env[key] = value;
      }
      // Point transient state at the container so a tool that scribbles into
      // TEMP does not scatter files across the developer's machine.
      const containerTemp = path.join(this.rootfs, 'tmp');
      env['TEMP'] = containerTemp;
      env['TMP'] = containerTemp;
    }

    env['PLIF'] = '1';
    env['PLIF_CONTAINER'] = this.name;
    env['PLIF_CONTAINER_ID'] = this.id;

    return {
      ...env,
      ...this.image.config.env,
      ...this.spec.env,
      ...this.#runtimeEnvironment,
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The single gate. Runs the policy engine, escalates to a human when the
   * verdict is `ask`, records the outcome, and throws on refusal.
   */
  async #authorize(
    action: PolicyAction,
    target: string,
    argv?: readonly string[],
    reason?: string,
  ): Promise<void> {
    const request = { action, target, containerId: this.id, ...(argv ? { argv } : {}), ...(reason ? { reason } : {}) };
    const verdict = this.#deps.policy.evaluate(request);

    this.#deps.bus.emit('policy.decision', {
      containerId: this.id,
      action,
      target,
      verdict,
    });
    await this.#deps.audit.append('policy.decision', this.id, {
      action,
      target,
      argv: argv ?? null,
      decision: verdict.decision,
      rule: verdict.rule?.name ?? null,
      reason: verdict.reason,
    });

    if (verdict.decision === 'allow') return;

    if (verdict.decision === 'deny') {
      throw new PlifError('POLICY_DENIED', `${action} on ${target} was denied by policy`, {
        detail: { action, target, rule: verdict.rule?.name ?? null },
        hint: verdict.reason,
      });
    }

    const question = {
      containerId: this.id,
      action,
      target,
      ...(argv ? { argv } : {}),
      reason: reason ?? `The agent wants to ${action} ${target}.`,
      rationale: verdict.reason,
    };
    const answer = await this.#deps.approvals.ask(question);
    await this.#deps.audit.append('approval.response', this.id, {
      action,
      target,
      decision: answer.decision,
      remembered: answer.remember,
    });

    if (answer.decision === 'deny') {
      throw denialError(question, false);
    }
  }

  #requireCapability(capability: keyof CapabilitySet, what: string): void {
    if (!this.capabilities[capability]) {
      throw new PlifError('POLICY_DENIED', `container "${this.name}" may not ${what}`, {
        detail: { capability },
        hint: `Grant the "${capability}" capability when creating the container.`,
      });
    }
  }

  #requireState(...allowed: ContainerState[]): void {
    if (!allowed.includes(this.#state)) {
      throw new PlifError(
        'CONTAINER_BAD_STATE',
        `container "${this.name}" is ${this.#state}; expected ${allowed.join(' or ')}`,
        { detail: { state: this.#state, allowed } },
      );
    }
  }

  #transition(to: ContainerState): void {
    const from = this.#state;
    this.#state = to;
    this.#deps.bus.emit('container.state', { containerId: this.id, name: this.name, from, to });
  }

  #chargeDisk(bytes: number): void {
    if (this.limits.diskWriteBytes <= 0) return;
    if (this.#diskWritten + bytes > this.limits.diskWriteBytes) {
      this.#deps.bus.emit('limit.exceeded', {
        containerId: this.id,
        limit: 'diskWriteBytes',
        actual: this.#diskWritten + bytes,
        ceiling: this.limits.diskWriteBytes,
      });
      throw new PlifError(
        'QUOTA_DISK',
        `write would exceed the container's ${formatBytes(this.limits.diskWriteBytes)} disk budget`,
        {
          detail: { written: this.#diskWritten, requested: bytes },
          hint: 'Commit the container to a layer and start a fresh one, or raise diskWriteBytes.',
        },
      );
    }
    this.#diskWritten += bytes;
  }

  async #syncUsage(): Promise<void> {
    if (!this.#sandbox) return;
    const stats = await this.#sandbox.stats().catch(() => null);
    if (!stats) return;

    this.#usage = {
      peakMemoryBytes: Math.max(this.#usage.peakMemoryBytes, stats.peakMemoryBytes),
      diskWrittenBytes: this.#diskWritten,
      execCount: this.#execCount,
      liveProcesses: stats.activeProcesses,
      cpuMillis: stats.cpuMillis,
    };
    this.#deps.bus.emit('container.usage', { containerId: this.id, usage: this.#usage });
  }
}

// ---------------------------------------------------------------------------

/** Logical AND. A missing override keeps the image's value; it cannot grant. */
function intersectCapabilities(
  base: CapabilitySet,
  overrides: Partial<CapabilitySet> | undefined,
): CapabilitySet {
  const out = { ...base };
  if (!overrides) return out;
  for (const key of Object.keys(out) as (keyof CapabilitySet)[]) {
    const override = overrides[key];
    if (override !== undefined) out[key] = base[key] && override;
  }
  return out;
}

/**
 * Take the smaller of each limit.
 *
 * Same reasoning as capabilities: a container spec is a request from a less
 * trusted place than the image, so it may only tighten. `lifetimeMs: 0` means
 * unbounded, so it loses to any positive value rather than winning as a minimum.
 */
function tightenLimits(
  base: ResourceLimits,
  overrides: Partial<ResourceLimits> | undefined,
): ResourceLimits {
  if (!overrides) return base;
  const pick = (a: number, b: number | undefined, zeroIsUnbounded = false): number => {
    if (b === undefined) return a;
    if (zeroIsUnbounded) {
      if (a === 0) return b;
      if (b === 0) return a;
    }
    return Math.min(a, b);
  };
  return {
    memoryBytes: pick(base.memoryBytes, overrides.memoryBytes),
    maxProcesses: pick(base.maxProcesses, overrides.maxProcesses),
    diskWriteBytes: pick(base.diskWriteBytes, overrides.diskWriteBytes),
    execTimeoutMs: pick(base.execTimeoutMs, overrides.execTimeoutMs),
    lifetimeMs: pick(base.lifetimeMs, overrides.lifetimeMs, true),
    outputBytes: pick(base.outputBytes, overrides.outputBytes),
    cpuCores: pick(base.cpuCores, overrides.cpuCores),
  };
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function requiredSandboxCapabilities(
  trust: TrustTier,
  report: Awaited<ReturnType<SandboxBackend['probe']>>,
  networkAllowed: boolean,
): string[] {
  if (trust === 'trusted') return [];
  const checks: [string, boolean][] = [
    ['killProcessTree', report.killProcessTree],
    ['memoryLimit', report.memoryLimit],
    ['processLimit', report.processLimit],
    ['cpuLimit', report.cpuLimit],
  ];
  if (trust === 'untrusted') {
    checks.push(['filesystemWriteBlock', report.filesystemWriteBlock]);
    if (!networkAllowed) checks.push(['networkBlock', report.networkBlock]);
  }
  return checks.filter(([, available]) => !available).map(([name]) => name);
}
