/**
 * Thinking arriving in the content channel.
 *
 * Every distilled R1, QwQ and Qwen-thinking checkpoint served locally writes
 * `<think>…</think>` into `content` and leaves the client to sort it out. The
 * cases below are the ones that actually break: a tag split across two deltas,
 * a `<` in ordinary prose, and a block that never closes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ReasoningDeltaNormalizer,
  ReasoningSplitter,
  reasoningFromDelta,
  reasoningObservationFromDelta,
} from '../src/model/reasoning.js';

/** Feed a stream and collect each channel. */
function run(deltas: readonly string[]): { text: string; reasoning: string } {
  const splitter = new ReasoningSplitter();
  let text = '';
  let reasoning = '';
  for (const delta of [...deltas.map((d) => () => splitter.push(d)), () => splitter.flush()]) {
    for (const part of delta()) {
      if (part.kind === 'text') text += part.delta;
      else reasoning += part.delta;
    }
  }
  return { text, reasoning };
}

describe('ReasoningSplitter', () => {
  it('routes a whole think block away from the answer', () => {
    const { text, reasoning } = run(['<think>let me check the auth path</think>The key is stale.']);
    assert.equal(text, 'The key is stale.');
    assert.equal(reasoning, 'let me check the auth path');
  });

  it('handles a tag split across deltas', () => {
    // The failure this prevents: `<thi` emitted as text, then `nk>` as text,
    // and the entire monologue in the answer because the tag was never seen.
    const { text, reasoning } = run(['<thi', 'nk>hmm</thi', 'nk>done']);
    assert.equal(text, 'done');
    assert.equal(reasoning, 'hmm');
  });

  it('streams text a token at a time without holding it back', () => {
    const splitter = new ReasoningSplitter();
    const first = splitter.push('The ');
    assert.deepEqual(first, [{ kind: 'text', delta: 'The ' }]);
  });

  it('leaves a less-than sign in prose alone', () => {
    const { text, reasoning } = run(['use ', 'if (a < b) ', 'here']);
    assert.equal(text, 'use if (a < b) here');
    assert.equal(reasoning, '');
  });

  it('ignores a think tag that appears after the answer has started', () => {
    // A fenced code sample containing the literal tag must not swallow the
    // rest of the response — the model already committed to answering.
    const { text, reasoning } = run(['Here is the tag: ', '<think>', 'x</think>']);
    assert.equal(reasoning, '');
    assert.ok(text.includes('<think>'));
  });

  it('treats an unclosed block as thinking rather than dropping it', () => {
    const { text, reasoning } = run(['<think>cut off mid-thought']);
    assert.equal(text, '');
    assert.equal(reasoning, 'cut off mid-thought');
  });

  it('prefers the longer tag when two match at the same offset', () => {
    const { text, reasoning } = run(['<thinking>a</thinking>b']);
    assert.equal(text, 'b');
    assert.equal(reasoning, 'a');
  });

  it('reports whether it saw any thinking at all', () => {
    const quiet = new ReasoningSplitter();
    quiet.push('plain answer');
    assert.equal(quiet.sawReasoning, false);

    const loud = new ReasoningSplitter();
    loud.push('<think>x</think>');
    assert.equal(loud.sawReasoning, true);
  });
});

