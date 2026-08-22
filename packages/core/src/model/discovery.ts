/**
 * Provider-owned model discovery.
 *
 * A static catalog is metadata and a fallback, never proof that a model is
 * usable. Live results are cached on disk without credentials, served stale
 * while a refresh runs, and deduplicated per provider/endpoint/credential.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findCatalogProvider, rankModelIds } from './catalog.js';
import { PRESETS, resolveConfig, type ModelConfig, type StoredConfig } from './config.js';
import { createModelProvider } from './factory.js';
import type { ModelSource, ProviderModel } from './provider.js';
import { globalConfigPath } from '../config/global.js';

export const DISCOVERY_TTL_MS = 15 * 60_000;
const DISCOVERY_TIMEOUT_MS = 4_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;
// Provenance and cost semantics were added to cached model rows. Never trust a
// pre-metadata cache as a current authorization decision.
const CACHE_VERSION = 2;

export type DiscoverySource = 'live' | 'cache' | 'fallback';

export interface DiscoveredModels {
  readonly ids: readonly string[];
  readonly models: readonly ProviderModel[];
  /** True when the provider answered successfully, including an empty list. */
  readonly live: boolean;
  readonly source: DiscoverySource;
  readonly discoveredAt: number;
  readonly stale: boolean;
  readonly sourceInfo?: ModelSource;
  readonly error?: 'timeout' | 'rate_limit' | 'unauthorized' | 'unavailable' | 'unsupported';
}

export interface DiscoverOptions {
  readonly apiKey?: string;
  readonly stored?: StoredConfig;
  readonly timeoutMs?: number;
  /** Skips the fresh-cache path. For a deliberate refresh, not ordinary opening. */
  readonly refresh?: boolean;
  /** Return immediately on a cache miss and refresh in the background. */
  readonly waitForNetwork?: boolean;
  /** Test isolation and controlled embedding; defaults beside config.toml. */
  readonly cacheFile?: string;
}

interface DiskEntry {
  readonly key: string;
  readonly providerId: string;
  readonly discoveredAt: number;
  readonly ids: readonly string[];
  readonly models: readonly ProviderModel[];
  readonly sourceInfo?: ModelSource;
}

interface DiskShape {
  readonly version: number;
  readonly entries: readonly DiskEntry[];
}

interface FailureState {
  count: number;
  retryAt: number;
}

interface ProbeResult {
  readonly supported: boolean;
  readonly models: readonly ProviderModel[];
  readonly sourceInfo?: ModelSource;
  readonly error?: DiscoveredModels['error'];
}

const cache = new Map<string, DiscoveredModels>();
const inFlight = new Map<string, Promise<DiscoveredModels>>();
const failures = new Map<string, FailureState>();
const loadedFiles = new Set<string>();
let persistChain: Promise<void> = Promise.resolve();

function defaultCacheFile(): string {
  return path.join(path.dirname(globalConfigPath()), 'model-cache.json');
}

/**
 * Return the provider's current catalog. A stale value is usable immediately;
 * its refresh is intentionally detached so opening /models never blocks on a
 * slow provider.
 */
