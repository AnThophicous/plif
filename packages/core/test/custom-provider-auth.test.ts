import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeCustomProviderDefinition } from '../src/model/provider-definitions.js';

function parse(auth: string): { auth: string; needKey: boolean } {
  const parsed = normalizeCustomProviderDefinition({
    id: 'acme',
    baseURL: 'https://acme.example/v1',
    auth,
  } as never);
  return { auth: parsed.auth, needKey: parsed.needKey };
}

describe('custom provider authentication', () => {
  it('keeps loading a config written when Codex was still a provider', () => {
    // Removing the provider must not turn a file the user never touched into a
    // startup error; the route it should have been on is OpenAI OAuth.
    assert.equal(parse('codex').auth, 'openai-oauth');
  });

  it('does not ask an OAuth provider for an API key', () => {
    // OAuth carries its own credential, so needKey here is a prompt for a key
    // that has nowhere to go.
    assert.equal(parse('openai-oauth').needKey, false);
    assert.equal(parse('codex').needKey, false);
  });

  it('still requires a key for an ordinary remote provider', () => {
    assert.equal(parse('api-key').needKey, true);
  });

  it('rejects an authentication mode that no longer exists', () => {
    assert.throws(() => parse('chatgpt-app'), /api-key/);
  });
});
