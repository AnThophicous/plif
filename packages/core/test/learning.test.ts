/**
 * The confidence ladder.
 *
 * These tests exist to pin down one behaviour above all others: **a single
 * success must never become a pattern.** Every other rule here follows from
 * that, and a regression in it is worse than a crash — the agent would keep
 * confidently applying an approach that worked once by luck, and the symptom
 * would be intermittent failure with no obvious cause.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ESTABLISHED_AT,
  RETHINK_AFTER,
  assess,
  discriminators,
  fingerprint,
  guide,
  independentSuccesses,
} from '../src/harness/learning.js';
import type { Outcome, Strategy } from '../src/harness/learning.js';

let clock = 0;
function outcome(ok: boolean, context: Record<string, string>, sessionId: string): Outcome {
  clock += 1000;
  return { ok, at: new Date(clock).toISOString(), context, sessionId };
}

function strategy(outcomes: Outcome[]): Strategy {
  return {
    id: 's1',
    goal: 'run the test suite',
    approach: 'npm test',
    workspace: 'C:/proj',
    createdAt: new Date(0).toISOString(),
    outcomes,
  };
}

describe('fingerprint', () => {
  it('ignores key order, so a reordered record is the same situation', () => {
    assert.equal(
      fingerprint({ runner: 'vitest', os: 'windows' }),
      fingerprint({ os: 'windows', runner: 'vitest' }),
    );
  });

  it('separates genuinely different situations', () => {
    assert.notEqual(fingerprint({ runner: 'vitest' }), fingerprint({ runner: 'jest' }));
  });
});

describe('independence', () => {
  it('does not count the same situation twice, however often it repeats', () => {
    const same = { runner: 'vitest' };
    const outcomes = [
      outcome(true, same, 'a'),
      outcome(true, same, 'b'),
      outcome(true, same, 'c'),
      outcome(true, same, 'd'),
    ];
    // Four successes, one thing proven.
    assert.equal(independentSuccesses(outcomes), 1);
  });

  it('counts distinct situations separately', () => {
    const outcomes = [
      outcome(true, { runner: 'vitest' }, 'a'),
      outcome(true, { runner: 'jest' }, 'b'),
      outcome(true, { runner: 'mocha' }, 'c'),
    ];
    assert.equal(independentSuccesses(outcomes), 3);
  });
});

describe('the luck guard', () => {
  it('stops a single success at candidate, not at a pattern', () => {
    const result = assess(strategy([outcome(true, { runner: 'vitest' }, 'a')]));
    assert.equal(result.confidence, 'candidate');
    assert.match(result.rationale, /not yet a pattern/);
  });

  it('cannot be climbed by looping on the same thing', () => {
    // This is the attack: an agent that repeats a successful command to
    // manufacture confidence in it. Ten runs, one situation, still a candidate.
    const same = { runner: 'vitest' };
    const outcomes = Array.from({ length: 10 }, (_, index) =>
      outcome(true, same, `session-${index}`),
    );
    assert.equal(assess(strategy(outcomes)).confidence, 'candidate');
  });

  it('promotes only on independent successes', () => {
    const two = assess(
      strategy([
        outcome(true, { runner: 'vitest' }, 'a'),
        outcome(true, { runner: 'jest' }, 'b'),
      ]),
    );
    assert.equal(two.confidence, 'provisional');

    const enough = assess(
      strategy(
        Array.from({ length: ESTABLISHED_AT }, (_, index) =>
          outcome(true, { runner: `r${index}` }, `s${index}`),
        ),
      ),
    );
    assert.equal(enough.confidence, 'established');
  });
});

describe('failure weighs more than success', () => {
  it('drops an established strategy to contested on a single failure', () => {
    const outcomes = Array.from({ length: ESTABLISHED_AT }, (_, index) =>
      outcome(true, { runner: `r${index}` }, `s${index}`),
    );
    assert.equal(assess(strategy(outcomes)).confidence, 'established');

    outcomes.push(outcome(false, { runner: 'rX' }, 'sX'));
    assert.equal(assess(strategy(outcomes)).confidence, 'contested');
  });

  it('retires an approach that mostly fails', () => {
    const outcomes = [
      outcome(true, { runner: 'a' }, '1'),
      outcome(false, { runner: 'b' }, '2'),
      outcome(false, { runner: 'c' }, '3'),
      outcome(false, { runner: 'd' }, '4'),
    ];
    assert.equal(assess(strategy(outcomes)).confidence, 'retired');
  });

  it('does not retire on one failure with no successes yet', () => {
    const result = assess(strategy([outcome(false, { runner: 'a' }, '1')]));
    assert.equal(result.confidence, 'contested');
  });
});

describe('rethink gate', () => {
  it('demands a different approach after consecutive failures', () => {
    const outcomes = [
      outcome(true, { runner: 'a' }, '1'),
      outcome(false, { runner: 'b' }, '2'),
      outcome(false, { runner: 'c' }, '3'),
    ];
    const result = assess(strategy(outcomes));
    assert.equal(result.consecutiveFailures, RETHINK_AFTER);
    assert.equal(result.mustRethink, true);
  });

  it('resets once something works again', () => {
    const outcomes = [
      outcome(false, { runner: 'a' }, '1'),
      outcome(false, { runner: 'b' }, '2'),
      outcome(true, { runner: 'c' }, '3'),
    ];
    const result = assess(strategy(outcomes));
    assert.equal(result.consecutiveFailures, 0);
    assert.equal(result.mustRethink, false);
  });
});

describe('discriminators', () => {
  it('finds the factor that separates success from failure', () => {
    const outcomes = [
      outcome(true, { runner: 'vitest', os: 'windows' }, '1'),
      outcome(true, { runner: 'vitest', os: 'linux' }, '2'),
      outcome(false, { runner: 'jest', os: 'windows' }, '3'),
      outcome(false, { runner: 'jest', os: 'linux' }, '4'),
    ];
    const found = discriminators(strategy(outcomes));

    // `os` appears on both sides, so it explains nothing and must not be named.
    assert.deepEqual(
      found.map((item) => item.key),
      ['runner'],
    );
    assert.deepEqual(found[0]?.whenOk, ['vitest']);
    assert.deepEqual(found[0]?.whenFailed, ['jest']);
  });

  it('reports nothing when a key overlaps both outcomes', () => {
    const outcomes = [
      outcome(true, { os: 'windows' }, '1'),
      outcome(false, { os: 'windows' }, '2'),
    ];
    assert.deepEqual(discriminators(strategy(outcomes)), []);
  });

  it('reports nothing when there is only one kind of outcome', () => {
    assert.deepEqual(discriminators(strategy([outcome(true, { os: 'windows' }, '1')])), []);
  });
});

describe('guidance', () => {
  it('ranks established above provisional above candidate', () => {
    const make = (id: string, goal: string, outcomes: Outcome[]): Strategy => ({
      ...strategy(outcomes),
      id,
      goal,
    });

    const result = guide([
      make('c', 'candidate', [outcome(true, { k: '1' }, 'a')]),
      make(
        'e',
        'established',
        Array.from({ length: ESTABLISHED_AT }, (_, i) => outcome(true, { k: `e${i}` }, `s${i}`)),
      ),
      make('p', 'provisional', [
        outcome(true, { k: 'p1' }, 'a'),
        outcome(true, { k: 'p2' }, 'b'),
      ]),
    ]);

    assert.deepEqual(
      result.prefer.map((item) => item.strategy.goal),
      ['established', 'provisional', 'candidate'],
    );
  });

  it('moves contested and retired strategies into avoid, with the reason', () => {
    const contested = {
      ...strategy([
        outcome(true, { runner: 'vitest' }, '1'),
        outcome(false, { runner: 'jest' }, '2'),
      ]),
      goal: 'flaky one',
    };
    const result = guide([contested]);

    assert.equal(result.prefer.length, 0);
    assert.equal(result.avoid.length, 1);
    assert.match(result.avoid[0]?.reason ?? '', /Distinguishing factor: runner/);
  });

  it('tells the agent to change approach when it is looping on failure', () => {
    const looping = strategy([
      outcome(false, { k: 'a' }, '1'),
      outcome(false, { k: 'b' }, '2'),
    ]);
    const result = guide([looping]);

    assert.equal(result.mustChangeApproach, true);
    assert.match(result.briefing, /materially different/);
  });

  it('says nothing about changing approach when everything is fine', () => {
    const fine = strategy([outcome(true, { k: 'a' }, '1'), outcome(true, { k: 'b' }, '2')]);
    assert.equal(guide([fine]).mustChangeApproach, false);
  });
});
