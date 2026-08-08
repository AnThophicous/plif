import type { Tool } from '../harness/tools.js';
import { SEARCH_HOSTS, search, stripTags } from './duckduckgo.js';
import type { SearchResponse } from './duckduckgo.js';

const READER = 'r.jina.ai';
const MAX_PAGE_CHARS = 20_000;

/**
 * Everything a search reaches, declared up front.
 *
 * `reachNetwork` authorises one host at a time, so the tool asks for all of
 * them before making any request. Being asked three permission questions in a
 * row for one search would train the developer to hold down "y".
 */
async function authorize(
  context: Parameters<Tool['run']>[1],
  hosts: readonly string[],
  reason: string,
): Promise<void> {
  for (const host of hosts) await context.container.reachNetwork(host, reason);
}

export const webSearch: Tool = {
  // Independent queries in one message is the normal way to research: three
  // angles at once, then read whichever looks right.
  parallelSafe: true,
  spec: {
    name: 'web_search',
    description:
      'Search the web with DuckDuckGo. Returns ranked results with URLs and ' +
      'snippets, plus an encyclopedic summary when the topic has one. Use it for ' +
      'anything outside this codebase: library documentation, error messages, API ' +
      'changes, versions. Then use web_fetch to read the page that looks right — ' +
      'a snippet is a reason to open something, not an answer.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to search for. Write it as a person would type it, not as a ' +
            'sentence — keywords beat prose.',
        },
        max_results: { type: 'number', description: 'How many results to return, 1-25. Default 8.' },
        region: { type: 'string', description: 'Region code such as "br-pt" or "us-en".' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },

  async run(input, context) {
    const query = typeof input['query'] === 'string' ? input['query'].trim() : '';
    if (!query) return { output: 'Error: web_search needs a "query".', ok: false };

    await authorize(context, SEARCH_HOSTS, `search the web for "${query}"`);

    const response = await search(query, {
      ...(typeof input['max_results'] === 'number' ? { maxResults: input['max_results'] } : {}),
      ...(typeof input['region'] === 'string' ? { region: input['region'] } : {}),
      signal: context.signal,
    });

    return { output: format(response), ok: response.results.length > 0 || response.instant !== null };
  },
};

export const webFetch: Tool = {
  parallelSafe: true,
  spec: {
    name: 'web_fetch',
    description:
      'Fetch a web page and read it as markdown, with the navigation, scripts and ' +
      'styling stripped out. Use it on a URL web_search returned, or any URL you ' +
      'already have. Long pages are truncated — say what you are looking for and ' +
      'search within the result rather than expecting the whole document.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },

  async run(input, context) {
    const raw = typeof input['url'] === 'string' ? input['url'].trim() : '';
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return { output: `Error: "${raw}" is not an absolute URL.`, ok: false };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return { output: `Error: ${target.protocol} is not a protocol this tool speaks.`, ok: false };
    }

    // Both hosts are named: the reader is a third party that will see the URL,
    // and the developer approving this deserves to know that rather than see
    // only the site they asked for.
    await authorize(context, [target.hostname, READER], `read ${target.hostname}`);

    const timeout = AbortSignal.timeout(30_000);
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;

    const response = await fetch(`https://${READER}/${target.toString()}`, {
      headers: { 'User-Agent': 'plif/0.1 (+https://github.com/plif)' },
      signal,
    });

    if (!response.ok) {
      return {
        output:
          `Error: fetching ${target.hostname} returned ${response.status}. ` +
          'The page may be behind a login, or the reader service may be rate limiting.',
        ok: false,
      };
    }

    const body = (await response.text()).trim();
    if (!body) return { output: `${target} returned an empty document.`, ok: false };

    const clipped =
      body.length > MAX_PAGE_CHARS
        ? `${body.slice(0, MAX_PAGE_CHARS)}\n\n… [${
            body.length - MAX_PAGE_CHARS
          } characters truncated]`
        : body;

    return { output: clipped, ok: true };
  },
};

export const WEB_TOOLS: readonly Tool[] = [webSearch, webFetch];

/**
 * Lay the answer out for a model, not a browser.
 *
 * Numbered so the agent can refer to "result 3", URL on its own line so it is
 * copyable, and the instant answer first because when there is one it is
 * usually the whole answer.
 */
export function format(response: SearchResponse): string {
  const parts: string[] = [];

  if (response.instant) {
    parts.push(
      `## ${response.instant.heading}`,
      response.instant.abstract,
      response.instant.url ? `— ${response.instant.source}: ${response.instant.url}` : `— ${response.instant.source}`,
    );
  }

  if (response.results.length > 0) {
    parts.push(
      '## Results',
      response.results
        .map(
          (result, index) =>
            `${index + 1}. ${result.title}\n   ${result.url}${
              result.snippet ? `\n   ${stripTags(result.snippet)}` : ''
            }`,
        )
        .join('\n'),
    );
  }

  if (response.related.length > 0) {
    parts.push(
      '## Related',
      response.related.map((item) => `- ${item.title}: ${item.url}`).join('\n'),
    );
  }

  // The distinction the whole module exists to preserve. "Nothing found" and
  // "we were turned away" lead a model to opposite conclusions, and only one of
  // them is a reason to stop looking.
  if (response.blocked) {
    parts.push(
      '## Web results unavailable',
      `${response.blocked}\n` +
        'This is not the same as "nothing matched" — the ranked list above is ' +
        'missing, not empty. What is shown came from the Instant Answer API. ' +
        'Try web_fetch on a URL you can guess (official docs, a repository), or ' +
        'say you could not search rather than answering from memory.',
    );
  }

  if (response.suggestions.length > 0 && response.results.length === 0) {
    parts.push(
      '## How this is usually phrased',
      response.suggestions.map((item) => `- ${item}`).join('\n'),
    );
  }

  if (parts.length === 0) {
    return `No results for "${response.query}", and no instant answer. The query may be too specific.`;
  }

  return parts.join('\n\n');
}
