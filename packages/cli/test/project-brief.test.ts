import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askProjectBrief,
  needsProjectBrief,
  projectBriefInstruction,
} from '../src/project-brief.js';

test('frontend requests receive a same-input stack and visual-style preflight', async () => {
  const questions: string[] = [];
  const answers = ['react-ts', 'neo-minimalism'];
  const brief = await askProjectBrief(async (question) => {
    questions.push(question.text);
    return answers.shift() ?? null;
  }, 'Build a beautiful landing page for diabetes education.');

  assert.deepEqual(brief, { stack: 'react-ts', style: 'neo-minimalism' });
  assert.deepEqual(questions, [
    'Which stack should PLIF use for this frontend task?',
    'Which visual direction should PLIF follow?',
  ]);
  assert.match(projectBriefInstruction(brief!), /Stack: react-ts/);
  assert.match(projectBriefInstruction(brief!), /hard constraints/);
});

test('non-frontend requests do not interrupt the turn', async () => {
  assert.equal(needsProjectBrief('Explain why the provider endpoint timed out.'), false);
  assert.equal(await askProjectBrief(async () => 'unexpected', 'Fix the provider timeout.'), undefined);
});

test('cancelling either preflight question cancels the frontend request', async () => {
  assert.equal(await askProjectBrief(async () => null, 'Create a React dashboard.'), null);
  let count = 0;
  assert.equal(await askProjectBrief(async () => {
    count += 1;
    return count === 1 ? 'html-css-js' : null;
  }, 'Create a CSS landing page.'), null);
});
