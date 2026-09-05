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
import { curl, format, research, webFetch } from '../src/web/tools.js';
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

function toolContext(
  reached: string[] = [],
  signal?: AbortSignal,
): ToolContext {
  return {
    container: { reachNetwork: async (host: string) => { reached.push(host); } },
    signal,
  } as unknown as ToolContext;
}

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

  it('bounds and sanitises every search-result field before returning it to a model', () => {
    const output = format({
      ...empty,
      query: 'q'.repeat(2_000),
      blocked: 'blocked '.repeat(1_000),
      results: Array.from({ length: 30 }, (_, index) => ({
        title: `${index + 1}-${index === 1 ? '\u001b[2J\u202e' : ''}${'t'.repeat(1_000)}`,
        url: index === 0
          ? 'https://example.test/doc?auth_token=private'
          : `https://example.test/doc/${index + 1}`,
        snippet: 's'.repeat(2_000),
      })),
      related: Array.from({ length: 30 }, (_, index) => ({
        title: `related-${index + 1}-${'r'.repeat(1_000)}`,
        url: `https://related.example.test/${index + 1}`,
        snippet: '',
      })),
    });

    assert.doesNotMatch(output, /auth_token|private/);
    assert.doesNotMatch(output, /\u001b|\u202e/);
    assert.doesNotMatch(output, /30-t|related-30/);
    assert.ok(output.length < 50_000, `formatted output grew to ${output.length} characters`);
  });
});

