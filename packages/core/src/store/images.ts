/**
 * Layer and image manifests.
 *
 * A layer manifest lists paths and the blob digest behind each one; the blobs
 * themselves live in the ContentStore. An image manifest is an ordered list of
 * layer digests plus the runtime config. Both are content-addressed by the
 * canonical JSON of their own body, so an image digest is a genuine identity:
 * two images with the same digest behave identically, always.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';
import type { Digest, Image, ImageConfig, Layer, LayerEntry } from '../types.js';
import { DEFAULT_CAPABILITIES, DEFAULT_LIMITS } from '../types.js';
import { digestOf } from './content.js';
import type { StorePaths } from './paths.js';

/**
 * Deterministic JSON: keys sorted at every level.
 *
 * Without this, two structurally identical manifests built in different key
 * orders would hash differently and silently duplicate every layer they share.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    out[key] = sortDeep(source[key]);
  }
  return out;
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, target);
}

async function readJson<T>(target: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PlifError('MANIFEST_INVALID', `could not read ${path.basename(target)}`, {
      cause: error,
      detail: { path: target },
    });
  }
}

export class LayerStore {
  #paths: StorePaths;

  constructor(paths: StorePaths) {
    this.#paths = paths;
  }

  /** Build a manifest from entries and persist it. Returns the stored layer. */
  async create(name: string, entries: readonly LayerEntry[]): Promise<Layer> {
    // Sort by path so the digest does not depend on directory walk order.
    const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const size = sorted.reduce((total, entry) => total + entry.size, 0);

    // The digest covers content only — not the name, not the timestamp — so a
    // rebuild that produces identical files reuses the existing layer instead
    // of growing the store by a full copy.
    const digest = digestOf(canonicalJson({ entries: sorted }));

    const layer: Layer = {
      digest,
      name,
      size,
      createdAt: new Date().toISOString(),
      entries: sorted,
    };

    const existing = await this.get(digest);
    if (existing) return existing;

    await writeJsonAtomic(this.#paths.layer(digest), layer);
    return layer;
  }

  async get(digest: Digest): Promise<Layer | null> {
    return await readJson<Layer>(this.#paths.layer(digest));
  }

  async require(digest: Digest): Promise<Layer> {
    const layer = await this.get(digest);
    if (!layer) {
      throw new PlifError('LAYER_CORRUPT', `layer ${digest.slice(0, 12)} is not in the store`, {
        detail: { digest },
      });
    }
    return layer;
  }

  async list(): Promise<Layer[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.#paths.layers);
    } catch {
      return [];
    }
    const layers: Layer[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const layer = await readJson<Layer>(path.join(this.#paths.layers, file));
      if (layer) layers.push(layer);
    }
    return layers;
  }
}

export interface BuildImageInput {
  readonly reference: string;
  readonly layers: readonly Digest[];
  readonly config?: Partial<ImageConfig>;
  readonly labels?: Readonly<Record<string, string>>;
}

export class ImageStore {
  #paths: StorePaths;
  #tags: Map<string, Digest> | null = null;

  constructor(paths: StorePaths) {
    this.#paths = paths;
  }

  async #loadTags(): Promise<Map<string, Digest>> {
    if (this.#tags) return this.#tags;
    const raw = (await readJson<Record<string, Digest>>(this.#paths.tags)) ?? {};
    this.#tags = new Map(Object.entries(raw));
    return this.#tags;
  }

  async #saveTags(): Promise<void> {
    const tags = await this.#loadTags();
    await writeJsonAtomic(this.#paths.tags, Object.fromEntries(tags));
  }

  async build(input: BuildImageInput): Promise<Image> {
    const config: ImageConfig = {
      workdir: input.config?.workdir ?? '/',
      env: input.config?.env ?? {},
      entrypoint: input.config?.entrypoint ?? [],
      capabilities: { ...DEFAULT_CAPABILITIES, ...input.config?.capabilities },
      limits: { ...DEFAULT_LIMITS, ...input.config?.limits },
    };

    const body = {
      layers: input.layers,
      config,
      labels: input.labels ?? {},
    };
    const digest = digestOf(canonicalJson(body));

    const image: Image = {
      digest,
      reference: input.reference,
      createdAt: new Date().toISOString(),
      layers: input.layers,
      config,
      labels: input.labels ?? {},
    };

    await writeJsonAtomic(this.#paths.image(digest), image);
    await this.tag(input.reference, digest);
    return image;
  }

  async tag(reference: string, digest: Digest): Promise<void> {
    const tags = await this.#loadTags();
    tags.set(normalizeReference(reference), digest);
    await this.#saveTags();
  }

  /** Resolve "name:tag", a full digest, or a digest prefix of 8+ characters. */
  async resolve(reference: string): Promise<Image | null> {
    const tags = await this.#loadTags();
    const byTag = tags.get(normalizeReference(reference));
    if (byTag) return await readJson<Image>(this.#paths.image(byTag));

    if (/^[0-9a-f]{8,64}$/.test(reference)) {
      const exact = await readJson<Image>(this.#paths.image(reference));
      if (exact) return exact;

      const matches = (await this.list()).filter((image) => image.digest.startsWith(reference));
      if (matches.length === 1) return matches[0] ?? null;
      if (matches.length > 1) {
        throw new PlifError('INVALID_ARGUMENT', `image prefix "${reference}" is ambiguous`, {
          detail: { candidates: matches.map((m) => m.digest.slice(0, 12)) },
          hint: 'Use more characters of the digest, or the name:tag form.',
        });
      }
    }
    return null;
  }

  async require(reference: string): Promise<Image> {
    const image = await this.resolve(reference);
    if (!image) {
      throw new PlifError('IMAGE_NOT_FOUND', `no image matches "${reference}"`, {
        detail: { reference },
        hint: 'Run `plif image ls` to see what is in the store.',
      });
    }
    return image;
  }

  async list(): Promise<Image[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.#paths.images);
    } catch {
      return [];
    }
    const images: Image[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const image = await readJson<Image>(path.join(this.#paths.images, file));
      if (image) images.push(image);
    }
    return images.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Every tag pointing at a given digest. */
  async tagsFor(digest: Digest): Promise<string[]> {
    const tags = await this.#loadTags();
    return [...tags.entries()].filter(([, value]) => value === digest).map(([key]) => key);
  }
}

/** "plif/base" means "plif/base:latest", as in every other registry. */
export function normalizeReference(reference: string): string {
  if (!reference.includes(':')) return `${reference}:latest`;
  return reference;
}
