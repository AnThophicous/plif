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

import { entry, initialSession, sessionReducer } from '../src/session.js';
import type { SessionState, TimelineEntry } from '../src/session.js';
import { estimateHeight, tail } from '../src/components/Timeline.js';

function withEntries(items: readonly TimelineEntry[]): SessionState {
  return items.reduce(
    (state, item) => sessionReducer(state, { type: 'append', entry: item }),
    initialSession,
  );
}

describe('committing rows to scrollback', () => {
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
