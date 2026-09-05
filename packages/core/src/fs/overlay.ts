/**
 * The union filesystem.
 *
 * Docker gets copy-on-write for free from overlayfs in the kernel. We do not
 * have that on Windows, and we are not a kernel module, so Plif materialises
 * the union into a real directory (`rootfs/`) that real processes can be
 * pointed at. This is the same approach as Docker's `vfs` graph driver, with
 * one improvement: identical file bodies are shared through the content store
 * rather than duplicated per layer.
 *
 * ## Placement modes, and the sharp edge in the fast one
 *
 * `copy` (default) writes an independent copy of every file. Safe, and the only
 * correct choice for anything a process may modify in place.
 *
 * `link` hard-links files straight out of the blob store, which makes a 500 MB
 * toolchain layer cost effectively nothing to materialise. The catch is real
 * and must be understood before enabling it: a hard link *is* the blob. A
 * process that opens the file read-write and edits it in place would corrupt
 * the shared store and every other container using that layer. Plif marks
 * linked files read-only at the OS level so such a write fails loudly instead
 * of silently spreading, but that is a guard rail, not a guarantee — an
 * elevated process can clear the attribute.
 *
 * Use `link` for immutable toolchain layers. Use `copy` for source trees.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';
import type { ContentStore } from '../store/content.js';
import { digestOf } from '../store/content.js';
import type { LayerStore } from '../store/images.js';
import type { Digest, Layer, LayerEntry } from '../types.js';
import { normalizeVirtualPath } from './vpath.js';

export type PlacementMode = 'copy' | 'link';

export interface MaterializeOptions {
  readonly layers: readonly Digest[];
  readonly rootfs: string;
  readonly mode?: PlacementMode;
  /** Called after each layer so the CLI can draw a progress bar. */
  readonly onLayer?: (digest: Digest, index: number, total: number) => void;
}

export interface MaterializeResult {
  readonly files: number;
  readonly bytes: number;
  /** Files placed by hard link rather than copy. */
  readonly linked: number;
  readonly durationMs: number;
}

/**
 * Build the union view of an ordered layer stack into `rootfs`.
 *
 * Layers are applied lowest to highest, so a later layer's version of a path
 * replaces an earlier one, and a whiteout entry removes it. That ordering is
 * the entire semantics of a layered image; do not parallelise across layers.
 */
export async function materialize(
  content: ContentStore,
  layerStore: LayerStore,
  options: MaterializeOptions,
): Promise<MaterializeResult> {
  const started = Date.now();
  const mode = options.mode ?? 'copy';
  const rootfs = path.resolve(options.rootfs);

  await fs.mkdir(rootfs, { recursive: true });

  let files = 0;
  let bytes = 0;
  let linked = 0;

  for (const [index, digest] of options.layers.entries()) {
    const layer = await layerStore.require(digest);

    // Within a layer, order is irrelevant except that directories must exist
    // before their children. Sorting by path gives that for free.
    for (const entry of layer.entries) {
      const target = resolveInto(rootfs, entry.path);

      switch (entry.kind) {
        case 'whiteout':
          await fs.rm(target, { recursive: true, force: true });
          break;

        case 'directory':
          await removeNonDirectory(target);
          await fs.mkdir(target, { recursive: true });
          break;

        case 'symlink': {
          if (!entry.target) {
            throw new PlifError('LAYER_CORRUPT', `symlink entry ${entry.path} has no target`, {
              detail: { layer: digest, path: entry.path },
            });
          }
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.rm(target, { recursive: true, force: true });
          // Symlinks are recreated, never followed, so a layer cannot smuggle
          // in a link that the jail then resolves outside the rootfs — the
          // PathJail re-checks resolution on every access regardless.
          await fs.symlink(entry.target, target);
          break;
        }

        case 'file': {
          if (!entry.digest) {
            throw new PlifError('LAYER_CORRUPT', `file entry ${entry.path} has no digest`, {
              detail: { layer: digest, path: entry.path },
            });
          }
          const useLink = mode === 'link';
          await content.materialize(entry.digest, target, { copy: !useLink });
          if (useLink) {
            await markReadOnly(target);
            linked += 1;
          }
          files += 1;
          bytes += entry.size;
          break;
        }
      }
    }

    options.onLayer?.(digest, index + 1, options.layers.length);
  }

  return { files, bytes, linked, durationMs: Date.now() - started };
}

