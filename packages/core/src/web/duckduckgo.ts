/**
 * Searching the web with no API key.
 *
 * DuckDuckGo publishes two very different things, and conflating them is how
 * you ship a search tool that quietly returns nothing:
 *
 *   1. `api.duckduckgo.com` — the official Instant Answer API. Free, keyless,
 *      documented, reliable. It returns an *abstract* for a topic, not a
 *      ranked list of pages. Ask it "what is Kubernetes" and it is excellent;
 *      ask it "kubernetes CVE this week" and it is empty.
 *   2. `html.duckduckgo.com/html/` — the page a browser gets. This is where
 *      actual web results live, and DuckDuckGo actively defends it: a client
 *      that does not look like a browser gets HTTP 202 and a bot-challenge
 *      page instead of results. From some networks it works; from others it
 *      never does, and no header set changes that.
 *
 * So both are used, the scrape is best-effort, and — the part that matters —
 * a blocked scrape is reported as *blocked*, never as "no results". An agent
 * told "nothing found" concludes the thing does not exist; an agent told "the
 * search engine refused" knows to try another way. Same distinction the LSP
 * layer makes between "no server" and "no problems".
 */

import { webNetworkPool } from './network-pool.js';

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface InstantAnswer {
  readonly heading: string;
  readonly abstract: string;
  readonly source: string;
  readonly url: string;
}

export interface SearchResponse {
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly instant: InstantAnswer | null;
  readonly related: readonly SearchResult[];
  readonly suggestions: readonly string[];
  /** Set when the web-result scrape was refused rather than empty. */
  readonly blocked: string | null;
}

export interface SearchOptions {
  readonly maxResults?: number;
  /** DuckDuckGo region code, e.g. "br-pt", "us-en". */
  readonly region?: string;
  readonly safeSearch?: boolean;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number;
}

const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESULTS = 8;
const MAX_SEARCH_RESPONSE_BYTES = 1_000_000;
const MAX_RESULT_URL_CHARS = 2_048;
const BOT_CHECK_MARKERS: readonly RegExp[] = Object.freeze([
  /(?:class|id)\s*=\s*["'][^"']*\banomaly[-_]modal\b[^"']*["']/i,
  /\berror-lite@duckduckgo\b/i,
  /unfortunately,\s*bots\s+use\s+duckduckgo\s+too/i,
]);

export const SEARCH_HOSTS = Object.freeze([
  'api.duckduckgo.com',
  'html.duckduckgo.com',
  'duckduckgo.com',
]);

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  throwIfAborted(options.signal);
  const max = Math.max(1, Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, 25));

  // All three in parallel, but keep each endpoint's status independent. A
  // malformed autocomplete response must not erase ranked results, and one
  // failed endpoint should remain observable as blocked rather than becoming
  // an indistinguishable empty search.
  const settled = await Promise.allSettled([
    webResults(query, options),
    instantAnswer(query, options),
    autocomplete(query, options),
  ]);
  throwIfAborted(options.signal);

  const scraped = settled[0]!.status === 'fulfilled'
    ? settled[0]!.value
    : { results: [] as SearchResult[], blocked: describeFailure(settled[0]!.reason) };
  const instant = settled[1]!.status === 'fulfilled' ? settled[1]!.value : null;
  const suggestions = settled[2]!.status === 'fulfilled' ? settled[2]!.value : [];

  throwIfAborted(options.signal);

  return {
    query,
    results: dedupe(scraped.results).slice(0, max),
    instant: instant?.instant ?? null,
    related: (instant?.related ?? []).slice(0, max),
    suggestions: suggestions.slice(0, 6),
    blocked: scraped.blocked,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  if (reason !== undefined) throw new Error(String(reason));
  throw new Error('The operation was aborted.');
}

/**
 * Web results, by asking for the page a browser would get.
 *
 * Returns `blocked` rather than throwing when DuckDuckGo serves its challenge:
 * the caller still has the Instant Answer and needs to know which of "nothing
 * matched" and "we were turned away" happened.
 */
async function webResults(
  query: string,
  options: SearchOptions,
): Promise<{ results: SearchResult[]; blocked: string | null }> {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  if (options.region) url.searchParams.set('kl', options.region);
  url.searchParams.set('kp', options.safeSearch === false ? '-2' : '1');

  const html = await get(url, options);

  // The challenge page is a 202 with a real body, so status alone says nothing.
  // Match only markers from DuckDuckGo's bot-check page; result text can
  // legitimately contain words such as "challenge".
  if (BOT_CHECK_MARKERS.some((marker) => marker.test(html))) {
    return {
      results: [],
      blocked:
        'DuckDuckGo served a bot check instead of results. This is per-network ' +
        'and not something a different query fixes.',
    };
  }

  return { results: parseResults(html), blocked: null };
}

/** Pull results out of the HTML without a DOM parser. */
export function parseResults(html: string): SearchResult[] {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  let current: { title: string; url: string; snippet: string } | null = null;

  // Walk anchors in document order so a missing snippet cannot borrow the next
  // result's text. Attribute order and quote style are both variable in the
  // HTML returned by search engines, so inspect attributes independently.
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = anchor[1] ?? '';
    const body = anchor[2] ?? '';
    if (hasClass(attributes, 'result__a')) {
      current = null;
      const url = resolveRedirect(attributeValue(attributes, 'href') ?? '');
      const title = stripTags(body);
      if (!url || !title) continue;
      current = { title, url, snippet: '' };
      results.push(current);
      continue;
    }
    if (current && current.snippet === '' && hasClass(attributes, 'result__snippet')) {
      current.snippet = stripTags(body);
    }
  }

  return results;
}

