import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  CAPABILITY_TTL_MS,
  ProviderCapabilityCache,
  capabilityEndpointHash,
  memoryCapabilityCache,
} from '../src/model/capabilities.js';
import { redactedProviderId, streamTiming } from '../src/model/stream-timing.js';

const ENDPOINT = 'https://user:secret@example.test/v1';
const MODEL = 'reasoning-model';

describe('provider effort capability cache', () => {
  it('reuses a valid memory capability without exposing the endpoint', () => {
    const cache = memoryCapabilityCache({ endpoint: ENDPOINT, model: MODEL, effort: 'medium' });
    assert.equal(cache.get('https://example.test/v1', MODEL), 'medium');
    assert.equal(capabilityEndpointHash(ENDPOINT).length, 64);
    assert.doesNotMatch(JSON.stringify(cache), /secret/);
  });

  it('persists only bounded, redacted entries and ignores stale data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-capability-'));
    const file = path.join(root, 'capabilities.json');
    let now = 10_000;
    const cache = new ProviderCapabilityCache({ file, maxEntries: 2, now: () => now });

    await cache.set(ENDPOINT, MODEL, 'medium');
    now += 1;
    await cache.set('https://one.example/v1', 'one', 'low');
    now += 1;
    await cache.set('https://two.example/v1', 'two', 'high');

    const raw = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(raw, /secret|example\.test\/v1/);
    assert.equal((await cache.entries()).length, 2);

    const restored = new ProviderCapabilityCache({ file, now: () => now });
    assert.equal(await restored.get('https://two.example/v1', 'two'), 'high');
    now += CAPABILITY_TTL_MS;
    assert.equal(await restored.get('https://two.example/v1', 'two'), undefined);

    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('stream timing redaction', () => {
  it('keeps only provider/model identifiers and bounded timing fields', () => {
    assert.equal(redactedProviderId(ENDPOINT), 'example.test');
    const timing = streamTiming({
      phase: 'first-delta',
      elapsedMs: -3,
      provider: 'example.test',
      model: MODEL,
      bytes: 12,
      deltaKind: 'reasoning',
    });
    assert.deepEqual(timing, {
      phase: 'first-delta',
      elapsedMs: 0,
      provider: 'example.test',
      model: MODEL,
      bytes: 12,
      deltaKind: 'reasoning',
    });
    assert.doesNotMatch(JSON.stringify(timing), /secret|prompt|response/);
  });
});
