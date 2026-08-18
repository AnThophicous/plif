/**
 * Keeping the live frame shorter than the window.
 *
 * Ink writes `clearTerminal + every static line it has ever emitted + the
 * frame` the moment the dynamic frame is as tall as the terminal. On Windows
 * that escape does not clear scrollback, so each occurrence puts a second copy
 * of the whole session on screen — which is what "as mensagens repetem" was.
 *
 * Two things prevent it, and both are tested here: settled rows leave the frame
 * for `<Static>`, and what remains is trimmed to a line budget.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { entry, initialSession, scrollbackCommitEnd, sessionReducer } from '../src/session.js';
import type { SessionState, TimelineEntry } from '../src/session.js';
import { estimateHeight, tail } from '../src/components/Timeline.js';
import {
  detachImmediateInkResize,
  nextTerminalSize,
  RESIZE_SETTLE_MS,
  resizeAppliesImmediately,
  terminalFrameRows,
} from '../src/terminal-resize.js';
import { PassThrough } from 'node:stream';

function withEntries(items: readonly TimelineEntry[]): SessionState {
  return items.reduce(
    (state, item) => sessionReducer(state, { type: 'append', entry: item }),
    initialSession,
  );
}

describe('committing rows to scrollback', () => {
  it('keeps the completed current turn in the live frame until the next turn starts', () => {
    const entries = [
      entry('input', 'the current request'),
      entry('thinking', 'Plif Thinking', { detail: 'reasoning', status: 'done' }),
      entry('tool', 'read_file', { status: 'done', detail: 'package.json' }),
      entry('answer', 'the final answer', { status: 'done' }),
      entry('notice', 'one more detail', { status: 'done' }),
      entry('tool', 'test', { status: 'done' }),
      entry('answer', 'the conclusion', { status: 'done' }),
      entry('separator', 'Worked', { durationMs: 120_000 }),
      entry('notice', 'another finished row', { status: 'done' }),
      entry('tool', 'final check', { status: 'done' }),
      entry('answer', 'still the same turn', { status: 'done' }),
      entry('notice', 'the tail is longer than eight rows', { status: 'done' }),
    ];

    assert.equal(
      scrollbackCommitEnd(entries),
      0,
      'finishing a long turn must not move its visible content above the viewport',
    );
  });

  it('commits the previous turn only after a new input establishes the boundary', () => {
    const entries = [
      entry('input', 'previous request'),
      entry('answer', 'previous answer', { status: 'done' }),
      entry('separator', 'Worked', { durationMs: 12_000 }),
      entry('input', 'new request'),
      entry('thinking', 'Plif Thinking', { status: 'done' }),
      entry('answer', 'new answer', { status: 'done' }),
    ];

    assert.equal(scrollbackCommitEnd(entries), 3);
  });

  it('moves the prefix out of the live frame, in order', () => {
    const state = withEntries([
      entry('input', 'first'),
      entry('tool', 'Bash', { status: 'done' }),
      entry('answer', 'second'),
    ]);

    const after = sessionReducer(state, { type: 'commit', upTo: 2 });

    assert.deepEqual(
      after.committed.map((item) => item.title),
      ['first', 'Bash'],
    );
    assert.deepEqual(
      after.entries.map((item) => item.title),
      ['second'],
    );
  });

  it('only ever grows, because <Static> counts what it has printed', () => {
    // Handing Static a shorter array makes its internal index wrong, and every
    // later append reprints the backlog. Committing twice must concatenate.
    let state = withEntries([entry('input', 'a'), entry('input', 'b'), entry('input', 'c')]);
    state = sessionReducer(state, { type: 'commit', upTo: 1 });
    state = sessionReducer(state, { type: 'commit', upTo: 1 });

    assert.deepEqual(
      state.committed.map((item) => item.title),
      ['a', 'b'],
    );
  });

  it('ignores a commit past the end rather than losing rows', () => {
    const state = sessionReducer(withEntries([entry('input', 'a')]), {
      type: 'commit',
      upTo: 99,
    });
    assert.equal(state.committed.length, 1);
    assert.equal(state.entries.length, 0);
  });

  it('bumps the epoch on /clear so Static is replaced, not shortened', () => {
    let state = withEntries([entry('input', 'a')]);
    state = sessionReducer(state, { type: 'commit', upTo: 1 });
    const cleared = sessionReducer(state, { type: 'clear' });

    assert.deepEqual(cleared.committed, []);
    assert.equal(cleared.epoch, state.epoch + 1);
  });
});

describe('terminal resize guard', () => {
  it('keeps the dynamic frame below Ink\'s clear-terminal threshold', () => {
    assert.equal(terminalFrameRows(40), 39);
    assert.equal(terminalFrameRows(1), 1);
  });

  it('removes only Ink\'s immediate resized listener', () => {
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    const existing = (): void => undefined;
    const ink = function resized(): void { /* Ink listener signature */ };
    const app = function onResize(): void { /* Plif listener signature */ };
    stream.on('resize', existing);
    const before = new Set([existing as (...args: unknown[]) => void]);
    stream.on('resize', ink);
    stream.on('resize', app);
    assert.equal(detachImmediateInkResize(stream, before), 1);
    assert.deepEqual(stream.listeners('resize'), [existing, app]);
  });
});

