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

  it('completes an identifier the session actually used', () => {
    // A coding session types snake_case and kebab-case names constantly. The
    // guard that used to reject every underscore threw those away with the
    // secrets it was aimed at.
    const snake = suggestLocal('open local_ass', 14, {
      history: ['refactor the local_assistance module'],
    });
    assert.equal(snake[0]?.value, 'local_assistance');
    const kebab = suggestLocal('open model-pi', 13, {
      history: ['open the model-picker component'],
    });
    assert.equal(kebab[0]?.value, 'model-picker');
  });

  it('still refuses to learn an environment variable seen in history', () => {
    // Lowercasing before the check is what let this through: `MY_API_TOKEN`
    // is only recognisable as one while it still has its original case.
    for (const draft of ['set MY_A', 'set my_a']) {
      const matches = suggestLocal(draft, draft.length, {
        history: ['set MY_API_TOKEN in the shell'],
      });
      assert.equal(matches.some((match) => match.value.includes('api_token')), false, draft);
    }
  });

  it('keeps predicting in a language it has no dictionary for', () => {
    // Only the built-in seed is English. Choosing another language used to
    // switch prediction off completely, including the user's own vocabulary.
    const settings = { language: 'pt' };
    const learned = suggestLocal('implementa', 10, {
      settings,
      history: ['implementar o carregamento'],
    });
    assert.equal(learned[0]?.value, 'implementar');
    assert.equal(learned[0]?.source, 'history');
    // The English seed itself stays out of it.
    assert.equal(suggestLocal('plea', 4, { settings }).length, 0);
  });

  it('builds its model once for a run of keystrokes', () => {
    // The model is rebuilt only when its inputs change. Without that, every
    // character walked the dictionary, the corpus and all of history inside
    // the render pass.
    const context = { history: ['please review the failing test'] };
    const first = suggestLocal('rev', 3, context);
    const again = suggestLocal('revi', 4, context);
    assert.equal(first[0]?.value, 'review');
    assert.equal(again[0]?.value, 'review');
    // A new prompt in history must be picked up rather than served stale.
    const grown = suggestLocal('rev', 3, {
      history: [...context.history, 'revert the migration'],
    });
    assert.ok(grown.some((match) => match.value === 'revert'));
  });

  it('can be disabled without changing the draft', () => {
    assert.equal(suggestLocal('plea', 4, { settings: { autocomplete: false } }).length, 0);
  });
});
