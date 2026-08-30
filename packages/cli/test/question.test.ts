import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { render } from '../src/ui.js';
import React from 'react';
import { test } from 'node:test';

import { Question, questionChoiceAtRow, questionHeight } from '../src/components/Question.js';
import type { PendingQuestion } from '../src/session.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

class CaptureOutput extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = true as const;
  output = '';

  write(chunk: string | Uint8Array): boolean {
    this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }
}

const question: PendingQuestion = {
  id: 'question-1',
  text: 'Which stack should PLIF use for this frontend task?',
  options: [
    { value: 'html', label: 'HTML + CSS + JavaScript', description: 'Static, dependency-free page' },
    { value: 'react', label: 'React + TypeScript', description: 'Component-based interface' },
  ],
  context: undefined,
  askedAt: Date.now(),
};

test('question chooser renders as a readable unboxed list with explicit controls', async () => {
  const stdout = new CaptureOutput();
  const app = render(
    React.createElement(Question, {
      question,
      selected: 0,
      draft: '',
      queued: 0,
      width: 100,
      expanded: false,
      now: question.askedAt,
    }),
    { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  app.unmount();

  const output = stdout.output.replace(ANSI, '').replace(/\r/g, '');
  assert.match(output, /Which stack should PLIF use/);
  assert.match(output, /1\. HTML \+ CSS \+ JavaScript/);
  assert.match(output, /Static, dependency-free page/);
  assert.match(output, /2\. React \+ TypeScript/);
  assert.match(output, /Enter to select · ↑\/↓ to navigate · Esc to cancel/);
  assert.match(output, /─{8,}/);
  assert.doesNotMatch(output, /[╭╮╰╯]/);
});

test('question row budget matches the rendered list and divider', () => {
  assert.equal(questionHeight(question, false, false), 14);
  assert.equal(questionChoiceAtRow(question, 4, false, false), 0);
  assert.equal(questionChoiceAtRow(question, 5, false, false), 0);
  assert.equal(questionChoiceAtRow(question, 6, false, false), 1);
  assert.equal(questionChoiceAtRow(question, 8, false, false), null);
  assert.equal(questionChoiceAtRow(question, 9, false, false), -1);
  assert.equal(questionChoiceAtRow(question, 10, false, false), -1);
  assert.equal(questionChoiceAtRow(question, 0, false, false), null);
});

test('question without suggestions starts in the visible free-text row', () => {
  const freeText: PendingQuestion = {
    ...question,
    id: 'question-2',
    text: 'Type the direction for the implementation.',
    options: undefined,
  };
  assert.equal(questionHeight(freeText, false, false), 7);
  assert.equal(questionChoiceAtRow(freeText, 3, false, false), -1);
});
