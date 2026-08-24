import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  freshUsageSnapshot,
  providerPolicyUsage,
  resetAtFromHeader,
  USAGE_CACHE_TTL_MS,
  usageFromRateLimitHeaders,
} from '../src/model/usage.js';

describe('normalized provider usage', () => {
  it('normalizes request and token rate-limit headers without a network call', () => {
    const headers = new Headers({
      'x-ratelimit-limit-requests': '100',
      'x-ratelimit-remaining-requests': '63',
      'x-ratelimit-reset-requests': '1m',
      'x-ratelimit-limit-tokens': '10000',
      'x-ratelimit-remaining-tokens': '7500',
      'x-ratelimit-reset-tokens': '90s',
    });
    const usage = usageFromRateLimitHeaders('bridge', 'model', headers, { now: 1_700_000_000_000 });

    assert.equal(usage.status, 'available');
    assert.equal(usage.source, 'headers');
    assert.deepEqual(usage.windows.map((window) => ({
      unit: window.unit,
      limit: window.limit,
      used: window.used,
      remaining: window.remaining,
      percentage: window.percentage,
    })), [
      { unit: 'requests', limit: 100, used: 37, remaining: 63, percentage: 37 },
      { unit: 'tokens', limit: 10_000, used: 2_500, remaining: 7_500, percentage: 25 },
    ]);
    assert.equal(usage.windows[0]?.resetAt, new Date(1_700_000_060_000).toISOString());
  });

  it('distinguishes unsupported usage from a zero quota', () => {
    const usage = usageFromRateLimitHeaders('bridge', 'model', new Headers(), { now: 1_700_000_000_000 });
    assert.equal(usage.status, 'unsupported');
    assert.deepEqual(usage.windows, []);
    assert.match(usage.detail ?? '', /did not expose/i);
  });

  it('accepts absolute seconds and bounded duration reset formats', () => {
    assert.equal(resetAtFromHeader('1700000060', 1_700_000_000_000), new Date(1_700_000_060_000).toISOString());
    assert.equal(resetAtFromHeader('1h30m', 1_700_000_000_000), new Date(1_700_005_400_000).toISOString());
    assert.equal(resetAtFromHeader('not-a-reset', 1_700_000_000_000), undefined);
  });

  it('distinguishes malformed headers from an unsupported provider and an explicit unlimited window', () => {
    const malformed = usageFromRateLimitHeaders('bridge', 'model', new Headers({
      'x-ratelimit-limit-requests': 'not-published',
    }), { now: 1_700_000_000_000 });
    assert.equal(malformed.status, 'unknown');
    assert.match(malformed.detail ?? '', /not interpretable/i);

    const unlimited = usageFromRateLimitHeaders('bridge', 'model', new Headers({
      'x-ratelimit-limit-requests': 'unlimited',
    }), { now: 1_700_000_000_000 });
    assert.equal(unlimited.status, 'unlimited');
    assert.equal(unlimited.windows[0]?.limit, 'unlimited');
    assert.equal(unlimited.windows[0]?.unlimited, true);
  });

  it('keeps a usage snapshot only inside the explicit cache TTL', () => {
    const snapshot = usageFromRateLimitHeaders('bridge', 'model', new Headers(), { now: 1_700_000_000_000 });
    assert.equal(freshUsageSnapshot(snapshot, 1_700_000_000_000 + USAGE_CACHE_TTL_MS - 1), snapshot);
    assert.equal(freshUsageSnapshot(snapshot, 1_700_000_000_000 + USAGE_CACHE_TTL_MS), undefined);
  });

  it('exposes the documented OpenCode Go policy without inventing live counters', () => {
    const usage = providerPolicyUsage('opencode-go', 'ox-alpha-free', 1_700_000_000_000);

    assert.equal(usage?.status, 'available');
    assert.equal(usage?.plan, 'OpenCode Go');
    assert.equal(usage?.source, 'config');
    assert.deepEqual(usage?.windows.map((window) => ({
      type: window.type,
      unit: window.unit,
      currency: window.currency,
      limit: window.limit,
      used: window.used,
    })), [
      { type: '5-hour', unit: 'credits', currency: 'USD', limit: 12, used: undefined },
      { type: 'weekly', unit: 'credits', currency: 'USD', limit: 30, used: undefined },
      { type: 'monthly', unit: 'credits', currency: 'USD', limit: 60, used: undefined },
    ]);
    assert.match(usage?.detail ?? '', /live account consumption is not exposed/i);
    assert.equal(providerPolicyUsage('opencode-zen', 'deepseek-v4-flash-free', 1_700_000_000_000), undefined);
  });
});
