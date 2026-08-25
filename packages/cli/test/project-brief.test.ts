import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askProjectBrief,
  needsProjectBrief,
  projectBriefInstruction,
} from '../src/project-brief.js';

test('frontend requests receive a same-input stack and visual-style preflight', async () => {
  const questions: Array<{ text: string; labels?: readonly string[] }> = [];
  const answers = ['react-ts', 'neo-minimalism'];
  const brief = await askProjectBrief(async (question) => {
    questions.push({
      text: question.text,
      labels: question.options?.map((option) => typeof option === 'string' ? option : option.label),
    });
    return answers.shift() ?? null;
  }, 'Build a beautiful landing page for diabetes education.');

  assert.deepEqual(brief, { stack: 'react-ts', style: 'neo-minimalism' });
  assert.deepEqual(questions.map((question) => question.text), [
    'Which stack should PLIF use for this frontend task?',
    'Which visual direction should PLIF follow?',
  ]);
  assert.deepEqual(questions[0]?.labels, [
    'HTML + CSS + JavaScript',
    'React + TypeScript',
    'Next.js + TypeScript',
    'Vue + TypeScript',
    'Other stack',
  ]);
  assert.deepEqual(questions[1]?.labels, [
    'NeoMinimalism',
    'Neomorphism',
    'Maximalism',
    'Editorial',
    'Brutalism',
    'Other visual style',
  ]);
  assert.match(projectBriefInstruction(brief!), /Stack: react-ts/);
  assert.match(projectBriefInstruction(brief!), /hard constraints/);
});

test('a skill mention alone does not open a design preflight', async () => {
  assert.equal(needsProjectBrief('Use the DME Frontend skill for this task.'), false);
  assert.equal(needsProjectBrief('Review the frontend implementation for accessibility.'), false);
  assert.equal(await askProjectBrief(async () => 'unexpected', 'Please use the frontend skill.'), undefined);
});

test('explicit stack and style choices are respected without asking again', async () => {
  let asked = 0;
  const brief = await askProjectBrief(async () => {
    asked += 1;
    return null;
  }, 'Build a React dashboard in NeoMinimalism.');

  assert.deepEqual(brief, { stack: 'react-ts', style: 'neo-minimalism' });
  assert.equal(asked, 0);
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
