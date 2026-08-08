/**
 * Content-addressed blob store.
 *
 * Every distinct file body is stored exactly once under the sha256 of its
 * contents. Two images that both contain the same 40 MB toolchain binary cost
 * 40 MB, not 80. This is the whole reason layers are cheap enough to snapshot
 * an agent's workspace after every turn.
 *
 * Writes are atomic: content goes to a temp file in the same directory, is
 * fsync'd, then renamed. A crash mid-write leaves a stray temp file, never a
 * truncated blob masquerading as a valid digest.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';
import type { Digest } from '../types.js';
import type { StorePaths } from './paths.js';

export function digestOf(data: Buffer | string): Digest {
  return createHash('sha256').update(data).digest('hex');
}

export class ContentStore {
  #paths: StorePaths;

  constructor(paths: StorePaths) {
    this.#paths = paths;
  }

  /** Store a blob and return its digest. Idempotent: re-storing is a no-op. */
  async put(data: Buffer): Promise<Digest> {
    const digest = digestOf(data);
    const target = this.#paths.blob(digest);

    if (await this.has(digest)) return digest;

    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    const handle = await fs.open(temp, 'wx');
    try {
      await handle.writeFile(data);
      // Without the flush, a power loss can leave a renamed-but-empty blob,
      // which is worse than a missing one: it fails the digest check later,
      // far from the cause.
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await fs.rename(temp, target);
    } catch (error) {
      // A concurrent writer won the race with identical content. Fine.
      if (await this.has(digest)) {
        await fs.rm(temp, { force: true });
        return digest;
      }
      await fs.rm(temp, { force: true });
      throw new PlifError('INTERNAL', `failed to commit blob ${digest.slice(0, 12)}`, {
        cause: error,
      });
    }
    return digest;
  }

  async putFile(hostPath: string): Promise<{ digest: Digest; size: number }> {
    const data = await fs.readFile(hostPath);
    return { digest: await this.put(data), size: data.byteLength };
  }

  async has(digest: Digest): Promise<boolean> {
    try {
      await fs.access(this.#paths.blob(digest));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read a blob and verify it still hashes to its name.
   *
   * The re-hash is not paranoia theatre: layers are shared across every
   * container, so a single corrupted blob would silently poison every workspace
   * built from it. Better to fail loudly at read time.
   */
  async get(digest: Digest): Promise<Buffer> {
    const target = this.#paths.blob(digest);
    let data: Buffer;
    try {
      data = await fs.readFile(target);
    } catch (error) {
      throw new PlifError('LAYER_CORRUPT', `blob ${digest.slice(0, 12)} is missing`, {
        cause: error,
        detail: { digest },
        hint: 'Run `plif store gc --verify` to find and drop damaged layers.',
      });
    }
    const actual = digestOf(data);
    if (actual !== digest) {
      throw new PlifError(
        'LAYER_CORRUPT',
        `blob ${digest.slice(0, 12)} failed its integrity check`,
        { detail: { expected: digest, actual } },
      );
    }
    return data;
  }

  /**
   * Place a blob at a host path, preferring a hard link.
   *
   * Hard links are what make materialising a rootfs nearly free — a 500 MB
   * image becomes a directory of links, not a copy. The catch is that a link
   * shares its inode with the store, so a process writing through it would
   * corrupt the shared blob. Callers materialising a *writable* file must pass
   * `copy: true`; the overlay does exactly that on copy-up.
   */
  async materialize(digest: Digest, target: string, options: { copy?: boolean } = {}): Promise<void> {
    const source = this.#paths.blob(digest);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rm(target, { force: true });

    if (!options.copy) {
      try {
        await fs.link(source, target);
        return;
      } catch {
        // Cross-volume, or a filesystem without hard links. Copy instead.
      }
    }
    await fs.copyFile(source, target);
  }

  /** Total bytes held, for the store meter in the CLI. */
  async size(): Promise<{ blobs: number; bytes: number }> {
    let blobs = 0;
    let bytes = 0;
    let shards: string[];
    try {
      shards = await fs.readdir(this.#paths.blobs);
    } catch {
      return { blobs: 0, bytes: 0 };
    }
    for (const shard of shards) {
      const dir = path.join(this.#paths.blobs, shard);
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.endsWith('.tmp')) continue;
        try {
          const stat = await fs.stat(path.join(dir, entry));
          blobs += 1;
          bytes += stat.size;
        } catch {
          // vanished under us; skip
        }
      }
    }
    return { blobs, bytes };
  }
}
