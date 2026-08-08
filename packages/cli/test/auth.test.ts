import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { authNotice } from '../src/auth.js';

describe('OAuth notices', () => {
  it('renders a safe waiting notice for browser OAuth', () => {
    const notice = authNotice({
      requestId: 'request-1',
      server: 'github',
      phase: 'waiting',
      domain: 'github.com',
      scope: 'repo',
    });
    assert.match(notice.title, /github/);
    assert.match(notice.subtitle, /browser|authorization/i);
    assert.doesNotMatch(JSON.stringify(notice), /access_token|refresh_token|code_verifier/i);
  });

  it('shows the authorization URL, the only way through when no browser opens', () => {
    const notice = authNotice({
      requestId: 'request-2',
      server: 'github',
      phase: 'waiting',
      domain: 'github.com',
      authorizationUrl: 'https://github.com/login/oauth/authorize?state=abc',
      detail: 'no browser could be opened — visit the URL yourself to finish',
    });

    assert.match(notice.detail ?? '', /https:\/\/github\.com\/login\/oauth\/authorize\?state=abc/);
    assert.match(notice.detail ?? '', /no browser could be opened/);
  });

  it('carries the URL once the browser did open, for a second try', () => {
    const notice = authNotice({
      requestId: 'request-3',
      server: 'github',
      phase: 'opened',
      authorizationUrl: 'https://github.com/login/oauth/authorize?state=abc',
    });

    assert.equal(notice.detail, 'https://github.com/login/oauth/authorize?state=abc');
  });

  it('maps completion and failure to terminal states', () => {
    assert.equal(authNotice({ requestId: '1', server: 'x', phase: 'completed' }).status, 'done');
    assert.equal(authNotice({ requestId: '2', server: 'x', phase: 'failed' }).status, 'failed');
  });
});