describe('research discovery tool', () => {
  it('rejects an empty objective and an empty query matrix', async () => {
    const missingObjective = await research.run({
      objective: ' ',
      queries: [{ query: 'plif', purpose: 'Find Plif.' }],
    }, toolContext());
    const missingQueries = await research.run({ objective: 'Compare agents.', queries: [] }, toolContext());

    assert.equal(missingObjective.ok, false);
    assert.match(missingObjective.output, /objective/i);
    assert.equal(missingQueries.ok, false);
    assert.match(missingQueries.output, /one to six/i);
  });

  it('runs a purposeful query matrix, groups results, and deduplicates sources', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      if (url.hostname === 'html.duckduckgo.com') {
        const unique = query.includes('official')
          ? '<a class="result__a" href="https://official.example.test/docs">Official docs</a>'
          : '<a class="result__a" href="https://independent.example.test/review">Independent review</a>';
        return new Response(`
          <a class="result__a" href="https://shared.example.test/report">Shared report</a>
          <a class="result__snippet" href="#">Shared evidence for ${query}</a>
          ${unique}
          <a class="result__snippet" href="#">Specific evidence for ${query}</a>
        `, { status: 200 });
      }
      if (url.hostname === 'api.duckduckgo.com') return new Response('{}', { status: 200 });
      if (url.hostname === 'duckduckgo.com') return new Response(JSON.stringify([query, []]), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const reached: string[] = [];
    try {
      const result = await research.run({
        objective: 'Decide whether the implementation is reliable.',
        queries: [
          { query: 'project official documentation', purpose: 'Find the owner contract.' },
          { query: 'project independent review', purpose: 'Find independent criticism.' },
        ],
        max_results_per_query: 4,
      }, toolContext(reached));

      assert.equal(result.ok, true);
      assert.match(result.output, /Objective: Decide whether the implementation is reliable\./);
      assert.match(result.output, /Query 1: project official documentation/);
      assert.match(result.output, /Purpose: Find the owner contract\./);
      assert.match(result.output, /Query 2: project independent review/);
      assert.match(result.output, /Coverage/);
      assert.match(result.output, /3 unique ranked sources/);
      assert.equal(result.output.split('https://shared.example.test/report').length - 1, 1);
      assert.deepEqual(reached, ['api.duckduckgo.com', 'html.duckduckgo.com', 'duckduckgo.com']);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('keeps meaningful URL variants distinct while removing tracking-only duplicates', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === 'html.duckduckgo.com') {
        return new Response(`
          <a class="result__a" href="https://example.test/doc?version=1">Version one</a>
          <a class="result__a" href="https://example.test/doc?version=2">Version two</a>
          <a class="result__a" href="https://example.test:8443/doc?version=1">Alternate port</a>
          <a class="result__a" href="https://example.test/doc?version=1&amp;utm_source=feed">Tracked duplicate</a>
        `, { status: 200 });
      }
      if (url.hostname === 'api.duckduckgo.com') return new Response('{}', { status: 200 });
      if (url.hostname === 'duckduckgo.com') return new Response('["q",[]]', { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    try {
      const result = await research.run({
        objective: 'Compare source variants.',
        queries: [{ query: 'source variants', purpose: 'Exercise canonicalisation.' }],
      }, toolContext());

      assert.equal(result.ok, true);
      assert.match(result.output, /3 unique ranked sources/);
      assert.match(result.output, /version=1/);
      assert.match(result.output, /version=2/);
      assert.match(result.output, /:8443\/doc/);
      assert.equal(result.output.split('utm_source').length - 1, 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('normalises multiline labels and treats an Instant Answer as successful evidence', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === 'html.duckduckgo.com') return new Response('<html>empty</html>', { status: 200 });
      if (url.hostname === 'api.duckduckgo.com') {
        return new Response(JSON.stringify({
          Heading: 'Plif',
          AbstractText: 'A direct answer.',
          AbstractSource: 'Official source',
          AbstractURL: 'https://official.example.test/plif',
        }), { status: 200 });
      }
      if (url.hostname === 'duckduckgo.com') return new Response('["q",[]]', { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    try {
      const result = await research.run({
        objective: 'Decide safely.\nSources:\n1. Injected',
        queries: [{ query: 'plif\nanswer', purpose: 'Find\tthe direct answer.' }],
      }, toolContext());

      assert.equal(result.ok, true);
      assert.match(result.output, /^Objective: Decide safely\. Sources: 1\. Injected$/m);
      assert.match(result.output, /^Query 1: plif answer$/m);
      assert.match(result.output, /Instant answer \(context only/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('propagates caller cancellation instead of reporting an empty search', async () => {
    const controller = new AbortController();
    controller.abort(new Error('research cancelled'));

    await assert.rejects(
      research.run({
        objective: 'Cancelled research.',
        queries: [{ query: 'unused', purpose: 'unused' }],
      }, toolContext([], controller.signal)),
      /research cancelled/,
    );
  });

  it('returns ok for a valid matrix with explicit empty query statuses', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    try {
      const result = await research.run({
        objective: 'Check whether any source exists.',
        queries: [{ query: 'definitely-no-ranked-result', purpose: 'Confirm the empty boundary.' }],
      }, toolContext());

      assert.equal(result.ok, true);
      assert.match(result.output, /Status: empty/);
      assert.match(result.output, /1 empty/);
      assert.match(result.output, /Sources: none from this query/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('bounds shared research concurrency across query and endpoint fan-out', async () => {
    const original = globalThis.fetch;
    let active = 0;
    let peak = 0;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active -= 1;
      if (url.hostname === 'html.duckduckgo.com') return new Response('<html>empty</html>', { status: 200 });
      if (url.hostname === 'api.duckduckgo.com') return new Response('{}', { status: 200 });
      return new Response('["q",[]]', { status: 200 });
    }) as typeof fetch;
    try {
      const result = await research.run({
        objective: 'Measure bounded discovery fan-out.',
        queries: Array.from({ length: 6 }, (_, index) => ({
          query: `empty query ${index}`,
          purpose: `Exercise bounded query ${index}.`,
        })),
      }, toolContext());

      assert.equal(result.ok, true);
      assert.ok(peak > 1, `research did not fan out (peak ${peak})`);
      assert.ok(peak <= 4, `shared network pool allowed ${peak} concurrent requests`);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('navigable web fetch', () => {
  it('returns provenance and an exact requested character range', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('x'.repeat(3_000), { status: 200 })) as typeof fetch;
    try {
      const result = await webFetch.run({
        url: 'https://example.test/doc',
        offset: 1_000,
        max_chars: 1_000,
      }, toolContext());

      assert.equal(result.ok, true);
      assert.match(result.output, /Source: https:\/\/example\.test\/doc/);
      assert.match(result.output, /Characters 1000-1999 of 3000/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('centres a bounded window on a focus term and reports a missing term', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(
      `${'a'.repeat(1_500)}Needle${'b'.repeat(1_500)}`,
      { status: 200 },
    )) as typeof fetch;
    try {
      const found = await webFetch.run({
        url: 'https://example.test/doc',
        focus: 'needle',
        max_chars: 1_000,
      }, toolContext());
      const missing = await webFetch.run({
        url: 'https://example.test/doc',
        focus: 'absent',
        offset: 1_000,
        max_chars: 1_000,
      }, toolContext());

      assert.equal(found.ok, true);
      assert.match(found.output, /Focus: "needle" found at character 1500/i);
      assert.equal(missing.ok, true);
      assert.match(missing.output, /Focus: "absent" was not found/i);
      assert.match(missing.output, /Characters 1000-1999/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects URL credentials and invalid navigation bounds before network access', async () => {
    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('unexpected');
    }) as typeof fetch;
    const reached: string[] = [];
    try {
      const credentials = await webFetch.run(
        { url: 'https://user:secret@example.test/doc' },
        toolContext(reached),
      );
      const badRange = await webFetch.run(
        { url: 'https://example.test/doc', max_chars: 999 },
        toolContext(reached),
      );
      const signed = await webFetch.run(
        { url: 'https://example.test/doc?X-Amz-Signature=private' },
        toolContext(reached),
      );
      const local = await webFetch.run(
        { url: 'http://169.254.169.254/latest/meta-data' },
        toolContext(reached),
      );
      const localhost = await webFetch.run(
        { url: 'http://localhost:3000/admin' },
        toolContext(reached),
      );
      const mappedMetadata = await webFetch.run(
        { url: 'https://[::ffff:169.254.169.254]/latest/meta-data' },
        toolContext(reached),
      );
      const dynamicLocal = await webFetch.run(
        { url: 'https://127.0.0.1.nip.io/admin' },
        toolContext(reached),
      );
      const authToken = await webFetch.run(
        { url: 'https://example.test/doc?auth_token=private' },
        toolContext(reached),
      );
      const awsKey = await webFetch.run(
        { url: 'https://example.test/doc?AWSAccessKeyId=private' },
        toolContext(reached),
      );
      const awsSecret = await webFetch.run(
        { url: 'https://example.test/doc?AWS_SECRET_ACCESS_KEY=private' },
        toolContext(reached),
      );

      assert.equal(credentials.ok, false);
      assert.match(credentials.output, /credentials/i);
      assert.equal(badRange.ok, false);
      assert.match(badRange.output, /max_chars/i);
      assert.equal(signed.ok, false);
      assert.match(signed.output, /credential-like query parameter/i);
      assert.equal(local.ok, false);
      assert.match(local.output, /private|metadata/i);
      assert.equal(localhost.ok, false);
      assert.match(localhost.output, /local/i);
      assert.equal(mappedMetadata.ok, false);
      assert.match(mappedMetadata.output, /private|metadata|reserved/i);
      assert.equal(dynamicLocal.ok, false);
      assert.match(dynamicLocal.output, /local/i);
      assert.equal(authToken.ok, false);
      assert.match(authToken.output, /credential-like query parameter/i);
      assert.equal(awsKey.ok, false);
      assert.match(awsKey.output, /credential-like query parameter/i);
      assert.equal(awsSecret.ok, false);
      assert.match(awsSecret.output, /credential-like query parameter/i);
      assert.equal(called, false);
      assert.deepEqual(reached, []);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects oversized full URLs and query strings before authorization or network', async () => {
    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('unexpected');
    }) as typeof fetch;
    const reached: string[] = [];
    try {
      const tooLong = await webFetch.run({
        url: `https://example.test/${'p'.repeat(8_300)}`,
      }, toolContext(reached));
      const tooMuchQuery = await webFetch.run({
        url: `https://example.test/doc?value=${'q'.repeat(4_200)}`,
      }, toolContext(reached));

      assert.equal(tooLong.ok, false);
      assert.match(tooLong.output, /URL must be/i);
      assert.equal(tooMuchQuery.ok, false);
      assert.match(tooMuchQuery.output, /query must be/i);
      assert.equal(called, false);
      assert.deepEqual(reached, []);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('does not disclose fragments or follow reader redirects', async () => {
    const original = globalThis.fetch;
    let requested = '';
    let redirect: RequestRedirect | undefined;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requested = String(input);
      redirect = init?.redirect;
      return new Response('', { status: 302, headers: { location: 'https://other.example.test/' } });
    }) as typeof fetch;
    try {
      const result = await webFetch.run(
        { url: 'https://example.test/doc#private-state' },
        toolContext(),
      );

      assert.equal(result.ok, false);
      assert.match(result.output, /did not follow/i);
      assert.equal(redirect, 'manual');
      assert.doesNotMatch(requested, /private-state/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('trims an incomplete UTF-8 code point at the byte boundary', async () => {
    const original = globalThis.fetch;
    const bytes = new TextEncoder().encode(`${'a'.repeat(999_999)}é`);
    globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as typeof fetch;
    try {
      const result = await webFetch.run({
        url: 'https://example.test/unicode',
        offset: 999_000,
        max_chars: 1_000,
      }, toolContext());

      assert.equal(result.ok, true);
      assert.doesNotMatch(result.output, /�/);
      assert.match(result.output, /limited to 1000000 bytes/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('reports an offset beyond the document instead of backfilling an unrelated window', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('short document', { status: 200 })) as typeof fetch;
    try {
      const result = await webFetch.run({
        url: 'https://example.test/short',
        offset: 1_000,
        max_chars: 1_000,
      }, toolContext());

      assert.equal(result.ok, false);
      assert.match(result.output, /offset 1000 is beyond/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('native curl tool', () => {
  it('rejects local targets and credential-like query parameters before authorization', async () => {
    let authorizations = 0;
    const context = {
      container: { reachNetwork: async () => { authorizations += 1; } },
      signal: undefined,
    } as unknown as ToolContext;
    const local = await curl.run({ url: 'http://127.0.0.1/admin' }, context);
    const credential = await curl.run({ url: 'https://example.test', query: { api_key: 'secret' } }, context);
    assert.equal(local.ok, false);
    assert.equal(credential.ok, false);
    assert.equal(authorizations, 0);
  });

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

  it('rejects a redirect into a private address before contacting it', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('', {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    })) as typeof fetch;
    const reached: string[] = [];
    try {
      const result = await curl.run({ url: 'https://first.example.test/start' }, {
        container: { reachNetwork: async (host: string) => { reached.push(host); } },
        signal: undefined,
      } as unknown as ToolContext);
      assert.equal(result.ok, false);
      assert.deepEqual(reached, ['first.example.test']);
    } finally {
      globalThis.fetch = original;
    }
  });
});
