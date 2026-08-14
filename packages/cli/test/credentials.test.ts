import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { credentialChoice, credentialProbeFailure, credentialPrompt } from '../src/credentials.js';

describe('API key prompt', () => {
  it('keeps the three storage choices distinct', () => {
    assert.equal(credentialChoice('save'), 'save');
    assert.equal(credentialChoice('session'), 'session');
    assert.equal(credentialChoice('cancel'), 'cancel');
    assert.equal(credentialChoice(null), 'cancel');
    assert.equal(credentialChoice('unexpected'), 'cancel');
  });

  it('names the provider, model, storage location and masked handling', () => {
    const prompt = credentialPrompt('OpenAI', 'gpt-5-codex', 'OPENAI_API_KEY');
    assert.match(prompt.text, /OpenAI/);
    assert.match(prompt.text, /gpt-5-codex/);
    assert.match(prompt.context, /OPENAI_API_KEY/);
    assert.match(prompt.context, /masked|never enters the transcript/i);
  });

  it('only calls a credential invalid when the probe reports an auth failure', () => {
    assert.match(credentialProbeFailure('OpenAI', 'gpt-5-codex', '401 Unauthorized').title, /rejected/i);
    assert.match(credentialProbeFailure('OpenAI', 'gpt-5-codex', '127.0.0.1 returned 503').title, /Could not verify/i);
  });
});