describe('live controls', () => {
  it('applies answer and reasoning frame patches in one reducer action', () => {
    const answer = entry('answer', '', { status: 'active' });
    const reasoning = entry('thinking', 'Thinking', { status: 'active' });
    const state = withEntries([reasoning, answer]);

    const framed = sessionReducer(state, {
      type: 'stream.frame',
      patches: [
        { id: reasoning.id, patch: { detail: 'checking types' } },
        { id: answer.id, patch: { detail: 'done' } },
      ],
    });

    assert.equal(framed.entries[0]?.detail, 'checking types');
    assert.equal(framed.entries[1]?.detail, 'done');
  });

  it('updates discovery calls outside the timeline and flushes one final row', () => {
    let state = sessionReducer(initialSession, {
      type: 'discovery.start', id: 'read-1', kind: 'Read', target: 'src/one.ts',
    });
    state = sessionReducer(state, {
      type: 'discovery.start', id: 'list-1', kind: 'List', target: 'src',
    });
    state = sessionReducer(state, {
      type: 'discovery.finish', id: 'read-1', ok: true, output: '',
    });
    state = sessionReducer(state, {
      type: 'discovery.finish', id: 'list-1', ok: true, output: 'app.ts',
    });

    assert.equal(state.entries.length, 0);
    assert.equal(state.discovery.calls.length, 2);
    assert.equal(state.discovery.calls[1]?.output, 'app.ts');

    state = sessionReducer(state, { type: 'discovery.flush' });
    assert.equal(state.discovery.calls.length, 0);
    assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0]?.title, 'Executed');
    assert.equal(state.entries[0]?.toolTarget, 'Read 1x · List 1x');
    assert.equal(state.entries[0]?.executions?.length, 2);
  });

  it('groups adjacent completed edits into one compact transcript row', () => {
    const first = entry('tool', 'Edited', {
      status: 'active',
      toolTarget: 'src/one.ts',
    });
    const second = entry('tool', 'Edited', {
      status: 'active',
      toolTarget: 'src/two.ts',
    });
    let state = withEntries([first, second]);
    state = sessionReducer(state, {
      type: 'update',
      id: first.id,
      patch: { status: 'done', diff: '@@ -1 +1 @@\n-old\n+new' },
    });
    state = sessionReducer(state, {
      type: 'update',
      id: second.id,
      patch: { status: 'done', diff: '@@ -1 +1 @@\n-before\n+after' },
    });

    assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0]?.toolTarget, '2 files');
    assert.equal(state.entries[0]?.toolSummary, '(+2 -2)');
    assert.deepEqual(state.entries[0]?.edits?.map((edit) => edit.path), ['src/one.ts', 'src/two.ts']);
  });

  it('keeps subagent details collapsed and removes the subagent when it finishes', () => {
    const running = sessionReducer(initialSession, {
      type: 'subagent.start',
      view: {
        taskId: 'child-1',
        callId: 'call-1',
        title: 'Inspect backend',
        model: 'test/model',
        startedAt: 1,
        endedAt: null,
        status: 'running',
        summary: null,
        lines: [],
        thinkingSince: null,
        toolCalls: 0,
        contextUsed: 0,
        contextMax: 1_000_000,
        completionTokens: 0,
      },
    });
    const finished = sessionReducer(running, {
      type: 'subagent.finish',
      taskId: 'child-1',
      status: 'done',
      at: 2,
      summary: 'done',
    });
    assert.equal(running.subagentsOpen, false);
    assert.equal(finished.subagents.length, 0);
    assert.equal(finished.subagentsOpen, false);
  });

  it('lets arrow navigation reach the Other answer row', () => {
    const asked = sessionReducer(initialSession, {
      type: 'question.push',
      question: {
        id: 'q1',
        text: 'Pick one',
        options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
        context: undefined,
        askedAt: 1,
      },
    });
    const second = sessionReducer(asked, { type: 'question.move', delta: 1 });
    const other = sessionReducer(second, { type: 'question.move', delta: 1 });
    assert.equal(second.questionChoice, 1);
    assert.equal(other.questionChoice, -1);
  });
});

