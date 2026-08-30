import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyLocalSuggestion,
  inlineSuggestionSuffix,
  suggestLocal,
} from '../src/composer/local-assistance.js';

describe('local composer prediction', () => {
  it('completes an unfinished word from the local vocabulary', () => {
    const matches = suggestLocal('plea', 4);
    assert.ok(matches.some((match) => match.value === 'please'));
    assert.equal(matches.find((match) => match.value === 'please')?.kind, 'autocomplete');
  });

  it('ranks project vocabulary above generic words for the same prefix', () => {
    const matches = suggestLocal('plat', 4, { projectVocabulary: ['platform'] });
    assert.equal(matches[0]?.value, 'platform');
    assert.equal(matches[0]?.source, 'project');
  });

  it('predicts the next word from local history context', () => {
    const matches = suggestLocal('please ', 7, {
      history: [
        'please build the dashboard',
        'please build the landing page',
      ],
    });
    assert.equal(matches[0]?.value, 'build');
    assert.equal(matches[0]?.kind, 'prediction');
    assert.equal(matches[0]?.replacement, 'build ');
  });

  it('does not offer another word after the user already typed the exact word', () => {
    const matches = suggestLocal('please', 6, {
      history: ['please build the dashboard'],
    });
    assert.equal(matches.some((match) => match.value.toLowerCase() === 'please'), false);
    assert.equal(matches.length, 0);
  });

  it('applies only the selected token span', () => {
    const match = suggestLocal('plea task', 4).find((item) => item.value === 'please');
    if (!match) throw new Error('expected please completion');
    assert.deepEqual(applyLocalSuggestion('plea task', 4, match), {
      text: 'please task',
      cursor: 6,
    });
  });

  it('returns only the untyped suffix for inline ghost text', () => {
    const match = suggestLocal('plea', 4).find((item) => item.value === 'please');
    if (!match) throw new Error('expected please completion');
    assert.equal(inlineSuggestionSuffix('plea', 4, match), 'se');
    assert.equal(inlineSuggestionSuffix('plea', 2, match), '');
  });

  it('never autocorrects a typo while typing', () => {
    assert.equal(suggestLocal('teh', 3).length, 0);
    assert.equal(suggestLocal('teh ', 4).length, 0);
  });

  it('does not suggest inside commands, paths, URLs, identifiers, or secrets', () => {
    for (const value of [
      '/teh ',
      '!teh ',
      './teh ',
      'open ./teh ',
      'https://teh.test ',
      'open https://teh.test ',
      'MY_VAR ',
      'please MY_VAR ',
      'sk_live_1234567890 ',
      'const value = teh ',
    ]) {
      assert.equal(suggestLocal(value, value.length).length, 0, value);
    }
  });

  it('does not learn secret-shaped tokens from prompt history', () => {
    const matches = suggestLocal('use ', 4, {
      history: ['use sk_live_1234567890abcdef for this task'],
    });
    assert.equal(matches.some((match) => match.value.includes('sk_live')), false);
  });

  it('can be disabled without changing the draft', () => {
    assert.equal(suggestLocal('plea', 4, { settings: { autocomplete: false } }).length, 0);
  });
});