function attributeValue(attributes: string, name: string): string | undefined {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  ).exec(attributes);
  return match?.[1] ?? match?.[2];
}

function hasClass(attributes: string, className: string): boolean {
  return attributeValue(attributes, 'class')?.split(/\s+/).includes(className) ?? false;
}

/**
 * Unwrap `//duckduckgo.com/l/?uddg=<encoded>` into the real destination.
 *
 * Every result link is wrapped in that redirect. Handing it to the agent
 * unwrapped would give it a URL that says nothing about where it points, and
 * one it cannot judge before opening.
 */
export function resolveRedirect(href: string): string {
  if (href.length > MAX_RESULT_URL_CHARS * 2) return '';
  const decoded = stripTags(href);
  const raw = decoded.startsWith('//') ? `https:${decoded}` : decoded;
  try {
    const parsed = new URL(raw, 'https://duckduckgo.com');
    const target = parsed.searchParams.get('uddg');
    const resolved = target ? decodeURIComponent(target) : parsed.toString();
    // Only the two schemes a result can meaningfully be. `new URL` happily
    // parses `javascript:` and `data:`, and a link the agent might hand to
    // web_fetch — or paste for a human to click — has no business being either.
    return /^https?:\/\//i.test(resolved) && resolved.length <= MAX_RESULT_URL_CHARS ? resolved : '';
  } catch {
    return '';
  }
}

async function instantAnswer(
  query: string,
  options: SearchOptions,
): Promise<{ instant: InstantAnswer | null; related: SearchResult[] }> {
  const url = new URL('https://api.duckduckgo.com/');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('no_redirect', '1');
  url.searchParams.set('skip_disambig', '1');

  const payload = JSON.parse(await get(url, options)) as {
    Heading?: string;
    AbstractText?: string;
    AbstractSource?: string;
    AbstractURL?: string;
    Definition?: string;
    DefinitionSource?: string;
    DefinitionURL?: string;
    RelatedTopics?: { Text?: string; FirstURL?: string; Topics?: unknown[] }[];
  };

  const text = payload.AbstractText?.trim() || payload.Definition?.trim() || '';
  const instant: InstantAnswer | null = text
    ? {
        heading: payload.Heading?.trim() || query,
        abstract: text,
        source: payload.AbstractSource?.trim() || payload.DefinitionSource?.trim() || 'DuckDuckGo',
        url: payload.AbstractURL?.trim() || payload.DefinitionURL?.trim() || '',
      }
    : null;

  // Nested topic groups are flattened away: they carry no URL of their own and
  // the agent cannot follow a heading.
  const related: SearchResult[] = [];
  for (const topic of payload.RelatedTopics ?? []) {
    if (!topic.FirstURL || !topic.Text) continue;
    const [head, ...rest] = topic.Text.split(' - ');
    related.push({
      title: (rest.length ? head : topic.Text) ?? topic.Text,
      url: topic.FirstURL,
      snippet: rest.join(' - '),
    });
  }

  return { instant, related };
}

/**
 * Query suggestions.
 *
 * Cheap, always available, and worth having precisely when the search failed:
 * they are evidence about how the query is usually phrased, which is often why
 * it found nothing.
 */
async function autocomplete(query: string, options: SearchOptions): Promise<string[]> {
  const url = new URL('https://duckduckgo.com/ac/');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'list');

  const payload = JSON.parse(await get(url, options)) as [string, string[]];
  return Array.isArray(payload?.[1]) ? payload[1] : [];
}

async function get(url: URL, options: SearchOptions): Promise<string> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  // Only SEARCH_HOSTS were authorised by the owning tool. A server-side
  // redirect must not silently widen that grant to an arbitrary hostname.
  const response = await webNetworkPool.run(
    () => fetch(url, { headers: BROWSER_HEADERS, signal, redirect: 'manual' }),
    signal,
  );
  if (!response.ok && response.status !== 202) {
    throw new Error(`${url.hostname} returned ${response.status}`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SEARCH_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error(`${url.hostname} response exceeded ${MAX_SEARCH_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  const chunks: string[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > MAX_SEARCH_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`${url.hostname} response exceeded ${MAX_SEARCH_RESPONSE_BYTES} bytes`);
      }
      chunks.push(decoder.decode(next.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

/** Collapse duplicate destinations, keeping the first and best-ranked one. */
function dedupe(results: readonly SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const kept: SearchResult[] = [];
  for (const result of results) {
    let key = result.url;
    try {
      const parsed = new URL(result.url);
      parsed.hash = '';
      for (const parameter of [...parsed.searchParams.keys()]) {
        if (/^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_[ce]id|ref|referrer|source)$/i.test(parameter)) {
          parsed.searchParams.delete(parameter);
        }
      }
      parsed.searchParams.sort();
      if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/$/, '');
      // Scheme, port and meaningful query parameters can identify genuinely
      // different sources. Only fragments and known tracking parameters vanish.
      key = parsed.toString();
    } catch {
      /* keep the raw string as the key */
    }
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(result);
  }
  return kept;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
  '#x27': "'",
  '#x2F': '/',
};

export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
      const named = ENTITIES[name];
      if (named !== undefined) return named;
      const numeric = /^#x/i.test(name)
        ? Number.parseInt(name.slice(2), 16)
        : /^#/.test(name)
          ? Number.parseInt(name.slice(1), 10)
          : Number.NaN;
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function describeFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'the web-result request timed out';
  }
  return `the web-result request failed: ${error instanceof Error ? error.message : String(error)}`;
}
