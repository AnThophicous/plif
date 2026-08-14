import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 32;

/** Wire-level reasoning levels that an endpoint can accept. */
export type CachedEffort = 'max' | 'xhigh' | 'high' | 'medium' | 'low';
const EFFORTS: ReadonlySet<CachedEffort> = new Set(['max', 'xhigh', 'high', 'medium', 'low']);

export interface CapabilityEntry {
  readonly endpointHash: string;
  readonly model: string;
  readonly effort: CachedEffort;
  readonly acceptedAt: number;
}

export interface ProviderCapabilityCacheOptions {
  /** Omit for a process-local cache, useful for tests and embedded callers. */
  readonly file?: string;
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly entries?: readonly CapabilityEntry[];
}

export interface EffortCapabilityCache {
  get(endpoint: string, model: string): CachedEffort | undefined | Promise<CachedEffort | undefined>;
  set(endpoint: string, model: string, effort: CachedEffort): void | Promise<void>;
  invalidate?(endpoint: string, model: string): void | Promise<void>;
}

function endpointHash(endpoint: string): string {
  let normalized = endpoint.trim().replace(/\/+$/, '');
  try {
    const url = new URL(endpoint);
    // An endpoint is a capability identity, not a credential identity. Never
    // let userinfo survive into the persisted key.
    url.username = '';
    url.password = '';
    url.hash = '';
    normalized = url.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    normalized = normalized.toLowerCase();
  }
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function validEntry(value: unknown): value is CapabilityEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CapabilityEntry>;
  return typeof entry.endpointHash === 'string' && /^[a-f0-9]{64}$/.test(entry.endpointHash) &&
    typeof entry.model === 'string' && entry.model.length > 0 &&
    typeof entry.effort === 'string' && EFFORTS.has(entry.effort) &&
    typeof entry.acceptedAt === 'number' && Number.isFinite(entry.acceptedAt);
}

function keyFor(endpoint: string, model: string): string {
  return `${endpointHash(endpoint)}\u0000${model}`;
}

/**
 * Bounded, redacted effort capability cache. The public key is endpoint/model;
 * the file stores only the endpoint hash, so credentials and request content
 * can never enter this diagnostic optimisation.
 */
export class ProviderCapabilityCache implements EffortCapabilityCache {
  readonly #file: string | undefined;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, CapabilityEntry>();
  #loaded = false;
  #loadPromise: Promise<void> | undefined;
  #writePromise: Promise<void> = Promise.resolve();

  constructor(options: ProviderCapabilityCacheOptions = {}) {
    this.#file = options.file;
    this.#now = options.now ?? Date.now;
    this.#ttlMs = Math.max(1, options.ttlMs ?? CAPABILITY_TTL_MS);
    this.#maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
    for (const entry of options.entries ?? []) {
      if (validEntry(entry)) this.#entries.set(`${entry.endpointHash}\u0000${entry.model}`, entry);
    }
    this.#trim();
    if (!this.#file) this.#loaded = true;
  }

  async get(endpoint: string, model: string): Promise<CachedEffort | undefined> {
    await this.#load();
    const entry = this.#entries.get(keyFor(endpoint, model));
    if (!entry) return undefined;
    if (this.#now() - entry.acceptedAt >= this.#ttlMs) {
      this.#entries.delete(keyFor(endpoint, model));
      await this.#persist();
      return undefined;
    }
    return entry.effort;
  }

  async set(endpoint: string, model: string, effort: CachedEffort): Promise<void> {
    await this.#load();
    if (!model || !EFFORTS.has(effort)) return;
    const entry: CapabilityEntry = {
      endpointHash: endpointHash(endpoint),
      model,
      effort,
      acceptedAt: this.#now(),
    };
    this.#entries.delete(`${entry.endpointHash}\u0000${model}`);
    this.#entries.set(`${entry.endpointHash}\u0000${model}`, entry);
    this.#trim();
    await this.#persist();
  }

  async invalidate(endpoint: string, model: string): Promise<void> {
    await this.#load();
    if (this.#entries.delete(keyFor(endpoint, model))) await this.#persist();
  }

  /** Snapshot for diagnostics/tests; it contains hashes, never raw endpoints. */
  async entries(): Promise<readonly CapabilityEntry[]> {
    await this.#load();
    return [...this.#entries.values()];
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    if (this.#loadPromise) return this.#loadPromise;
    this.#loadPromise = (async () => {
      try {
        const raw = await fs.readFile(this.#file!, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        const values = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { version?: unknown; entries?: unknown }).entries
          : undefined;
        if (Array.isArray(values)) {
          for (const value of values) {
            if (!validEntry(value)) continue;
            if (this.#now() - value.acceptedAt >= this.#ttlMs) continue;
            this.#entries.set(`${value.endpointHash}\u0000${value.model}`, value);
          }
        }
      } catch (error) {
        // A corrupt or unavailable optimisation cache is not a model failure.
        // It is simply treated as empty and replaced on the next successful
        // negotiation. ENOENT is the normal first-run path.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.#entries.clear();
        }
      } finally {
        this.#trim();
        this.#loaded = true;
      }
    })();
    await this.#loadPromise;
  }

  #trim(): void {
    const ordered = [...this.#entries.values()].sort((a, b) => b.acceptedAt - a.acceptedAt);
    this.#entries.clear();
    for (const entry of ordered.slice(0, this.#maxEntries)) {
      this.#entries.set(`${entry.endpointHash}\u0000${entry.model}`, entry);
    }
  }

  async #persist(): Promise<void> {
    if (!this.#file) return;
    const payload = JSON.stringify({
      version: CACHE_VERSION,
      entries: [...this.#entries.values()],
    }, null, 2) + '\n';
    this.#writePromise = this.#writePromise.then(async () => {
      await fs.mkdir(path.dirname(this.#file!), { recursive: true });
      const temporary = `${this.#file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, payload, 'utf8');
      await fs.rename(temporary, this.#file!);
      await fs.chmod(this.#file!, 0o600).catch(() => undefined);
    });
    await this.#writePromise;
  }
}

/** Small synchronous cache seam for provider tests and embedded runtimes. */
export function memoryCapabilityCache(seed?: {
  readonly endpoint?: string;
  readonly model?: string;
    readonly effort?: CachedEffort;
}): EffortCapabilityCache {
  const values = new Map<string, CachedEffort>();
  if (seed?.endpoint && seed.model && seed.effort) {
    values.set(keyFor(seed.endpoint, seed.model), seed.effort);
  }
  return {
    get: (endpoint, model) => values.get(keyFor(endpoint, model)),
    set: (endpoint, model, effort) => {
      values.set(keyFor(endpoint, model), effort);
    },
    invalidate: (endpoint, model) => {
      values.delete(keyFor(endpoint, model));
    },
  };
}

export function capabilityEndpointHash(endpoint: string): string {
  return endpointHash(endpoint);
}
