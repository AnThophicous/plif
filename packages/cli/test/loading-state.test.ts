import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LoadingTelemetryStore,
  formatLoadingDuration,
  formatLoadingTokens,
  loadingVerbAt,
  loadingVerbIntervalMs,
  loadingVerbPool,
} from '../src/loading-state.js';
import { loadingLayoutForTest } from '../src/components/LoadingStatus.js';
import { displayWidth } from '../src/text.js';

describe('operational loading state', () => {
  it('formats monotonic durations and compact token counts', () => {
    assert.equal(formatLoadingDuration(0), '0s');
    assert.equal(formatLoadingDuration(12_000), '12s');
    assert.equal(formatLoadingDuration(62_000), '1m 2s');
    assert.equal(formatLoadingDuration(3_780_000), '1h 3m');
    assert.equal(formatLoadingTokens(999), '999');
    assert.equal(formatLoadingTokens(1_000), '1k');
    assert.equal(formatLoadingTokens(2_700), '2.7k');
  });

  it('uses a deterministic shuffle bag without immediate verb repeats', () => {
    const interval = loadingVerbIntervalMs();
    const values = Array.from({ length: loadingVerbPool().length * 2 }, (_, index) =>
      loadingVerbAt(index * interval, 7),
    );
    for (let index = 1; index < values.length; index += 1) {
      assert.notEqual(values[index], values[index - 1]);
    }
    assert.deepEqual(
      values.slice(0, loadingVerbPool().length),
      Array.from({ length: loadingVerbPool().length }, (_, index) => loadingVerbAt(index * interval, 7)),
    );
    assert.notEqual(loadingVerbAt(0, 7), loadingVerbAt(0, 8));
  });

  it('rejects stale operations from changing current metrics or phases', () => {
    const store = new LoadingTelemetryStore();
    store.start(1, 'turn-a', 100);
    store.reasoningStart(1, 120);
    store.tokens(1, 40, true);
    assert.equal(store.getSnapshot().tokenSource, 'estimated');
    store.start(2, 'turn-b', 200);
    store.tokens(1, 999, false);
    store.phase(1, 'streaming');
    assert.equal(store.getSnapshot().operationId, 2);
    assert.equal(store.getSnapshot().turnId, 'turn-b');
    assert.equal(store.getSnapshot().tokens, 0);
    assert.equal(store.getSnapshot().tokenSource, 'pending');
    assert.equal(store.getSnapshot().phase, 'starting');
  });

  it('normalizes tool activity and ignores a late completion from another tool', () => {
    const store = new LoadingTelemetryStore();
    store.start(1, 'turn-a', 100);
    store.toolStart(1, 'tool-a', 'read_file', 120);
    assert.deepEqual(store.getSnapshot().activeTool, {
      id: 'tool-a',
      name: 'read_file',
      startedAt: 120,
    });

    store.toolStart(1, 'tool-b', 'search', 140);
    store.toolEnd(1, 'tool-a', true);
    assert.equal(store.getSnapshot().activeTool?.id, 'tool-b');
    assert.equal(store.getSnapshot().completedTools, 1);

    store.toolEnd(1, 'tool-b', false);
    assert.equal(store.getSnapshot().activeTool, null);
    assert.equal(store.getSnapshot().completedTools, 2);
    assert.equal(store.getSnapshot().error, 'tool failed');
  });

  it('does not notify subscribers when a factual event produces no state change', () => {
    const store = new LoadingTelemetryStore();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });
    store.start(1, 'turn-a', 100);
    store.phase(1, 'starting');
    store.tokens(1, 0, true);
    assert.equal(notifications, 1);
  });

  it('removes listeners cleanly when the loading surface is gone', () => {
    const store = new LoadingTelemetryStore();
    let notifications = 0;
    const off = store.subscribe(() => { notifications += 1; });
    store.start(1, 'turn-a', 0);
    off();
    store.phase(1, 'streaming');
    store.finish(1, 'done');
    assert.equal(notifications, 1);
    assert.equal(store.getSnapshot().phase, 'done');
  });

  it('keeps the loading layout inside narrow terminals and preserves the full verb', () => {
    const snapshot = {
      operationId: 3,
      turnId: 'turn-c',
      phase: 'streaming' as const,
      startedAt: 0,
      reasoningStartedAt: null,
      reasoningMs: 12_000,
      tokens: 2_700,
      estimatedTokens: false,
      tokenSource: 'reported' as const,
    };
    for (const width of [160, 120, 100, 80, 60, 40]) {
      const layout = loadingLayoutForTest(width, snapshot, 62_000, 12_000);
      const text = [
        '·',
        layout.verb ? ` ${layout.verb}…` : '',
        layout.fields.length > 0
          ? `${layout.parenthesized ? ' (' : ' · '}${layout.fields.map((field) => field.text).join(' · ')}${layout.parenthesized ? ' )' : ''}`
          : '',
      ].join('');
      assert.ok(displayWidth(text) <= width, `${width}: ${text}`);
      assert.ok(!layout.verb.includes('…'), 'ellipsis is rendered separately');
    }
  });

  it('explains when the provider has not emitted a token source yet', () => {
    const snapshot = {
      operationId: 4,
      turnId: 'turn-d',
      phase: 'waiting' as const,
      startedAt: 0,
      reasoningStartedAt: null,
      reasoningMs: 0,
      tokens: 0,
      estimatedTokens: true,
      tokenSource: 'pending' as const,
    };
    const layout = loadingLayoutForTest(120, snapshot, 16_000);
    assert.ok(layout.fields.some((field) => field.text.includes('tokens pending')));
  });
});
