/**
 * On-disk layout of a Plif root.
 *
 * Everything Plif persists lives under one directory so that "delete this
 * folder" is a complete uninstall, and so the whole state of the engine can be
 * copied, inspected or thrown away as a unit.
 *
 *   <root>/
 *     blobs/sha256/<ab>/<digest>     content-addressed file bodies, shared
 *     layers/<digest>.json           layer manifests
 *     images/<digest>.json           image manifests
 *     tags.json                      "name:tag" -> image digest
 *     containers/<id>/
 *       spec.json                    what was requested
 *       status.json                  what happened
 *       rootfs/                      the materialised union view — this is both
 *                                    what processes run against and the
 *                                    writable layer that `commit` diffs
 *     audit/<yyyy-mm-dd>.jsonl       append-only decision log
 */

import path from 'node:path';

export class StorePaths {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  get blobs(): string {
    return path.join(this.root, 'blobs', 'sha256');
  }

  /**
   * Blobs are sharded on the first two hex characters. A flat directory of
   * hundreds of thousands of files makes directory enumeration on NTFS
   * pathologically slow, and every layer operation enumerates.
   */
  blob(digest: string): string {
    return path.join(this.blobs, digest.slice(0, 2), digest);
  }

  get layers(): string {
    return path.join(this.root, 'layers');
  }

  layer(digest: string): string {
    return path.join(this.layers, `${digest}.json`);
  }

  get images(): string {
    return path.join(this.root, 'images');
  }

  image(digest: string): string {
    return path.join(this.images, `${digest}.json`);
  }

  get tags(): string {
    return path.join(this.root, 'tags.json');
  }

  get containers(): string {
    return path.join(this.root, 'containers');
  }

  container(id: string): string {
    return path.join(this.containers, id);
  }

  containerSpec(id: string): string {
    return path.join(this.container(id), 'spec.json');
  }

  containerStatus(id: string): string {
    return path.join(this.container(id), 'status.json');
  }

  containerRootfs(id: string): string {
    return path.join(this.container(id), 'rootfs');
  }

  /**
   * Conversations, sharded by a hash of the workspace they belong to.
   *
   * The shard is what makes `plif sessions` in a project a directory listing
   * rather than a scan of every conversation the user has ever had.
   */
  get sessions(): string {
    return path.join(this.root, 'sessions');
  }

  get audit(): string {
    return path.join(this.root, 'audit');
  }

  /** When the registry was last asked whether a newer plif exists. */
  get updateCheck(): string {
    return path.join(this.root, 'update-check.json');
  }

  auditFile(date: Date): string {
    const stamp = date.toISOString().slice(0, 10);
    return path.join(this.audit, `${stamp}.jsonl`);
  }

  /** Every directory that must exist before the engine can run. */
  bootstrapDirs(): string[] {
    return [this.blobs, this.layers, this.images, this.containers, this.sessions, this.audit];
  }
}
