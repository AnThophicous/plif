import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseResults, search } from '../src/web/duckduckgo.js';

function mockSearchFetch(html: string): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (url.hostname === 'html.duckduckgo.com') return new Response(html, { status: 200 });
    if (url.hostname === 'api.duckduckgo.com') return new Response('{}', { status: 200 });
    if (url.hostname === 'duckduckgo.com') return new Response('["query",[]]', { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
}

describe('DuckDuckGo regressions', () => {
  it('does not follow a search redirect to an unauthorised host', async () => {
    const original = globalThis.fetch;
    const requested: string[] = [];
    const redirects: Array<RequestRedirect | undefined> = [];
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      requested.push(url.hostname);
      redirects.push(init?.redirect);
      if (url.hostname === 'html.duckduckgo.com') {
        return new Response('', {
          status: 302,
          headers: { location: 'https://unapproved.example.test/results' },
        });
      }
      if (url.hostname === 'api.duckduckgo.com') return new Response('{}', { status: 200 });
      if (url.hostname === 'duckduckgo.com') return new Response('["query",[]]', { status: 200 });
      throw new Error(`Unexpected redirected request: ${url}`);
    }) as typeof fetch;
    try {
      const response = await search('redirect boundary');

      assert.match(response.blocked ?? '', /returned 302/i);
      assert.doesNotMatch(requested.join(','), /unapproved/);
      assert.equal(redirects.every((mode) => mode === 'manual'), true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('cancels and reports a chunked search response after the byte ceiling', async () => {
    const original = globalThis.fetch;
    let cancelled = false;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === 'html.duckduckgo.com') {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(600_000));
            controller.enqueue(new Uint8Array(600_000));
          },
          cancel() { cancelled = true; },
        });
        return new Response(body, { status: 200 });
      }
      if (url.hostname === 'api.duckduckgo.com') return new Response('{}', { status: 200 });
      if (url.hostname === 'duckduckgo.com') return new Response('["query",[]]', { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    try {
      const response = await search('oversized response');

      assert.equal(response.results.length, 0);
      assert.match(response.blocked ?? '', /exceeded 1000000 bytes/i);
      assert.equal(cancelled, true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('does not classify a legitimate result containing challenge as a bot check', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mockSearchFetch(`
      <a class="result__a" href="https://example.test/challenge">Coding challenge guide</a>
      <a class="result__snippet" href="#">A normal result page.</a>
    `);
    try {
      const response = await search('challenge');

      assert.equal(response.blocked, null);
      assert.equal(response.results.length, 1);
      assert.equal(response.results[0]?.title, 'Coding challenge guide');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('still marks an explicit anomaly modal as blocked', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mockSearchFetch('<div class="anomaly-modal">Please verify you are human.</div>');
    try {
      const response = await search('ordinary query');

      assert.equal(response.results.length, 0);
      assert.match(response.blocked ?? '', /bot check/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('parses each result independently across attribute order and quote styles', () => {
    const html = `
      <div class='result results_links'>
        <a href='https://first.test/doc' class='result__a'>First result</a>
      </div>
      <div class="result results_links">
        <a class="result__a" data-kind='result' href="https://second.test/doc">Second result</a>
        <a href='#' class='result__snippet'>Second snippet only</a>
      </div>`;

    assert.deepEqual(parseResults(html), [
      { title: 'First result', url: 'https://first.test/doc', snippet: '' },
      { title: 'Second result', url: 'https://second.test/doc', snippet: 'Second snippet only' },
    ]);
  });
});
