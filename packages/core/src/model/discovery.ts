/**
 * Asking a provider what it actually serves.
 *
 * The curated catalogue is a guess made at build time; providers rename, retire
 * and add models weekly. So the picker asks the endpoint, and only falls back
 * to the guess when the endpoint will not say.
 *
 * Two rules keep this from making `/model` worse than it was. Discovery never
 * blocks the picker for longer than a couple of seconds — a slow gateway must
 * not hold the UI hostage — and a result, including an empty one, is cached for
 * the process, because reopening the picker three times in a minute should not
 * mean three round trips.
 */

import { findCatalogProvider, rankModelIds } from './catalog.js';
import { PRESETS, resolveConfig, type StoredConfig } from './config.js';
import { createModelProvider } from './factory.js';

/** Long enough for a healthy endpoint, short enough not to feel like a hang. */
const DISCOVERY_TIMEOUT_MS = 4_000;

export interface DiscoveredModels {
  readonly ids: readonly string[];
  /** False when the list came back empty, or the endpoint refused to answer. */
  readonly live: boolean;
}

const cache = new Map<string, DiscoveredModels>();

export interface DiscoverOptions {
  readonly apiKey?: string;
  readonly stored?: StoredConfig;
  readonly timeoutMs?: number;
  /** Skips the cache. For a deliberate refresh, not for ordinary opening. */
  readonly refresh?: boolean;
}

/**
 * The model ids `providerId` advertises, ranked by how much they get used.
 *
 * Never throws. A provider that is unreachable, unauthenticated or simply does
 * not implement listing is a normal outcome here, not an error worth showing:
 * the caller falls back to the curated list and the developer sees a working
 * picker instead of a stack trace.
 */
export async function discoverProviderModels(
  providerId: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredModels> {
  const cached = cache.get(providerId);
  if (cached && !options.refresh) return cached;

  const result = await probe(providerId, options);
  cache.set(providerId, result);
  return result;
}

/** Drop what discovery remembers. Used when a key is entered or changed. */
export function forgetDiscoveredModels(providerId?: string): void {
  if (providerId) cache.delete(providerId);
  else cache.clear();
}

async function probe(providerId: string, options: DiscoverOptions): Promise<DiscoveredModels> {
  const empty: DiscoveredModels = { ids: [], live: false };
  const preset = PRESETS[providerId as keyof typeof PRESETS];
  try {
    const config = resolveConfig(options.stored ?? {}, {
      preset: providerId,
      // A model id is irrelevant to listing, but `resolveConfig` reports an
      // unusable config without one and the adapter wants something non-empty.
      model: 'list',
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    });
    // A remote that needs a credential and has none will 401 on every id it
    // would have returned. Skipping the call keeps the picker instant and the
    // curated list is the honest answer until a key is entered. Hosts that
    // serve anonymously are exempt: they have a real list to give and no key
    // to wait for.
    const anonymous = findCatalogProvider(providerId)?.anonymous ?? false;
    if (preset && !anonymous && !config.apiKey && !options.apiKey) return empty;

    const provider = createModelProvider(config);
    const ids = await Promise.race([
      provider.list(),
      new Promise<string[]>((resolve) => {
        const timer = setTimeout(() => resolve([]), options.timeoutMs ?? DISCOVERY_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    if (ids.length === 0) return empty;
    return { ids: rankModelIds(providerId, ids), live: true };
  } catch {
    return empty;
  }
}
