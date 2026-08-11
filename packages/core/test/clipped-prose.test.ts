/**
 * Telling a truncated turn apart from a terse one.
 *
 * Some OpenAI-compatible gateways stop forwarding `content` the moment the
 * model emits a tool call, so a sentence ends in the middle and the missing
 * words never reach us. Plif cannot recover them, but it can say who dropped
 * them — and to be worth saying, it has to be right, which means never firing
 * on a model that simply writes short sentences without a full stop.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { endsMidSentence } from '../src/harness/loop.js';

describe('endsMidSentence', () => {
  it('catches a sentence cut after an article', () => {
    assert.equal(endsMidSentence('py funciona — Python 3.14.7. Agora verifico o'), true);
  });

  it('catches a sentence cut after a preposition', () => {
    assert.equal(endsMidSentence('I read the manifest and it depends on'), true);
  });

  it('catches a long sentence sheared off mid-word', () => {
    // Real cuts, taken verbatim from a recorded session. "vis" is the front of
    // "visão" and "Q" the front of "QwenBridge" — no model stops there.
    assert.equal(
      endsMidSentence(
        'Vou começar explorando o projeto QwenBridge para entender o que existe e o ' +
          'que significa "botar no ar" o modelo de vis',
      ),
      true,
    );
    assert.equal(
      endsMidSentence('Tenho tudo que preciso. Vou criar a skill de geração de imagem/vídeo via Q'),
      true,
    );
  });

  it('leaves a terse sentence with no full stop alone', () => {
    // The shape a model genuinely produces before a call. Short, and it ends on
    // a word that finishes the thought, so neither signal fires.
    assert.equal(endsMidSentence('Let me check the lockfile'), false);
    assert.equal(endsMidSentence('Vou verificar o arquivo'), false);
    assert.equal(endsMidSentence('Reading package.json now'), false);
  });

  it('measures only the unterminated run, not the whole turn', () => {
    // A page of finished prose plus a short closing line is not a cut.
    const long = 'I checked the manifest and the lockfile agree on every version. ';
    assert.equal(endsMidSentence(`${long.repeat(4)}Now running tests`), false);
  });

  it('leaves properly punctuated prose alone', () => {
    assert.equal(endsMidSentence('Found it. The version is pinned in package.json.'), false);
    assert.equal(endsMidSentence('Here is what I will do:'), false);
  });

  it('ignores text too short to judge', () => {
    assert.equal(endsMidSentence(''), false);
    assert.equal(endsMidSentence('the'), false);
  });

  it('ignores trailing whitespace the stream left behind', () => {
    assert.equal(endsMidSentence('Agora verifico o   \n'), true);
  });

  it('does not fire on a fenced block or a list', () => {
    assert.equal(endsMidSentence('Run this:\n\n```sh\nnpm test\n```'), false);
    assert.equal(endsMidSentence('Two things:\n- the manifest\n- the lockfile'), false);
  });
});
