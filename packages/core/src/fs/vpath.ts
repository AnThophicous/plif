/**
 * The path jail.
 *
 * Containers address files with POSIX-absolute virtual paths.
 * This module is the only thing that turns one into a real host path, and it is
 * the single point where a filesystem escape would happen. Everything here is
 * written to fail closed.
 *
 * The threat model is not just "../.." — it is a model that has read a lot of
 * CVEs. On Windows in particular:
 *
 *   - reserved device names (CON, NUL, COM1, LPT1) resolve to devices, not files
 *   - alternate data streams ("file.txt:secret") hide content past a name check
 *   - 8.3 short names ("PROGRA~1") alias a long name a check may have rejected
 *   - trailing dots and spaces are silently stripped by the Win32 layer, so
 *     "secret.txt." and "secret.txt" are the same file to the OS but different
 *     strings to a naive comparison
 *   - the filesystem is case-insensitive, so string prefix checks must be too
 *   - UNC and device paths (\\?\, \\server\share) leave the local tree entirely
 *
 * And on every platform: a symlink or junction inside the jail can point out of
 * it, so the *resolved* path must be re-checked, not just the requested one.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';
import type { Mount } from '../types.js';

/** Names that address a device on Windows regardless of extension or directory. */
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/**
 * Normalise a container path into a canonical form: POSIX separators, absolute,
 * no "." or ".." components, no trailing slash (except root).
 *
 * Throws rather than clamping on escape attempts. Silently clamping "/../etc"
 * to "/etc" would turn an attack into a confusing bug report.
 */
export function normalizeVirtualPath(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new PlifError('INVALID_ARGUMENT', 'path must be a non-empty string');
  }
  if (input.includes('\0')) {
    // A NUL truncates the path in any C API underneath us; the name Node checks
    // and the name the OS opens would differ.
    throw new PlifError('PATH_ESCAPE', 'path contains a NUL byte', { detail: { input } });
  }

  const unified = input.replace(/\\/g, '/');
  if (!unified.startsWith('/')) {
    throw new PlifError('INVALID_ARGUMENT', `container paths must be absolute: ${input}`, {
      hint: 'Use a container-absolute path under the current process working tree.',
    });
  }

  const out: string[] = [];
  for (const raw of unified.split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') {
      if (out.length === 0) {
        throw new PlifError('PATH_ESCAPE', `path escapes the container root: ${input}`, {
          detail: { input },
        });
      }
      out.pop();
      continue;
    }
    assertSafeComponent(raw, input);
    out.push(raw);
  }
  return '/' + out.join('/');
}

function assertSafeComponent(component: string, original: string): void {
  if (process.platform !== 'win32') return;

  // Trailing dots and spaces are stripped by Win32, aliasing two distinct
  // strings onto one file. Reject rather than guess which one was meant.
  if (/[. ]$/.test(component)) {
    throw new PlifError(
      'PATH_ESCAPE',
      `path component "${component}" ends with a dot or space, which Windows silently strips`,
      { detail: { original, component } },
    );
  }
  // Alternate data streams: everything after ':' is a hidden stream.
  if (component.includes(':')) {
    throw new PlifError(
      'PATH_ESCAPE',
      `path component "${component}" contains ':' (alternate data stream)`,
      { detail: { original, component } },
    );
  }
  // 8.3 short names alias long names past a prefix check.
  if (/~\d/.test(component)) {
    throw new PlifError(
      'PATH_ESCAPE',
      `path component "${component}" looks like an 8.3 short name`,
      {
        detail: { original, component },
        hint: 'Use the full long name for this directory.',
      },
    );
  }
  const base = component.split('.')[0]?.toLowerCase() ?? '';
  if (WINDOWS_RESERVED.has(base)) {
    throw new PlifError(
      'PATH_ESCAPE',
      `path component "${component}" is a reserved Windows device name`,
      { detail: { original, component } },
    );
  }
}

/** Case-fold for comparison on filesystems that ignore case. */
function fold(value: string): string {
  return CASE_INSENSITIVE ? value.toLowerCase() : value;
}