async function removeNonDirectory(target: string): Promise<void> {
  const stat = await fs.lstat(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (stat && !stat.isDirectory()) await fs.rm(target, { recursive: true, force: true });
}

/**
 * Diff a materialised rootfs against the layer stack it came from, and turn the
 * difference into a new layer.
 *
 * This is what makes an agent's work snapshottable: after a turn, commit the
 * rootfs and you have an immutable, shareable, rollback-able record of exactly
 * what changed — without copying anything that did not.
 */
export async function commit(
  content: ContentStore,
  layerStore: LayerStore,
  options: {
    readonly rootfs: string;
    readonly baseLayers: readonly Digest[];
    readonly name: string;
  },
): Promise<Layer> {
  const rootfs = path.resolve(options.rootfs);
  const base = await flatten(layerStore, options.baseLayers);
  const entries: LayerEntry[] = [];
  const seen = new Set<string>();

  for await (const found of walk(rootfs, rootfs)) {
    seen.add(found.virtual);
    const previous = base.get(found.virtual);

    if (found.kind === 'directory') {
      if (!previous) entries.push({ path: found.virtual, kind: 'directory', size: 0, mode: 0o755 });
      continue;
    }

    if (found.kind === 'symlink') {
      const target = await fs.readlink(found.host);
      if (!previous || previous.target !== target) {
        entries.push({ path: found.virtual, kind: 'symlink', size: 0, target, mode: 0o777 });
      }
      continue;
    }

    const data = await fs.readFile(found.host);
    const fileDigest = digestOf(data);

    // Unchanged content: the lower layer already provides it, so recording it
    // again would bloat the manifest for no behavioural difference.
    if (previous?.digest === fileDigest) continue;

    await content.put(data);
    entries.push({
      path: found.virtual,
      kind: 'file',
      size: data.byteLength,
      digest: fileDigest,
      mode: found.mode,
    });
  }

  // Anything the base had that the rootfs no longer does was deleted, and the
  // only way to express deletion in an additive layer model is a whiteout.
  for (const [virtual] of base) {
    if (!seen.has(virtual)) {
      entries.push({ path: virtual, kind: 'whiteout', size: 0, mode: 0 });
    }
  }

  return await layerStore.create(options.name, entries);
}

/** Collapse a layer stack into the effective path → entry map it produces. */
export async function flatten(
  layerStore: LayerStore,
  layers: readonly Digest[],
): Promise<Map<string, LayerEntry>> {
  const flat = new Map<string, LayerEntry>();
  for (const digest of layers) {
    const layer = await layerStore.require(digest);
    for (const entry of layer.entries) {
      if (entry.kind === 'whiteout') {
        flat.delete(entry.path);
        // A whiteout on a directory removes everything beneath it too.
        const prefix = entry.path + '/';
        for (const key of flat.keys()) {
          if (key.startsWith(prefix)) flat.delete(key);
        }
      } else {
        flat.set(entry.path, entry);
      }
    }
  }
  return flat;
}

/**
 * Turn a host directory into a layer. This is the "build" step: point it at a
 * template directory and get an immutable, deduplicated image layer.
 */
export async function layerFromDirectory(
  content: ContentStore,
  layerStore: LayerStore,
  options: {
    readonly source: string;
    readonly name: string;
    /** Where the tree lands inside the container. */
    readonly mountAt: string;
    /** File or directory basename patterns skipped entirely, e.g. node_modules, .env.*, *.pem. */
    readonly exclude?: readonly string[];
    readonly maxFileBytes?: number;
  },
): Promise<Layer> {
  const source = path.resolve(options.source);
  const mountAt = normalizeVirtualPath(options.mountAt);
  const exclude = new Set(options.exclude ?? []);
  const maxFileBytes = options.maxFileBytes ?? 64 * 1024 * 1024;
  const entries: LayerEntry[] = [];

  for await (const found of walk(source, source, exclude)) {
    const virtual = normalizeVirtualPath(
      mountAt === '/' ? found.virtual : mountAt + found.virtual,
    );

    if (found.kind === 'directory') {
      entries.push({ path: virtual, kind: 'directory', size: 0, mode: 0o755 });
      continue;
    }
    if (found.kind === 'symlink') {
      entries.push({
        path: virtual,
        kind: 'symlink',
        size: 0,
        target: await fs.readlink(found.host),
        mode: 0o777,
      });
      continue;
    }

    const stat = await fs.stat(found.host);
    if (stat.size > maxFileBytes) {
      // Refuse rather than truncate. A silently-skipped 2 GB file produces an
      // image that looks fine and fails at runtime for no visible reason.
      throw new PlifError(
        'INVALID_ARGUMENT',
        `${found.virtual} is ${formatBytes(stat.size)}, over the ${formatBytes(maxFileBytes)} layer file limit`,
        {
          detail: { path: found.virtual, size: stat.size },
          hint: 'Exclude it from the layer and mount it at runtime instead.',
        },
      );
    }

    const data = await fs.readFile(found.host);
    const fileDigest = await content.put(data);
    entries.push({
      path: virtual,
      kind: 'file',
      size: data.byteLength,
      digest: fileDigest,
      mode: found.mode,
    });
  }

  return await layerStore.create(options.name, entries);
}

// ---------------------------------------------------------------------------

interface WalkEntry {
  readonly host: string;
  /** Path relative to the walk root, POSIX-separated, leading slash. */
  readonly virtual: string;
  readonly kind: 'file' | 'directory' | 'symlink';
  readonly mode: number;
}

async function* walk(
  root: string,
  current: string,
  exclude: ReadonlySet<string> = new Set(),
): AsyncGenerator<WalkEntry> {
  let dirents;
  try {
    dirents = await fs.readdir(current, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  for (const dirent of dirents) {
    const host = path.join(current, dirent.name);
    const virtual = '/' + path.relative(root, host).split(path.sep).join('/');
    if ([...exclude].some((pattern) => globBasename(pattern, dirent.name))) continue;

    if (dirent.isSymbolicLink()) {
      yield { host, virtual, kind: 'symlink', mode: 0o777 };
      // Deliberately not recursed into: following links during a walk is how
      // a build ends up ingesting the whole drive, or loops forever.
      continue;
    }
    if (dirent.isDirectory()) {
      yield { host, virtual, kind: 'directory', mode: 0o755 };
      yield* walk(root, host, exclude);
      continue;
    }
    if (dirent.isFile()) {
      let stat;
      try {
        stat = await fs.stat(host);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        stat = null;
      }
      yield { host, virtual, kind: 'file', mode: stat ? stat.mode & 0o777 : 0o644 };
    }
    // Sockets, FIFOs and devices are intentionally dropped: they cannot be
    // content-addressed, and an image is meant to be reproducible.
  }
}

function globBasename(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name;
  const regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regex}$`).test(name);
}

function resolveInto(root: string, virtual: string): string {
  const normalized = normalizeVirtualPath(virtual);
  const target = path.resolve(root, ...normalized.split('/').filter(Boolean));
  // Defence in depth: the manifest is trusted, but a tampered one must not be
  // able to write outside the rootfs.
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PlifError('PATH_ESCAPE', `layer entry escapes the rootfs: ${virtual}`, {
      detail: { virtual, root },
    });
  }
  return target;
}

async function markReadOnly(target: string): Promise<void> {
  try {
    await fs.chmod(target, 0o444);
  } catch {
    // chmod is advisory on Windows for anything but the read-only bit, and may
    // fail on some filesystems. The mode is a guard rail, not the boundary.
  }
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
