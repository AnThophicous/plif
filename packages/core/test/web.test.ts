/**
 * Parsing what DuckDuckGo actually sends back.
 *
 * The fixtures here are trimmed from real responses. The one behaviour worth
 * more than all the parsing put together is the last suite: a search that was
 * refused must never look like a search that found nothing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseResults, resolveRedirect, stripTags } from '../src/web/duckduckgo.js';
import { curl, format } from '../src/web/tools.js';
import type { ToolContext } from '../src/harness/tools.js';
import type { SearchResponse } from '../src/web/duckduckgo.js';

const empty: SearchResponse = {
  query: 'q',
  results: [],
  instant: null,
  related: [],
  suggestions: [],
  blocked: null,
};

describe('unwrapping result links', () => {
  it('pulls the destination out of the redirect every result is wrapped in', () => {
    // Handing the agent the wrapper would give it a URL that says nothing about
    // where it points, and one it cannot judge before opening.
    assert.equal(
      resolveRedirect('//duckduckgo.com/l/?uddg=https%3A%2F%2Fkubernetes.io%2Fdocs%2F&rut=abc'),
      'https://kubernetes.io/docs/',
    );
  });

  it('leaves a direct link alone', () => {
    assert.equal(resolveRedirect('https://example.com/a'), 'https://example.com/a');
  });

  it('returns empty for something that is not a URL at all', () => {
    assert.equal(resolveRedirect('javascript:alert(1)'), '');
  });
});

describe('extracting results from the page', () => {
  const html = `
    <div class="result results_links">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fkubernetes.io%2F">
        Kubernetes &amp; you
      </a>
      <a class="result__snippet" href="#">Production-grade <b>container</b> orchestration.</a>
    </div>
    <div class="result results_links">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fk8s">Guide</a>
      <a class="result__snippet" href="#">A walkthrough.</a>
    </div>`;

  it('reads title, url and snippet together', () => {
    const results = parseResults(html);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], {
      title: 'Kubernetes & you',
      url: 'https://kubernetes.io/',
      snippet: 'Production-grade container orchestration.',
    });
  });

  it('finds nothing in a page with no results, without throwing', () => {
    assert.deepEqual(parseResults('<html><body>nope</body></html>'), []);
  });
});

describe('decoding entities', () => {
  it('handles named, decimal and hex references', () => {
    assert.equal(stripTags('a &amp; b &#39;c&#39; &#x2F;d'), "a & b 'c' /d");
  });

  it('leaves an unknown reference visible rather than eating it', () => {
    assert.equal(stripTags('&notarealentity;'), '&notarealentity;');
  });

  it('collapses the whitespace that markup leaves behind', () => {
    assert.equal(stripTags('<b>a</b>\n   <i>b</i>'), 'a b');
  });
});

describe('refused is not empty', () => {
  it('says the ranked list is missing, not that nothing matched', () => {
    // The distinction the whole module exists to preserve. An agent told
    // "nothing found" concludes the thing does not exist; an agent told "the
    // search engine refused" knows to try another way.
    const output = format({ ...empty, blocked: 'DuckDuckGo served a bot check' });

    assert.match(output, /Web results unavailable/);
    assert.match(output, /missing, not empty/);
    assert.doesNotMatch(output, /No results for/);
  });

  it('says plainly when the search really did come back empty', () => {
    const output = format(empty);
    assert.match(output, /No results for "q"/);
    assert.doesNotMatch(output, /unavailable/);
  });

  it('numbers results so the agent can refer to one', () => {
    const output = format({
      ...empty,
      results: [{ title: 'Docs', url: 'https://k8s.io', snippet: 'about' }],
    });
    assert.match(output, /1\. Docs/);
    assert.match(output, /https:\/\/k8s\.io/);
  });

  it('offers phrasings only when there were no results to offer instead', () => {
    const withResults = format({
      ...empty,
      results: [{ title: 'Docs', url: 'https://k8s.io', snippet: '' }],
      suggestions: ['kubernetes tutorial'],
    });
    assert.doesNotMatch(withResults, /usually phrased/);

    const without = format({ ...empty, suggestions: ['kubernetes tutorial'] });
    assert.match(without, /usually phrased/);
  });
});

describe('native curl tool', () => {
  it('sends structured JSON and formats a JSON response', async () => {
    const original = globalThis.fetch;
    let request: RequestInit | undefined;
    globalThis.fetch = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      request = init;
      return new Response('{"ok":true}', {
        status: 201,
        headers: { 'content-type': 'application/json', 'set-cookie': 'secret=1' },
      });
    }) as typeof fetch;
    const reached: string[] = [];
    try {
      const result = await curl.run({
        url: 'https://api.example.test/items',
        method: 'post',
        headers: { authorization: 'Bearer secret' },
        json: { name: 'plif' },
      }, {
        container: { reachNetwork: async (host: string) => { reached.push(host); } },
        signal: undefined,
      } as unknown as ToolContext);
      assert.equal(result.ok, true);
      assert.deepEqual(reached, ['api.example.test']);
      assert.equal(request?.method, 'POST');
      assert.equal(request?.body, '{"name":"plif"}');
      assert.match(result.output, /201/);
      assert.match(result.output, /"ok": true/);
      assert.doesNotMatch(result.output, /secret/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('requires authorization again when a redirect changes host', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    const authorization: Array<string | null> = [];
    globalThis.fetch = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      calls += 1;
      authorization.push(new Headers(init?.headers).get('authorization'));
      return calls === 1
        ? new Response('', { status: 302, headers: { location: 'https://second.example.test/done' } })
        : new Response('done', { status: 200, headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch;
    const reached: string[] = [];
    try {
      const result = await curl.run({
        url: 'https://first.example.test/start',
        headers: { authorization: 'Bearer private' },
      }, {
        container: { reachNetwork: async (host: string) => { reached.push(host); } },
        signal: undefined,
      } as unknown as ToolContext);
      assert.equal(result.ok, true);
      assert.deepEqual(reached, ['first.example.test', 'second.example.test']);
      assert.deepEqual(authorization, ['Bearer private', null]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
