import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { askUser } from '../src/harness/tools.js';
import type { QuestionChoice } from '../src/harness/tools.js';

/**
 * Options arrive from a model, so the shapes are only as consistent as the
 * schema is forgiving. A missing duplicate of a field the tool can derive is
 * not a reason to fail a question the human is already waiting on.
 */
function capture() {
  const seen: { options?: readonly QuestionChoice[] } = {};
  const context = {
    questions: {
      ask: async (question: { options?: readonly QuestionChoice[] }) => {
        seen.options = question.options;
        return 'answered';
      },
    },
  } as never;
  return { seen, context };
}

async function run(options: unknown) {
  const { seen, context } = capture();
  const result = await askUser.run(
    { question: 'Which one?', context: 'Deciding the shape.', options },
    context,
  );
  return { seen, result };
}

describe('ask_user option normalisation', () => {
  it('accepts an object carrying only a label', async () => {
    const { seen } = await run([{ label: 'Static page', description: 'no backend' }]);
    assert.deepEqual(seen.options, [
      { value: 'Static page', label: 'Static page', description: 'no backend' },
    ]);
  });

  it('accepts an object carrying only a value', async () => {
    const { seen } = await run([{ value: 'next' }]);
    assert.deepEqual(seen.options, [{ value: 'next', label: 'next' }]);
  });

  it('keeps both fields when both are given', async () => {
    const { seen } = await run([{ value: 'next', label: 'Next.js app' }]);
    assert.deepEqual(seen.options, [{ value: 'next', label: 'Next.js app' }]);
  });

  it('still takes a plain string', async () => {
    const { seen } = await run(['Static page']);
    assert.deepEqual(seen.options, ['Static page']);
  });

  it('rejects an option that carries neither field', async () => {
    await assert.rejects(
      () => run([{ description: 'orphan' }]),
      /must be a non-empty string, or an object carrying "value" or "label"/,
    );
  });

  it('rejects whitespace masquerading as a value', async () => {
    await assert.rejects(() => run([{ value: '   ' }]), /non-empty string/);
  });
});