describe('reasoningFromDelta', () => {
  it('reads every field name hosts use', () => {
    assert.equal(reasoningFromDelta({ reasoning_content: 'a' }), 'a');
    assert.equal(reasoningFromDelta({ reasoning: 'b' }), 'b');
    assert.equal(reasoningFromDelta({ thinking: 'c' }), 'c');
    assert.equal(reasoningFromDelta({ analysis: 'd' }), 'd');
    assert.equal(reasoningFromDelta({ reasoning_delta: 'e' }), 'e');
    assert.equal(reasoningFromDelta({ thinking_delta: 'f' }), 'f');
  });

  it('unwraps reasoning content blocks from compatible gateways', () => {
    assert.equal(
      reasoningFromDelta({ content_block: { type: 'thinking', thinking: 'g' } }),
      'g',
    );
    assert.equal(
      reasoningFromDelta({ content_block_delta: { type: 'thinking_delta', text: 'h' } }),
      'h',
    );
  });

  it('unwraps the object form some gateways send', () => {
    assert.equal(reasoningFromDelta({ reasoning: { text: 'd' } }), 'd');
  });

  it('joins the structured block list', () => {
    assert.equal(
      reasoningFromDelta({ reasoning_details: [{ text: 'e' }, { text: 'f' }] }),
      'ef',
    );
  });

  it('preserves source and semantics for provider normalization', () => {
    assert.deepEqual(reasoningObservationFromDelta({ reasoning_content: 'abc' }), {
      text: 'abc',
      source: 'reasoning_content',
      semantics: 'delta',
    });
    assert.deepEqual(reasoningObservationFromDelta({ reasoning_details: [{ text: 'abc' }] }), {
      text: 'abc',
      source: 'reasoning_details',
      semantics: 'snapshot',
    });
    assert.deepEqual(reasoningObservationFromDelta({ reasoning_delta: 'abc' }), {
      text: 'abc',
      source: 'reasoning_delta',
      semantics: 'delta',
    });
    assert.deepEqual(reasoningObservationFromDelta({ content_block_delta: { type: 'thinking_delta', text: 'abc' } }), {
      text: 'abc',
      source: 'content_block_delta',
      semantics: 'delta',
    });
  });

  it('is undefined when there is no thinking, not empty string', () => {
    // The provider branches on truthiness; an empty string here would emit a
    // reasoning event for every content-only chunk of the stream.
    assert.equal(reasoningFromDelta({ content: 'hello' }), undefined);
    assert.equal(reasoningFromDelta({ reasoning: '' }), undefined);
    assert.equal(reasoningFromDelta(undefined), undefined);
  });
});

describe('ReasoningDeltaNormalizer', () => {
  it('turns explicit cumulative snapshots beginning at one character into true deltas', () => {
    const normalizer = new ReasoningDeltaNormalizer();
    assert.equal(normalizer.push({ text: 'a', source: 'reasoning', semantics: 'snapshot' }), 'a');
    assert.equal(normalizer.push({ text: 'ab', source: 'reasoning', semantics: 'snapshot' }), 'b');
    assert.equal(normalizer.push({ text: 'abc', source: 'reasoning', semantics: 'snapshot' }), 'c');
    assert.equal(normalizer.value, 'abc');
  });

  it('leaves explicit ordinary and repeated token deltas untouched', () => {
    const normalizer = new ReasoningDeltaNormalizer();
    assert.equal(normalizer.push({ text: 'the ', source: 'reasoning_content', semantics: 'delta' }), 'the ');
    assert.equal(normalizer.push({ text: 'the ', source: 'reasoning_content', semantics: 'delta' }), 'the ');
    assert.equal(normalizer.value, 'the the ');
  });

  it('does not erase legitimate repeated reasoning_content deltas', () => {
    const normalizer = new ReasoningDeltaNormalizer();
    assert.equal(normalizer.push({ text: 'Asp', source: 'reasoning_content', semantics: 'delta' }), 'Asp');
    assert.equal(normalizer.push({ text: 'Asp', source: 'reasoning_content', semantics: 'delta' }), 'Asp');
    assert.equal(normalizer.value, 'AspAsp');
  });

  it('does not deduplicate unclassified observations by comparing their text', () => {
    const normalizer = new ReasoningDeltaNormalizer();
    const emitted = Array.from({ length: 12 }, () => normalizer.push({
      text: 'Asp',
      source: 'reasoning_content',
      semantics: 'unknown',
    }));
    assert.deepEqual(emitted, Array<string>(12).fill('Asp'));
    assert.equal(normalizer.value, 'Asp'.repeat(12));
  });

  it('drops an unchanged explicit snapshot', () => {
    const normalizer = new ReasoningDeltaNormalizer();
    const observation = {
      text: 'A complete reasoning snapshot',
      source: 'reasoning_details' as const,
      semantics: 'snapshot' as const,
    };
    assert.equal(normalizer.push(observation), observation.text);
    assert.equal(normalizer.push(observation), '');
  });

  it('does not compare raw snapshots from different sources', () => {
    const normalizer = new ReasoningDeltaNormalizer();
    assert.equal(normalizer.push({ text: 'a', source: 'reasoning', semantics: 'unknown' }), 'a');
    assert.equal(normalizer.push({ text: 'ab', source: 'thinking', semantics: 'unknown' }), 'ab');
    assert.equal(normalizer.value, 'aab');
  });
});
