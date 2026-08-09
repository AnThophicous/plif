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
export async function authorize(
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

const MAX_HTTP_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i;

export const curl: Tool = {
  parallelSafe: true,
  spec: {
    name: 'curl',
    description:
      'Make an HTTP request without using the terminal. Use this for APIs, health checks, ' +
      'webhooks and JSON endpoints. Supports methods, query parameters, headers, JSON or ' +
      'text bodies, redirects and timeouts. Prefer web_fetch when the goal is to read a web page.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL.' },
        method: { type: 'string', description: 'HTTP method. Default GET.' },
        query: {
          type: 'object',
          description: 'Query parameters appended to the URL.',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
        },
        headers: {
          type: 'object',
          description: 'Request headers. Secret values are never echoed to the terminal.',
          additionalProperties: { type: 'string' },
        },
        json: { description: 'JSON value to serialize as the request body.' },
        body: { type: 'string', description: 'Raw text request body. Cannot be combined with json.' },
        timeout_ms: { type: 'number', description: 'Timeout from 1000 to 120000 ms. Default 30000.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  async run(input, context) {
    let target: URL;
    try {
      target = new URL(typeof input['url'] === 'string' ? input['url'].trim() : '');
    } catch {
      return { output: 'Error: curl needs an absolute HTTP or HTTPS URL.', ok: false };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return { output: `Error: curl does not support ${target.protocol}.`, ok: false };
    }
    if (target.username || target.password) {
      return { output: 'Error: put credentials in headers, not in the URL.', ok: false };
    }

    const query = input['query'];
    if (query !== undefined && (!query || typeof query !== 'object' || Array.isArray(query))) {
      return { output: 'Error: query must be an object.', ok: false };
    }
    for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>)) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        return { output: `Error: query parameter "${key}" must be a string, number or boolean.`, ok: false };
      }
      target.searchParams.append(key, String(value));
    }

    const rawHeaders = input['headers'];
    if (rawHeaders !== undefined && (!rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders))) {
      return { output: 'Error: headers must be an object.', ok: false };
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries((rawHeaders ?? {}) as Record<string, unknown>)) {
      if (typeof value !== 'string') return { output: `Error: header "${key}" must be a string.`, ok: false };
      headers.set(key, value);
    }

    if (input['json'] !== undefined && input['body'] !== undefined) {
      return { output: 'Error: use either json or body, not both.', ok: false };
    }
    const method = typeof input['method'] === 'string' ? input['method'].trim().toUpperCase() : 'GET';
    if (!/^[A-Z]+$/.test(method)) return { output: `Error: invalid HTTP method "${method}".`, ok: false };
    let body: string | undefined;
    if (input['json'] !== undefined) {
      body = JSON.stringify(input['json']);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    } else if (typeof input['body'] === 'string') body = input['body'];
    if (body !== undefined && (method === 'GET' || method === 'HEAD')) {
      return { output: `Error: ${method} requests cannot carry a body.`, ok: false };
    }

    const requestedTimeout = typeof input['timeout_ms'] === 'number' ? input['timeout_ms'] : 30_000;
    const timeoutMs = Math.max(1_000, Math.min(120_000, Math.floor(requestedTimeout)));
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;

    let response: Response | undefined;
    let current = target;
    let requestMethod = method;
    let requestBody = body;
    const requestHeaders = new Headers(headers);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      await authorize(context, [current.hostname], `${requestMethod} ${current.hostname}`);
      response = await fetch(current, {
        method: requestMethod,
        headers: requestHeaders,
        ...(requestBody === undefined ? {} : { body: requestBody }),
        redirect: 'manual',
        signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) break;
      if (redirect === MAX_REDIRECTS) return { output: `Error: more than ${MAX_REDIRECTS} redirects.`, ok: false };
      const previous = current;
      current = new URL(location, current);
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        return { output: `Error: redirect uses unsupported protocol ${current.protocol}.`, ok: false };
      }
      // Credentials for one origin never ride a redirect to another one.
      if (current.origin !== previous.origin) {
        for (const name of [...requestHeaders.keys()]) {
          if (SECRET_HEADER.test(name)) requestHeaders.delete(name);
        }
      }
      // Match browser/fetch redirect semantics for 303 and traditional POST
      // redirects, while 307/308 deliberately preserve method and body.
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && requestMethod === 'POST')) {
        requestMethod = 'GET';
        requestBody = undefined;
        requestHeaders.delete('content-type');
        requestHeaders.delete('content-length');
      }
    }
    if (!response) return { output: 'Error: request did not produce a response.', ok: false };

    const { bytes, truncated } = await readLimited(response, MAX_HTTP_BYTES);
    const contentType = response.headers.get('content-type') ?? '';
    const textual = /(?:^text\/|json|xml|javascript|x-www-form-urlencoded)/i.test(contentType);
    let responseBody = textual ? new TextDecoder().decode(bytes) : `[binary body: ${bytes.length} bytes]`;
    if (/json/i.test(contentType) && responseBody) {
      try { responseBody = JSON.stringify(JSON.parse(responseBody), null, 2); } catch { /* keep invalid JSON visible */ }
    }
    if (truncated) responseBody += `\n… [response truncated at ${MAX_HTTP_BYTES} bytes]`;

    const safeHeaders = [...response.headers.entries()]
      .filter(([name]) => !SECRET_HEADER.test(name))
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n');
    const output = [
      `${response.status} ${response.statusText || ''}`.trim(),
      safeHeaders,
      responseBody.trimEnd(),
    ].filter(Boolean).join('\n\n');
    return { output, ok: response.ok };
  },
};

async function readLimited(response: Response, limit: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = limit - total;
      if (next.value.length > remaining) {
        if (remaining > 0) chunks.push(next.value.slice(0, remaining));
        total = limit;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(next.value);
      total += next.value.length;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated };
}

export const WEB_TOOLS: readonly Tool[] = [webSearch, webFetch, curl];

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