describe('clipping an answer that is still streaming', () => {
  it('counts wrapped lines, not newlines', () => {
    // The bug this pins down: prose arrives as a few very long paragraphs, so
    // splitting on \n finds three lines where the terminal draws sixty, and a
    // clip measured that way removes nothing at all.
    const paragraph = 'palavra '.repeat(60).trim();
    const body = [paragraph, paragraph, paragraph].join('\n');

    const clipped = tail(body, 80, 10);
    assert.ok(clipped.length < body.length, 'three long paragraphs must not survive a 10-line budget');
    assert.ok(clipped.endsWith('palavra'), 'the end is what is kept — that is where new text lands');
  });

  it('keeps whole source lines rather than cutting mid-sentence', () => {
    const body = ['first', 'second', 'third'].join('\n');
    assert.equal(tail(body, 80, 2), 'second\nthird');
  });

  it('keeps at least one line when even that does not fit', () => {
    const huge = 'x'.repeat(4000);
    assert.equal(tail(huge, 80, 3), huge);
  });
});

describe('estimating row height', () => {
  it('never returns less than a line', () => {
    assert.ok(estimateHeight(entry('notice', ''), 80) >= 1);
    assert.ok(estimateHeight(entry('answer', ''), 80) >= 1);
  });

  it('counts the output a tool row will actually show, plus its elision line', () => {
    const short = entry('tool', 'Bash', { detail: 'one\ntwo\nthree', toolSummary: '3ms' });
    // header + summary + 3 output + margin
    assert.equal(estimateHeight(short, 80), 6);

    const long = entry('tool', 'Bash', {
      detail: Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n'),
    });
    // header + 8 shown + "… more" + margin. The 40 lines never all render.
    assert.equal(estimateHeight(long, 80), 11);
  });

  it('grows with wrapping, so a long answer is not counted as one line', () => {
    const wide = estimateHeight(entry('answer', 'x'.repeat(400)), 80);
    const narrow = estimateHeight(entry('answer', 'x'.repeat(400)), 40);
    assert.ok(narrow > wide, 'a narrower window wraps the same text onto more lines');
    assert.ok(wide > 4);
  });

  it('errs high rather than low', () => {
    // The whole mechanism is a ceiling. An estimate below the real height is
    // the one failure that reintroduces the duplication, so a failed row —
    // which renders up to 20 lines of output — must not be counted as 8.
    const failed = entry('tool', 'Bash', {
      status: 'failed',
      detail: Array.from({ length: 30 }, (_, index) => `err ${index}`).join('\n'),
    });
    const ok = entry('tool', 'Bash', {
      status: 'done',
      detail: Array.from({ length: 30 }, (_, index) => `out ${index}`).join('\n'),
    });
    assert.ok(estimateHeight(failed, 80) > estimateHeight(ok, 80));
  });
});

describe('when a new terminal size may wait for the resize to settle', () => {
  const size = (columns: number, rows: number) => ({ columns, rows });

  it('applies a shorter window at once', () => {
    // The frame is capped from the size in state. One repaint against a stale
    // taller figure is all it takes to reach terminal height and reprint the
    // session, and the thinking highlight repaints continuously.
    assert.equal(resizeAppliesImmediately(size(120, 24), size(120, 40)), true);
  });

  it('applies a narrower window at once', () => {
    assert.equal(resizeAppliesImmediately(size(60, 40), size(120, 40)), true);
  });

  it('lets a larger window wait', () => {
    assert.equal(resizeAppliesImmediately(size(160, 50), size(120, 40)), false);
  });

  it('lets an unchanged size wait', () => {
    assert.equal(resizeAppliesImmediately(size(120, 40), size(120, 40)), false);
  });

  it('applies a drag that shrinks one axis while growing the other', () => {
    assert.equal(resizeAppliesImmediately(size(200, 20), size(120, 40)), true);
  });

  it('keeps physical dimensions for a shrink and defers only growth', () => {
    assert.deepEqual(
      nextTerminalSize(size(80, 24), size(30, 8), 100),
      { size: size(30, 8), deferredUntil: null },
    );
    assert.deepEqual(
      nextTerminalSize(size(30, 8), size(48, 10), 100),
      { size: size(30, 8), deferredUntil: 100 + RESIZE_SETTLE_MS },
    );
  });
});
