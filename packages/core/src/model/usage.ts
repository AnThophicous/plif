/**
 * Provider usage is deliberately a capability, not a guessed quota table.
 *
 * A provider may expose request/token limits in response headers, an official
 * usage endpoint, or nothing at all. The normalized shape keeps those cases
 * explicit so the CLI never turns a missing number into a fictional limit.
 */

export type UsageStatus = 'available' | 'unsupported' | 'unavailable' | 'unknown' | 'unlimited';
export type UsageUnit = 'requests' | 'tokens' | 'credits' | 'unknown';
export type UsageSource = 'headers' | 'api' | 'sdk' | 'config';

/** Usage is observational; do not poll an endpoint more often than this. */
export const USAGE_CACHE_TTL_MS = 30_000;

export interface UsageWindow {
  readonly type: string;
  readonly unit: UsageUnit;
  /** Currency is present only when a provider defines credits as money. */
  readonly currency?: string;
  readonly limit?: number | 'unlimited';
  readonly used?: number;
  readonly remaining?: number;
  /** Explicit provider declaration that this window has no finite ceiling. */
  readonly unlimited?: boolean;
  readonly percentage?: number;
  readonly resetAt?: string;
  readonly source: UsageSource;
}

export interface UsageInfo {
  readonly provider: string;
  readonly model: string;
  readonly plan?: string;
  readonly status: UsageStatus;
  readonly windows: readonly UsageWindow[];
  readonly source?: UsageSource;
  readonly detail?: string;
  readonly fetchedAt: number;
}

const LIMIT_HEADERS: Readonly<Record<UsageUnit, readonly string[]>> = {
  requests: ['x-ratelimit-limit-requests', 'x-ratelimit-limit-request'],
  tokens: ['x-ratelimit-limit-tokens'],
  credits: ['x-ratelimit-limit-credits'],
  unknown: [],
};

const REMAINING_HEADERS: Readonly<Record<UsageUnit, readonly string[]>> = {
  requests: ['x-ratelimit-remaining-requests', 'x-ratelimit-remaining-request'],
  tokens: ['x-ratelimit-remaining-tokens'],
  credits: ['x-ratelimit-remaining-credits'],
  unknown: [],
};

const RESET_HEADERS: Readonly<Record<UsageUnit, readonly string[]>> = {
  requests: ['x-ratelimit-reset-requests', 'x-ratelimit-reset-request'],
  tokens: ['x-ratelimit-reset-tokens'],
  credits: ['x-ratelimit-reset-credits'],
  unknown: [],
};

function headerValue(headers: Headers, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function finiteNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isUnlimited(value: string | undefined): boolean {
  return value !== undefined && /^(?:-1|unlimited|infinite|infinity|∞)$/i.test(value.trim());
}

/** Return a cached snapshot only while it is young enough to be meaningful. */
export function freshUsageSnapshot(
  snapshot: UsageInfo | undefined,
  now = Date.now(),
): UsageInfo | undefined {
  if (!snapshot || !Number.isFinite(snapshot.fetchedAt)) return undefined;
  const age = now - snapshot.fetchedAt;
  return age >= 0 && age < USAGE_CACHE_TTL_MS ? snapshot : undefined;
}

/** Parse common provider reset values without assuming one provider's format. */
export function resetAtFromHeader(value: string | undefined, now = Date.now()): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return undefined;
    const timestamp = numeric > 100_000_000_000 ? numeric : numeric > 1_000_000_000 ? numeric * 1_000 : now + numeric * 1_000;
    return new Date(timestamp).toISOString();
  }

  let matched = false;
  let milliseconds = 0;
  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/gi;
  for (const match of trimmed.matchAll(pattern)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (!Number.isFinite(amount)) continue;
    milliseconds += amount * (unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
  }
  return matched && milliseconds >= 0 ? new Date(now + milliseconds).toISOString() : undefined;
}

/** Convert standard rate-limit headers into the provider-neutral shape. */
export function usageFromRateLimitHeaders(
  provider: string,
  model: string,
  headers: Headers,
  options: { readonly plan?: string; readonly now?: number } = {},
): UsageInfo {
  const now = options.now ?? Date.now();
  const windows: UsageWindow[] = [];
  let sawUsageHeader = false;
  for (const unit of ['requests', 'tokens', 'credits'] as const) {
    const limitHeader = headerValue(headers, LIMIT_HEADERS[unit]);
    const remainingHeader = headerValue(headers, REMAINING_HEADERS[unit]);
    const resetHeader = headerValue(headers, RESET_HEADERS[unit]);
    sawUsageHeader ||= limitHeader !== undefined || remainingHeader !== undefined || resetHeader !== undefined;
    const unlimited = isUnlimited(limitHeader) || isUnlimited(remainingHeader);
    const limit = unlimited ? undefined : finiteNumber(limitHeader);
    const remaining = unlimited ? undefined : finiteNumber(remainingHeader);
    const resetAt = resetAtFromHeader(resetHeader, now);
    if (limit === undefined && remaining === undefined && resetAt === undefined && !unlimited) continue;
    const used = limit !== undefined && remaining !== undefined ? Math.max(0, limit - remaining) : undefined;
    const percentage = limit !== undefined && remaining !== undefined && limit > 0
      ? Math.min(100, Math.max(0, Math.round(((limit - remaining) / limit) * 100)))
      : undefined;
    windows.push({
      type: unit === 'requests' ? 'request limit' : unit === 'tokens' ? 'token limit' : 'credit limit',
      unit,
      ...(limit === undefined ? {} : { limit }),
      ...(used === undefined ? {} : { used }),
      ...(remaining === undefined ? {} : { remaining }),
      ...(unlimited ? { unlimited: true, limit: 'unlimited' as const } : {}),
      ...(percentage === undefined ? {} : { percentage }),
      ...(resetAt ? { resetAt } : {}),
      source: 'headers',
    });
  }
  return {
    provider,
    model,
    ...(options.plan ? { plan: options.plan } : {}),
    status: windows.length === 0
      ? sawUsageHeader ? 'unknown' : 'unsupported'
      : windows.every((window) => window.unlimited === true) ? 'unlimited' : 'available',
    windows,
    ...(windows.length > 0 ? { source: 'headers' as const } : {}),
    ...(windows.length > 0
      ? {}
      : {
          detail: sawUsageHeader
            ? 'This provider exposed usage headers, but their values were not interpretable.'
            : 'This provider did not expose usage or rate-limit headers on the latest response.',
        }),
    fetchedAt: now,
  };
}

export function unavailableUsage(
  provider: string,
  model: string,
  detail: string,
  now = Date.now(),
): UsageInfo {
  return { provider, model, status: 'unavailable', windows: [], detail, fetchedAt: now };
}

/**
 * Official provider policy limits are useful even when live account counters
 * are not exposed. Keep this registry explicit and narrow: an absent provider
 * remains unsupported instead of receiving a guessed quota.
 */
export function providerPolicyUsage(
  provider: string,
  model: string,
  now = Date.now(),
): UsageInfo | undefined {
  if (provider !== 'opencode-go') return undefined;
  return {
    provider,
    model,
    plan: 'OpenCode Go',
    status: 'available',
    source: 'config',
    windows: [
      { type: '5-hour', unit: 'credits', currency: 'USD', limit: 12, source: 'config' },
      { type: 'weekly', unit: 'credits', currency: 'USD', limit: 30, source: 'config' },
      { type: 'monthly', unit: 'credits', currency: 'USD', limit: 60, source: 'config' },
    ],
    detail: 'Official provider policy limits. Live account consumption is not exposed by the model endpoint.',
    fetchedAt: now,
  };
}
