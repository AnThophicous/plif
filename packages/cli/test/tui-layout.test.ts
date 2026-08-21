import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveLiveStatus, plifDockItems } from '../src/live-status.js';
import { cellSpacing } from '../src/components/Timeline.js';
import {
  appendCompletionDelta,
  classifySubmission,
  countAgentTurns,
  discardCompletionEstimate,
  initialCompletionMeter,
  reconcileCompletionUsage,
} from '../src/interaction-metrics.js';
import { sessionFrameHeight } from '../src/terminal-resize.js';
import { color, glyph } from '../src/theme.js';

describe('minimal TUI hierarchy', () => {
  it('keeps the quiet shell on one surface with one disclosure marker', () => {
    assert.notEqual(color('panel'), color('surface'));
    assert.equal(color('surface'), '#2C2D2E');
    assert.ok(glyph.disclosure.length > 0);
    assert.ok(glyph.caret.length > 0);
  });

  it('shows one authoritative running state by priority', () => {
    assert.deepEqual(
      deriveLiveStatus({ agent: true, mcp: 'connecting github', compacting: false, queued: 2 }),
      { kind: 'agent', label: 'Working', interruptible: true, queued: 2 },
    );
    assert.deepEqual(
      deriveLiveStatus({ agent: false, mcp: 'connecting github', compacting: false, queued: 0 }),
      { kind: 'mcp', label: 'Connecting github', interruptible: false, queued: 0 },
    );
  });

  it('lets dialogs outrank every background running state', () => {
    assert.deepEqual(
      deriveLiveStatus({
        approval: true,
        agent: true,
        compacting: true,
        mcp: 'connecting github',
        queued: 1,
      }),
      { kind: 'approval', label: 'Approval required', interruptible: false, queued: 1 },
    );
  });

  it('collapses dock facts by width without dropping the working state', () => {
    const facts = {
      workspace: 'C:\\src\\plif',
      model: 'openai/gpt-5',
      effort: 'high',
      contextUsed: 40_000,
      contextMax: 128_000,
      working: true,
    } as const;

    assert.deepEqual(plifDockItems(52, facts), ['workspace', 'context', 'working']);
    assert.deepEqual(plifDockItems(28, facts), ['working']);
  });

  it('uses compact intra-turn spacing and a larger turn boundary', () => {
    assert.equal(cellSpacing({ previousTurnId: 'a', turnId: 'a' }), 0);
    assert.equal(cellSpacing({ previousTurnId: 'a', turnId: 'b' }), 1);
    assert.equal(cellSpacing({ previousTurnId: null, turnId: 'a' }), 0);
  });

  it('reserves terminal height only for full-screen views', () => {
    assert.equal(sessionFrameHeight(40, 'normal'), undefined);
    assert.equal(sessionFrameHeight(40, 'browser'), 39);
    assert.equal(sessionFrameHeight(40, 'screen'), 39);
    assert.equal(sessionFrameHeight(40, 'transcript'), 39);
  });

  it('counts only messages sent to the model as agent turns', () => {
    assert.equal(classifySubmission('explique este arquivo'), 'agent');
    assert.equal(classifySubmission('/new'), 'slash');
    assert.equal(classifySubmission('!npm test'), 'shell');
    assert.equal(classifySubmission('!!dir'), 'private-shell');
  });

  it('restores the turn number from distinct persisted user turns', () => {
    const base = { version: 1, at: '2026-08-11T12:00:00.000Z' } as const;
    assert.equal(countAgentTurns([
      { ...base, eventId: 'u1', turnId: 't1', kind: 'user.message', text: 'one' },
      { ...base, eventId: 's1', turnId: 't1', kind: 'turn.started', userEventId: 'u1' },
      { ...base, eventId: 'u2', turnId: 't2', kind: 'user.message', text: 'two' },
    ]), 2);
  });

  it('estimates streamed tokens independently of SSE chunk boundaries', () => {
    const oneChunk = appendCompletionDelta(initialCompletionMeter, 'abcdefghijkl');
    const threeChunks = ['abcd', 'efgh', 'ijkl'].reduce(appendCompletionDelta, initialCompletionMeter);
    assert.deepEqual(oneChunk, threeChunks);
    assert.equal(oneChunk.tokens, 3);
    assert.equal(oneChunk.estimated, true);
  });

  it('reconciles the live estimate with cumulative provider usage', () => {
    const streamed = appendCompletionDelta(initialCompletionMeter, 'abcdefghijkl');
    const reported = reconcileCompletionUsage(streamed, 7);
    assert.equal(reported.tokens, 7);
    assert.equal(reported.estimated, false);

    const nextPass = appendCompletionDelta(reported, 'more');
    assert.equal(nextPass.tokens, 8);
    assert.equal(nextPass.estimated, true);
  });

  it('drops only unreported partial tokens when a stream retries', () => {
    const reported = reconcileCompletionUsage(initialCompletionMeter, 7);
    const partial = appendCompletionDelta(reported, 'discard me');
    assert.deepEqual(discardCompletionEstimate(partial), {
      reportedTokens: 7,
      pendingText: '',
      tokens: 7,
      estimated: false,
    });
  });
});
