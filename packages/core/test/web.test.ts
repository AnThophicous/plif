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
import { format } from '../src/web/tools.js';
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
