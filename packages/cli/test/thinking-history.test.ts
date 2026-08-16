import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  blockAtLine,
  blockJumpOffset,
  thinkingDocument,
  thoughtBlocks,
  wrapThought,
} from '../src/thinking-history.js';
import type { TranscriptCell } from '../src/transcript/types.js';
import { initialViewport, viewportReducer } from '../src/transcript/scroll.js';

function reasoning(id: string, text: string, finalized = true): TranscriptCell {
  return {
    id,
    turnId: `turn-${id}`,
    at: '2026-08-13T22:16:00.000Z',
    kind: 'reasoning',
    finalized,
    text,
  };
}

const OTHER: TranscriptCell = {
  id: 'answer',
  turnId: 'turn-1',
  at: '2026-08-13T22:16:00.000Z',
  kind: 'assistant',
  finalized: true,
  text: 'the answer',
  phase: 'final',
};

describe('the thinking history', () => {
  it('keeps every reasoning block in the order it was thought', () => {
    const blocks = thoughtBlocks([
      reasoning('a', 'first thought'),
      OTHER,
      reasoning('b', 'second thought'),
    ]);

    assert.deepEqual(blocks.map((block) => block.text), ['first thought', 'second thought']);
  });

  it('drops empty blocks and marks the one still being written', () => {
    const blocks = thoughtBlocks([
      reasoning('a', '   \n  '),
      reasoning('b', 'still going', false),
    ]);

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.live, true);
  });

  it('wraps to the width and never returns an over-wide row', () => {
    const rows = wrapThought('The quick brown fox jumps over the lazy dog. '.repeat(8), 24);
    for (const row of rows) assert.ok(row.length <= 24, `"${row}" is ${row.length} wide`);
  });

  it('breaks a word too long to fit rather than overflowing', () => {
    const rows = wrapThought('x'.repeat(60), 20);
    assert.ok(rows.every((row) => row.length <= 20));
    assert.equal(rows.join('').length, 60);
  });

  it('gives every block a heading and records where it starts', () => {
    const document = thinkingDocument(
      thoughtBlocks([reasoning('a', 'alpha beta'), reasoning('b', 'gamma delta')]),
      40,
    );

    assert.deepEqual(
      document.lines.map((line) => line.kind),
      ['heading', 'text', 'blank', 'heading', 'text'],
    );
    assert.deepEqual(document.blockStarts, [0, 3]);
    assert.match(document.lines[0]?.text ?? '', /^1\/2/);
    assert.match(document.lines[3]?.text ?? '', /^2\/2/);
  });

  it('reports which block a scroll position is inside', () => {
    const document = thinkingDocument(
      thoughtBlocks([reasoning('a', 'alpha beta'), reasoning('b', 'gamma delta')]),
      40,
    );

    assert.equal(blockAtLine(document, 0), 0);
    assert.equal(blockAtLine(document, 1), 0);
    assert.equal(blockAtLine(document, 4), 1);
  });

  it('steps forward to the next block and back to the top of the current one', () => {
    const document = thinkingDocument(
      thoughtBlocks([
        reasoning('a', 'alpha beta gamma'),
        reasoning('b', 'delta epsilon zeta'),
        reasoning('c', 'eta theta'),
      ]),
      12,
    );

    const second = document.blockStarts[1] ?? 0;
    assert.equal(blockJumpOffset(document, 0, 1), second);
    assert.equal(blockJumpOffset(document, second + 1, -1), second);
    assert.equal(blockJumpOffset(document, second, -1), document.blockStarts[0]);
    assert.equal(blockJumpOffset(document, document.blockStarts[2] ?? 0, 1), document.blockStarts[2]);
  });
});

describe('reading a thought while the agent starts another', () => {
  const metrics = { contentLines: 120, height: 20 };

  it('opens on the newest thought and follows it', () => {
    const state = viewportReducer(initialViewport, { type: 'open', ...metrics });
    assert.equal(state.offset, 100);
    assert.equal(state.follow, true);
  });

  it('pins where the reader is once they scroll, and new thinking does not move them', () => {
    let state = viewportReducer(initialViewport, { type: 'open', ...metrics });
    state = viewportReducer(state, { type: 'line', delta: -1, ...metrics });
    assert.equal(state.follow, false);

    const grown = viewportReducer(state, { type: 'content', contentLines: 400, height: 20 });
    assert.equal(grown.offset, state.offset);
    assert.equal(grown.follow, false);
  });

  it('follows the newest thought again on demand', () => {
    const state = viewportReducer(
      { open: true, offset: 12, follow: false },
      { type: 'end', contentLines: 400, height: 20 },
    );

    assert.equal(state.offset, 380);
    assert.equal(state.follow, true);
  });

  it('treats a jump that lands on the tail as following again', () => {
    const state = viewportReducer(
      { open: true, offset: 0, follow: false },
      { type: 'to', offset: 100, ...metrics },
    );

    assert.equal(state.offset, 100);
    assert.equal(state.follow, true);
  });

  it('clamps a jump past the end of the document', () => {
    const state = viewportReducer(
      { open: true, offset: 0, follow: false },
      { type: 'to', offset: 900, ...metrics },
    );

    assert.equal(state.offset, 100);
  });
});