/**
 * True when `child` is `parent` or lives beneath it.
 *
 * Compares component-wise rather than by string prefix. A prefix check says
 * "C:\work-secrets" is inside "C:\work"; this does not.
 */
export function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return !rel.split(path.sep).includes('..');
}

export interface ResolvedPath {
  /** Canonical container path. */
  readonly virtual: string;
  /** Absolute host path, with symlinks resolved as far as the path exists. */
  readonly host: string;
  /** The mount this path fell through to, or null for the writable layer. */
  readonly mount: Mount | null;
  readonly writable: boolean;
}

export interface JailConfig {
  /** Host directory backing the container's writable layer. */
  readonly upperDir: string;
  /** Host directories holding read-only image layers, highest priority first. */
  readonly lowerDirs: readonly string[];
  readonly mounts: readonly Mount[];
}

/**
 * Resolves virtual paths against a container's mount table and layer stack.
 *
 * Resolution order matters and mirrors a union filesystem: an explicit mount
 * wins over the layer stack, because a mount is an operator's deliberate
 * statement about where real data lives.
 */
export class PathJail {
  #config: JailConfig;
  /** Mounts sorted longest-target-first so nested mounts resolve first. */
  #mounts: readonly Mount[];

  constructor(config: JailConfig) {
    this.#config = {
      upperDir: path.resolve(config.upperDir),
      lowerDirs: config.lowerDirs.map((dir) => path.resolve(dir)),
      mounts: config.mounts,
    };
    this.#mounts = [...config.mounts].sort((a, b) => b.target.length - a.target.length);
    for (const mount of this.#mounts) {
      normalizeVirtualPath(mount.target);
      if (!path.isAbsolute(mount.source)) {
        throw new PlifError('INVALID_ARGUMENT', `mount source must be absolute: ${mount.source}`);
      }
    }
    this.#assertNoOverlappingMounts();
  }

  #assertNoOverlappingMounts(): void {
    const seen: string[] = [];
    for (const mount of this.#mounts) {
      const target = normalizeVirtualPath(mount.target);
      if (seen.includes(target)) {
        throw new PlifError('MOUNT_CONFLICT', `two mounts share the target ${target}`, {
          detail: { target },
        });
      }
      seen.push(target);
    }
  }

  /** The mount owning this virtual path, or null if it belongs to the layers. */
  #findMount(virtual: string): Mount | null {
    for (const mount of this.#mounts) {
      const target = normalizeVirtualPath(mount.target);
      if (virtual === target || virtual.startsWith(target === '/' ? '/' : target + '/')) {
        return mount;
      }
    }
    return null;
  }

  /** True when the path is masked by its mount's `mask` list. */
  #isMasked(virtual: string, mount: Mount): boolean {
    if (!mount.mask?.length) return false;
    const target = normalizeVirtualPath(mount.target);
    const relative = virtual.slice(target.length) || '/';
    return mount.mask.some((entry) => {
      const masked = normalizeVirtualPath(entry.startsWith('/') ? entry : '/' + entry);
      return relative === masked || relative.startsWith(masked + '/');
    });
  }

  /**
   * Resolve for reading. Walks mount first, then the layer stack top-down, and
   * returns the first location that exists.
   */
  async resolveRead(input: string): Promise<ResolvedPath> {
    const virtual = normalizeVirtualPath(input);
    const mount = this.#findMount(virtual);

    if (mount) {
      if (this.#isMasked(virtual, mount)) {
        // Report as absent rather than forbidden: a masked secret should not
        // even confirm its own existence to the agent.
        throw new PlifError('PATH_NOT_FOUND', `no such file: ${virtual}`, {
          detail: { virtual, masked: true },
        });
      }
      const host = await this.#toHost(mount.source, virtual, normalizeVirtualPath(mount.target));
      return { virtual, host, mount, writable: mount.mode === 'rw' };
    }

    const upper = await this.#toHost(this.#config.upperDir, virtual, '/');
    if (await exists(upper)) {
      return { virtual, host: upper, mount: null, writable: true };
    }
    for (const lower of this.#config.lowerDirs) {
      const candidate = await this.#toHost(lower, virtual, '/');
      if (await exists(candidate)) {
        return { virtual, host: candidate, mount: null, writable: false };
      }
    }
    throw new PlifError('PATH_NOT_FOUND', `no such file: ${virtual}`, { detail: { virtual } });
  }

  /**
   * Resolve for writing. Never returns a read-only location: writes to a path
   * that currently lives in a lower layer are redirected to the writable layer,
   * which is what makes the layer stack copy-on-write.
   */
  async resolveWrite(input: string): Promise<ResolvedPath> {
    const virtual = normalizeVirtualPath(input);
    const mount = this.#findMount(virtual);

    if (mount) {
      if (this.#isMasked(virtual, mount)) {
        throw new PlifError('POLICY_DENIED', `path is masked by the mount: ${virtual}`, {
          detail: { virtual, mount: mount.target },
        });
      }
      if (mount.mode !== 'rw') {
        throw new PlifError(
          'MOUNT_READONLY',
          `${virtual} is inside a read-only mount (${mount.target})`,
          {
            detail: { virtual, mount: mount.target, source: mount.source },
            hint: `Remount with mode "rw" if the agent is meant to modify ${mount.source}.`,
          },
        );
      }
      const host = await this.#toHost(mount.source, virtual, normalizeVirtualPath(mount.target));
      return { virtual, host, mount, writable: true };
    }

    const host = await this.#toHost(this.#config.upperDir, virtual, '/');
    return { virtual, host, mount: null, writable: true };
  }

  /**
   * Map a virtual path into a host root and verify it stayed inside.
   *
   * The containment check runs against the *real* path of the deepest existing
   * ancestor. Checking only the requested string would miss a symlink halfway
   * along it, and checking the full path would fail for files not created yet.
   */
  async #toHost(hostRoot: string, virtual: string, mountTarget: string): Promise<string> {
    const relative = mountTarget === '/' ? virtual.slice(1) : virtual.slice(mountTarget.length + 1);
    const joined = path.resolve(hostRoot, ...relative.split('/').filter(Boolean));

    if (!isPathInside(joined, hostRoot)) {
      throw new PlifError('PATH_ESCAPE', `path escapes its root: ${virtual}`, {
        detail: { virtual, hostRoot, joined },
      });
    }

    const realRoot = await realpathOrSelf(hostRoot);
    const realAncestor = await deepestRealAncestor(joined);
    if (!isPathInside(realAncestor, realRoot)) {
      throw new PlifError(
        'PATH_ESCAPE',
        `path resolves outside its root through a link: ${virtual}`,
        { detail: { virtual, hostRoot: realRoot, resolved: realAncestor } },
      );
    }

    // Re-anchor onto the real root so callers get a canonical path even when
    // the root itself was reached through a link (very common: C:\Users junctions).
    const tail = path.relative(realRoot, realAncestor);
    const remainder = path.relative(realAncestor, joined);
    return path.join(realRoot, tail, remainder);
  }

  /** Host directories a sandbox jail must be allowed to write into. */
  writableHostPaths(): string[] {
    const paths = [this.#config.upperDir];
    for (const mount of this.#mounts) {
      if (mount.mode === 'rw') paths.push(path.resolve(mount.source));
    }
    return paths;
  }

  get upperDir(): string {
    return this.#config.upperDir;
  }

  /** Case-folded containment test, exposed for the policy layer. */
  static contains(parent: string, child: string): boolean {
    return isPathInside(fold(path.resolve(child)), fold(path.resolve(parent)));
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function realpathOrSelf(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Walk up until a path component exists, and return its real (link-resolved)
 * location. This is what lets a write to a not-yet-created file still be
 * checked against a symlinked parent directory.
 */
async function deepestRealAncestor(target: string): Promise<string> {
  let current = path.resolve(target);
  const parts: string[] = [];

  for (;;) {
    try {
      const real = await fs.realpath(current);
      return parts.length ? path.join(real, ...parts.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target); // hit the drive root
      parts.push(path.basename(current));
      current = parent;
    }
  }
}
