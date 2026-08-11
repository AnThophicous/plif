/**
 * Which remembered facts get the prompt budget.
 *
 * The store holds more than fits, so something has to choose. Recency was the
 * wrong axis: a fact that has held up a dozen times is the closest thing this
 * store has to knowledge, and taking the newest eight entries dropped it the
 * moment eight fresh observations landed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rankFacts, summariseMemory } from '../src/harness/memory.js';
import type { Fact, MemorySnapshot } from '../src/harness/memory.js';

function fact(text: string, confirmations: number, contradictions = 0, at = '2026-01-01'): Fact {
  return {
    id: text,
    kind: 'fact',
    text,
    workspace: '/w',
    createdAt: `${at}T00:00:00.000Z`,
    updatedAt: `${at}T00:00:00.000Z`,
    confirmations,
    contradictions,
    tags: [],
  };
}

describe('rankFacts', () => {
  it('keeps what has held up over what is merely recent', () => {
    const ranked = rankFacts(
      [fact('proven', 12, 0, '2026-01-01'), fact('just written', 1, 0, '2026-08-01')],
      1,
    );
    assert.deepEqual(ranked.map((item) => item.text), ['proven']);
  });

  it('counts a contradiction against a fact twice over', () => {
    const ranked = rankFacts([fact('shaky', 5, 2), fact('steady', 2)], 2);
    assert.deepEqual(ranked.map((item) => item.text), ['steady', 'shaky']);
  });

  it('breaks a tie with the more recently confirmed one', () => {
    const ranked = rankFacts(
      [fact('older', 3, 0, '2026-01-01'), fact('newer', 3, 0, '2026-07-01')],
      2,
    );
    assert.deepEqual(ranked.map((item) => item.text), ['newer', 'older']);
  });

  it('returns no more than asked, and copes with fewer', () => {
    assert.equal(rankFacts([fact('a', 1), fact('b', 1), fact('c', 1)], 2).length, 2);
    assert.equal(rankFacts([], 5).length, 0);
  });

  it('does not disturb the caller’s array', () => {
    const facts = [fact('a', 1), fact('b', 9)];
    rankFacts(facts, 2);
    assert.deepEqual(facts.map((item) => item.text), ['a', 'b']);
  });
});

describe('summariseMemory', () => {
  it('spends the budget on the strongest facts, not the newest', () => {
    const snapshot: MemorySnapshot = {
      strategies: [],
      facts: [
        fact('the build is npm run build', 9, 0, '2026-01-01'),
        ...Array.from({ length: 10 }, (_, index) => fact(`noise ${index}`, 1, 0, '2026-08-01')),
      ],
      failures: [],
      notes: '',
      guidance: { briefing: '', confident: [], discouraged: [] },
    };

    const summary = summariseMemory(snapshot, 3);
    assert.match(summary, /the build is npm run build \(seen 9x\)/);
    assert.equal(summary.split('\n').filter((line) => line.startsWith('- ')).length, 3);
  });
});
