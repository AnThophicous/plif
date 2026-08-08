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

export const SEARCH_HOSTS = Object.freeze([
  'api.duckduckgo.com',
  'html.duckduckgo.com',
  'duckduckgo.com',
]);

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const max = Math.max(1, Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, 25));

  // All three in parallel. They are independent services and the slowest one
  // should not decide how long a search takes.
  const [scraped, instant, suggestions] = await Promise.all([
    webResults(query, options).catch((error: unknown) => ({
      results: [] as SearchResult[],
      blocked: describeFailure(error),
    })),
    instantAnswer(query, options).catch(() => null),
    autocomplete(query, options).catch(() => [] as string[]),
  ]);

  return {
    query,
    results: dedupe(scraped.results).slice(0, max),
    instant: instant?.instant ?? null,
    related: (instant?.related ?? []).slice(0, max),
    suggestions: suggestions.slice(0, 6),
    blocked: scraped.blocked,
  };
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
  if (/anomaly[-_]modal|challenge|error-lite@duckduckgo/i.test(html)) {
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
  const results: SearchResult[] = [];

  // Anchors and snippets are matched separately and zipped by position: the
  // markup nests them in wrappers whose classes DuckDuckGo has changed several
  // times, and a regex spanning both breaks the moment one of them moves.
  const anchors = [
    ...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
  ];
  const snippets = [
    ...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g),
  ];

  for (const [index, anchor] of anchors.entries()) {
    const url = resolveRedirect(anchor[1] ?? '');
    const title = stripTags(anchor[2] ?? '');
    if (!url || !title) continue;
    results.push({
      title,
      url,
      snippet: stripTags(snippets[index]?.[1] ?? ''),
    });
  }

  return results;
}

/**
 * Unwrap `//duckduckgo.com/l/?uddg=<encoded>` into the real destination.
 *
 * Every result link is wrapped in that redirect. Handing it to the agent
 * unwrapped would give it a URL that says nothing about where it points, and
 * one it cannot judge before opening.
 */
export function resolveRedirect(href: string): string {
  const raw = href.startsWith('//') ? `https:${href}` : href;
  try {
    const parsed = new URL(raw, 'https://duckduckgo.com');
    const target = parsed.searchParams.get('uddg');
    const resolved = target ? decodeURIComponent(target) : parsed.toString();
    // Only the two schemes a result can meaningfully be. `new URL` happily
    // parses `javascript:` and `data:`, and a link the agent might hand to
    // web_fetch — or paste for a human to click — has no business being either.
    return /^https?:\/\//i.test(resolved) ? resolved : '';
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

  const response = await fetch(url, { headers: BROWSER_HEADERS, signal, redirect: 'follow' });
  if (!response.ok && response.status !== 202) {
    throw new Error(`${url.hostname} returned ${response.status}`);
  }
  return await response.text();
}

/** Collapse duplicate destinations, keeping the first and best-ranked one. */
function dedupe(results: readonly SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const kept: SearchResult[] = [];
  for (const result of results) {
    let key = result.url;
    try {
      const parsed = new URL(result.url);
      // Query strings and fragments are how the same page appears four times
      // with different tracking parameters.
      key = `${parsed.hostname}${parsed.pathname.replace(/\/$/, '')}`;
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