export async function discoverProviderModels(
  providerId: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredModels> {
  let config: ModelConfig;
  try {
    config = resolveConfig(options.stored ?? {}, {
      preset: providerId,
      model: 'list',
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    });
  } catch {
    return fallbackResult();
  }

  const cacheFile = path.resolve(options.cacheFile ?? defaultCacheFile());
  await loadPersistentCache(cacheFile);
  const key = discoveryCacheKey(providerId, config);
  const cached = cache.get(key);
  const now = Date.now();

  if (cached && !options.refresh && now - cached.discoveredAt < DISCOVERY_TTL_MS) {
    return { ...cached, source: 'live', stale: false };
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  // Stale-while-revalidate is the normal picker path. Explicit refresh waits.
  if (cached && !options.refresh) {
    if (canRetry(key, now)) void refreshProvider(providerId, config, key, cacheFile, cached);
    return { ...cached, source: 'cache', stale: true };
  }

  if (!cached && options.waitForNetwork === false) {
    if (canRetry(key, now)) void refreshProvider(providerId, config, key, cacheFile);
    return fallbackResult();
  }

  return refreshProvider(providerId, config, key, cacheFile, cached);
}

/** Start a low-frequency background scan. Returns a cleanup function. */
export function scheduleProviderDiscovery(
  providers: readonly string[],
  options: Omit<DiscoverOptions, 'refresh'> & {
    readonly intervalMs?: number;
    readonly resolve?: (providerId: string) => Promise<Pick<DiscoverOptions, 'apiKey' | 'stored'>>;
    readonly onChange?: (result: DiscoveredModels) => void;
  } = {},
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interval = Math.max(DISCOVERY_TTL_MS, options.intervalMs ?? DISCOVERY_TTL_MS);
  const run = async (): Promise<void> => {
    if (stopped) return;
    for (const providerId of [...new Set(providers)]) {
      if (stopped) return;
      const resolved = options.resolve ? await options.resolve(providerId) : {};
      const result = await discoverProviderModels(providerId, { ...options, ...resolved });
      if (result.source === 'live' && !result.stale) options.onChange?.(result);
    }
    if (!stopped) {
      const jitter = Math.floor(interval * 0.1 * Math.random());
      timer = setTimeout(() => void run(), interval + jitter);
      timer.unref?.();
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Drop discovery memory for a provider after its credential changes. */
export function forgetDiscoveredModels(providerId?: string): void {
  if (!providerId) {
    cache.clear();
    failures.clear();
    loadedFiles.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${providerId}\0`)) cache.delete(key);
  }
  for (const key of failures.keys()) {
    if (key.startsWith(`${providerId}\0`)) failures.delete(key);
  }
  // The next lookup may need to restore a last-known-good entry from disk.
  // Forgetting only the in-memory value would otherwise make the persistent
  // cache unreachable for the lifetime of the process.
  loadedFiles.clear();
}

async function refreshProvider(
  providerId: string,
  config: ModelConfig,
  key: string,
  cacheFile: string,
  previous?: DiscoveredModels,
): Promise<DiscoveredModels> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = (async (): Promise<DiscoveredModels> => {
    try {
      const result = await probeProvider(config, providerId);
      if (!result.supported) {
        noteFailure(key);
        return failureResult(previous, result.error ?? 'unsupported');
      }
      const ids = rankModelIds(providerId, result.models.map((model) => model.id));
      const models = ids.map((id) => result.models.find((model) => model.id === id) ?? { id });
      const next: DiscoveredModels = {
        ids,
        models,
        live: true,
        source: 'live',
        discoveredAt: Date.now(),
        stale: false,
        ...(result.sourceInfo ? { sourceInfo: result.sourceInfo } : {}),
      };
      cache.set(key, next);
      failures.delete(key);
      await persistCache(cacheFile);
      return next;
    } catch (error) {
      noteFailure(key);
      const kind = error instanceof DiscoveryTimeoutError ? 'timeout' : 'unavailable';
      return failureResult(previous ?? cache.get(key), kind);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

async function probeProvider(config: ModelConfig, providerId: string): Promise<ProbeResult> {
  const preset = PRESETS[providerId as keyof typeof PRESETS];
  const anonymous = findCatalogProvider(providerId)?.anonymous ?? false;
  if (preset && !anonymous && !config.apiKey) return { supported: false, models: [] };
  const provider = createModelProvider(config);
  if (provider.listModels) {
    const result = await withTimeout(provider.listModels(), Math.min(
      DISCOVERY_TIMEOUT_MS,
      Math.max(100, config.timeoutMs),
    ));
    return { ...result, ...(result.source ? { sourceInfo: result.source } : {}) };
  }
  const ids = await withTimeout(provider.list(), DISCOVERY_TIMEOUT_MS);
  return {
    supported: ids.length > 0,
    models: ids.map((id) => ({ id, provider: providerId })),
    sourceInfo: { provider: providerId, endpoint: config.baseURL },
    ...(ids.length > 0 ? {} : { error: 'unsupported' as const }),
  };
}

function discoveryCacheKey(providerId: string, config: ModelConfig): string {
  const target = createHash('sha256')
    .update(config.baseURL, 'utf8')
    .update('\0')
    .update(config.apiKey, 'utf8')
    .digest('hex')
    .slice(0, 20);
  return `${providerId}\0${target}`;
}

function fallbackResult(): DiscoveredModels {
  return { ids: [], models: [], live: false, source: 'fallback', discoveredAt: 0, stale: true };
}

function failureResult(
  previous: DiscoveredModels | undefined,
  error: DiscoveredModels['error'],
): DiscoveredModels {
  if (!previous) return { ...fallbackResult(), error };
  return { ...previous, source: 'cache', stale: true, error };
}

function canRetry(key: string, now: number): boolean {
  return (failures.get(key)?.retryAt ?? 0) <= now;
}

function noteFailure(key: string): void {
  const failure = failures.get(key) ?? { count: 0, retryAt: 0 };
  failure.count += 1;
  failure.retryAt = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failure.count - 1));
  failures.set(key, failure);
}

class DiscoveryTimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new DiscoveryTimeoutError()), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadPersistentCache(file: string): Promise<void> {
  if (loadedFiles.has(file)) return;
  loadedFiles.add(file);
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as DiskShape;
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) return;
    for (const entry of parsed.entries) {
      if (!entry || typeof entry.key !== 'string' || !Array.isArray(entry.ids)) continue;
      const ids = entry.ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
      const models = Array.isArray(entry.models)
        ? entry.models.filter((model: ProviderModel) => model && typeof model.id === 'string')
        : ids.map((id: string) => ({ id }));
      cache.set(entry.key, {
        ids: Object.freeze([...ids]),
        models: Object.freeze([...models]),
        live: true,
        source: 'cache',
        discoveredAt: Number.isFinite(entry.discoveredAt) ? entry.discoveredAt : 0,
        stale: true,
        ...(entry.sourceInfo ? { sourceInfo: entry.sourceInfo } : {}),
      });
    }
  } catch {
    // An invalid or interrupted cache is disposable. The provider remains usable.
  }
}

function persistCache(file: string): Promise<void> {
  const write = persistChain.catch(() => undefined).then(async () => {
    const entries: DiskEntry[] = [...cache.entries()].map(([key, result]) => ({
      key,
      providerId: key.split('\0', 1)[0] ?? '',
      discoveredAt: result.discoveredAt,
      ids: result.ids,
      models: result.models,
      ...(result.sourceInfo ? { sourceInfo: result.sourceInfo } : {}),
    }));
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, entries }, null, 2), 'utf8');
    await rename(temporary, file);
  });
  // Disk cache is an optimisation. A read-only home directory or an interrupted
  // rename must never turn a successful provider response into a picker error.
  persistChain = write.then(() => undefined, () => undefined);
  return persistChain;
}
