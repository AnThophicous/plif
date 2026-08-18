import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ComposerHistory } from '../src/composer/history.js';
import { materializePastedLine } from '../src/composer/paste.js';
import {
  composerReducer,
  initialComposerState,
  submissionFromComposer,
} from '../src/composer/state.js';

describe('composer state', () => {
  it('inserts and deletes complete grapheme clusters', () => {
    let state = composerReducer(initialComposerState, { type: 'insert', text: 'a👩‍💻b' });
    state = composerReducer(state, { type: 'move.left' });
    state = composerReducer(state, { type: 'delete.backward' });

    assert.equal(state.draft, 'ab');
    assert.equal(state.cursor, 1);
  });

  it('inserts a newline at the cursor without submitting', () => {
    let state = composerReducer(initialComposerState, { type: 'insert', text: 'ab' });
    state = composerReducer(state, { type: 'move.left' });
    state = composerReducer(state, { type: 'newline' });

    assert.equal(state.draft, 'a\nb');
    assert.equal(state.cursor, 2);
  });

  it('queues an immutable snapshot of text and attachments', () => {
    const attachment = { kind: 'text' as const, token: '[paste-1]', text: 'complete payload' };
    let state = composerReducer(initialComposerState, { type: 'insert', text: 'review this' });
    state = composerReducer(state, { type: 'attachment.add', attachment });
    state = composerReducer(state, { type: 'queue.current', id: 'queued-1' });
    state = composerReducer(state, { type: 'reset.draft' });

    assert.deepEqual(state.queue, [{
      id: 'queued-1', text: 'review this', attachments: [attachment],
    }]);
    assert.deepEqual(submissionFromComposer(state), null);
  });

  it('drops a queued snapshot without mutating the previous state', () => {
    let before = composerReducer(initialComposerState, { type: 'insert', text: 'one' });
    before = composerReducer(before, { type: 'queue.current', id: 'q1' });
    const after = composerReducer(before, { type: 'queue.drop', id: 'q1' });

    assert.equal(before.queue.length, 1);
    assert.equal(after.queue.length, 0);
  });
});

describe('composer history', () => {
  it('traverses A, B, C in both directions and restores the draft at the boundary', () => {
    const history = new ComposerHistory();
    history.record('A');
    history.record('B');
    history.record('C');

    assert.equal(history.previous(''), 'C');
    assert.equal(history.previous('C'), 'B');
    assert.equal(history.previous('B'), 'A');
    assert.equal(history.previous('A'), 'A');
    assert.equal(history.next('A'), 'B');
    assert.equal(history.next('B'), 'C');
    assert.equal(history.next('C'), '');
    assert.equal(history.next(''), '');
  });

  it('restores the draft after leaving recalled history', () => {
    const history = new ComposerHistory();
    history.record('first');
    history.record('second');

    assert.equal(history.previous('draft'), 'second');
    assert.equal(history.previous('second'), 'first');
    assert.equal(history.next('first'), 'second');
    assert.equal(history.next('second'), 'draft');
  });

  it('reverse-searches newest matching input first', () => {
    const history = new ComposerHistory();
    history.record('git status');
    history.record('npm test');
    history.record('git diff');

    assert.equal(history.search('git', -1), 'git diff');
    assert.equal(history.search('git', 2), 'git status');
  });

  it('skips blanks and consecutive duplicates', () => {
    const history = new ComposerHistory();
    history.record('');
    history.record('same');
    history.record('same');

    assert.equal(history.size, 1);
  });

  it('caches persistent history by stable index', async () => {
    let calls = 0;
    const history = new ComposerHistory({
      async previous() {
        calls += 1;
        return { index: 41, text: 'older' };
      },
      async search() {
        calls += 1;
        return { index: 41, text: 'older' };
      },
    });

    assert.equal((await history.fetchPrevious(42))?.text, 'older');
    assert.equal((await history.fetchPrevious(42))?.text, 'older');
    assert.equal(calls, 1);
  });
});

describe('large paste materialization', () => {
  it('replaces visual tokens with the real payload in insertion order', () => {
    const first = { kind: 'text' as const, token: '✧ Plif Pasted 2 lines', text: 'A\nB' };
    const second = { kind: 'text' as const, token: '✧ Plif Pasted 1 line', text: 'C' };
    const result = materializePastedLine(`before ${first.token} middle ${second.token}`, [first, second]);
    assert.equal(result.text, 'before A\nB middle C');
    assert.deepEqual(result.attachments, []);
  });

  it('does not consume image attachments while expanding text pastes', () => {
    const image = {
      kind: 'image' as const,
      token: '[Pasted Image #1]',
      path: 'image.png',
      mediaType: 'image/png',
      bytes: 1,
    };
    const result = materializePastedLine(image.token, [image]);
    assert.equal(result.text, image.token);
    assert.deepEqual(result.attachments, [image]);
  });
});
