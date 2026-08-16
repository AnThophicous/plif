import { isIP } from 'node:net';

import type { Tool } from '../harness/tools.js';
import { SEARCH_HOSTS, search, stripTags } from './duckduckgo.js';
import type { SearchResponse } from './duckduckgo.js';
import { webNetworkPool } from './network-pool.js';

const READER = 'r.jina.ai';
const MAX_PAGE_CHARS = 20_000;
const MIN_PAGE_CHARS = 1_000;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_PAGE_OFFSET = 1_000_000;
const MAX_PAGE_URL_CHARS = 8_192;
const MAX_PAGE_QUERY_CHARS = 4_096;
const MAX_FOCUS_CHARS = 200;
const MAX_SEARCH_QUERY_CHARS = 500;
const MAX_RESEARCH_OBJECTIVE_CHARS = 1_000;
const MAX_RESEARCH_QUERY_CHARS = 500;
const MAX_RESEARCH_PURPOSE_CHARS = 1_000;
const MAX_RESEARCH_REGION_CHARS = 32;
const MAX_RESULT_URL_CHARS = 2_048;
const MAX_FORMAT_RESULTS = 25;
const DEFAULT_RESEARCH_RESULTS = 8;
const MAX_RESEARCH_RESULTS = 10;

const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_[ce]id|ref|referrer|source)$/i;
const SENSITIVE_PARAMETER = /^(?:(?:[a-z0-9]+[-_.])*(?:api[-_.]?key|auth[-_.]?token|access[-_.]?token|refresh[-_.]?token|token|password|passwd|secret(?:[-_.]?key)?|secret[-_.]?access[-_.]?key|private[-_.]?key|client[-_.]?secret|credential|credentials|session(?:[-_.]?id|[-_.]?token)?|aws[-_.]?secret[-_.]?access[-_.]?key|aws[-_.]?session[-_.]?token)|authorization|key|signature|sig|code|aws[-_.]?access[-_.]?key[-_.]?id|google[-_.]?access[-_.]?id|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature))$/i;
const LOCAL_HOSTNAME = /(?:^|\.)(?:localhost|local|internal|home|lan)$/i;
const METADATA_HOSTNAME = /^(?:metadata\.google\.internal|metadata\.azure\.internal|instance-data\.ec2\.internal)$/i;
const DYNAMIC_LOCAL_DNS = /(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me|lvh\.me|vcap\.me)$/i;
const TERMINAL_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

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
  for (const host of hosts) {
    throwIfAborted(context.signal);
    await context.container.reachNetwork(host, reason);
    throwIfAborted(context.signal);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  if (reason !== undefined) throw new Error(String(reason));
  throw new Error('The operation was aborted.');
}

function compactLine(value: string): string {
  return value.replace(TERMINAL_CONTROL, '').replace(/\s+/g, ' ').trim();
}

function failureDetail(error: unknown): string {
  return compactLine(error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

function privateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
}

function privateIpv6(hostname: string): boolean {
  const value = hostname.toLowerCase().split('%')[0]!;
  const halves = value.split('::');
  if (halves.length > 2) return true;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
    .map((part) => Number.parseInt(part || '0', 16));
  if (groups.length !== 8 || groups.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) {
    return true;
  }

  const [first, second] = groups as [number, number, number, number, number, number, number, number];
  if (groups.every((part) => part === 0)) return true;
  if (groups.slice(0, 7).every((part) => part === 0) && groups[7] === 1) return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (first === 0x2001 && (second === 0x0db8 || second === 0x0000)) return true;
  if (first === 0x2002) return true;

  const ipv4Embedded = groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff;
  const ipv4Compatible = groups.slice(0, 6).every((part) => part === 0);
  if (ipv4Embedded || ipv4Compatible) {
    const high = groups[6]!;
    const low = groups[7]!;
    const ipv4 = `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
    return privateIpv4(ipv4);
  }
  return false;
}

function unsafeTargetReason(target: URL): string | null {
  const hostname = target.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (
    !hostname ||
    LOCAL_HOSTNAME.test(hostname) ||
    METADATA_HOSTNAME.test(hostname) ||
    DYNAMIC_LOCAL_DNS.test(hostname)
  ) {
    return 'local or metadata hostnames are not allowed';
  }
  const version = isIP(hostname);
  if ((version === 4 && privateIpv4(hostname)) || (version === 6 && privateIpv6(hostname))) {
    return 'private, local, reserved, and metadata IP addresses are not allowed';
  }
  return null;
}

function sensitiveQueryParameter(target: URL): string | null {
  for (const name of target.searchParams.keys()) {
    if (SENSITIVE_PARAMETER.test(name)) return name;
  }
  return null;
}

function canonicalSourceKey(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/$/, '');
    return parsed.toString();
  } catch {
    return value.trim();
  }
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
          maxLength: MAX_SEARCH_QUERY_CHARS,
          description:
            'What to search for. Write it as a person would type it, not as a ' +
            'sentence — keywords beat prose.',
        },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: 25,
          description: 'How many results to return, 1-25. Default 8.',
        },
        region: {
          type: 'string',
          maxLength: MAX_RESEARCH_REGION_CHARS,
          description: 'Region code such as "br-pt" or "us-en".',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },

  async run(input, context) {
    const query = typeof input['query'] === 'string' ? compactLine(input['query']) : '';
    if (!query) return { output: 'Error: web_search needs a "query".', ok: false };
    if (query.length > MAX_SEARCH_QUERY_CHARS) {
      return { output: `Error: query must be ${MAX_SEARCH_QUERY_CHARS} characters or fewer.`, ok: false };
    }
    const maxResults = input['max_results'] ?? DEFAULT_RESEARCH_RESULTS;
    if (
      typeof maxResults !== 'number' ||
      !Number.isInteger(maxResults) ||
      maxResults < 1 ||
      maxResults > 25
    ) {
      return { output: 'Error: max_results must be an integer from 1 to 25.', ok: false };
    }
    if (input['region'] !== undefined && typeof input['region'] !== 'string') {
      return { output: 'Error: region must be a string when provided.', ok: false };
    }
    const region = typeof input['region'] === 'string' ? compactLine(input['region']) : '';
    if (region.length > MAX_RESEARCH_REGION_CHARS) {
      return { output: `Error: region must be ${MAX_RESEARCH_REGION_CHARS} characters or fewer.`, ok: false };
    }

    await authorize(context, SEARCH_HOSTS, `search the web for "${query}"`);

    const response = await search(query, {
      maxResults,
      ...(region ? { region } : {}),
      signal: context.signal,
    });

    return { output: format(response), ok: response.results.length > 0 || response.instant !== null };
  },
};

interface ResearchQuery {
  readonly query: string;
  readonly purpose: string;
}

interface ResearchInput {
  readonly objective: string;
  readonly queries: readonly ResearchQuery[];
  readonly maxResults: number;
  readonly region: string | undefined;
  readonly duplicateQueries: number;
}

function parseResearchInput(input: Record<string, unknown>): ResearchInput | string {
  const objective = typeof input['objective'] === 'string' ? compactLine(input['objective']) : '';
  if (!objective) return 'Error: research needs a non-empty "objective".';
  if (objective.length > MAX_RESEARCH_OBJECTIVE_CHARS) {
    return `Error: objective must be ${MAX_RESEARCH_OBJECTIVE_CHARS} characters or fewer.`;
  }

  const rawQueries = input['queries'];
  if (!Array.isArray(rawQueries) || rawQueries.length < 1 || rawQueries.length > 6) {
    return 'Error: research needs one to six query objects.';
  }

  const queries: ResearchQuery[] = [];
  const seen = new Set<string>();
  let duplicateQueries = 0;
  for (const [index, value] of rawQueries.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return `Error: query ${index + 1} must be an object with query and purpose.`;
    }
    const record = value as Record<string, unknown>;
    const query = typeof record['query'] === 'string' ? compactLine(record['query']) : '';
    const purpose = typeof record['purpose'] === 'string' ? compactLine(record['purpose']) : '';
    if (!query) return `Error: query ${index + 1} needs a non-empty "query".`;
    if (!purpose) return `Error: query ${index + 1} needs a non-empty "purpose".`;
    if (query.length > MAX_RESEARCH_QUERY_CHARS) {
      return `Error: query ${index + 1} must be ${MAX_RESEARCH_QUERY_CHARS} characters or fewer.`;
    }
    if (purpose.length > MAX_RESEARCH_PURPOSE_CHARS) {
      return `Error: query ${index + 1} purpose must be ${MAX_RESEARCH_PURPOSE_CHARS} characters or fewer.`;
    }

    const key = query.toLowerCase();
    if (seen.has(key)) {
      duplicateQueries += 1;
      continue;
    }
    seen.add(key);
    queries.push({ query, purpose });
  }

  const rawMax = input['max_results_per_query'];
  const maxResults = rawMax === undefined ? DEFAULT_RESEARCH_RESULTS : rawMax;
  if (
    typeof maxResults !== 'number' ||
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_RESEARCH_RESULTS
  ) {
    return `Error: max_results_per_query must be an integer from 1 to ${MAX_RESEARCH_RESULTS}.`;
  }

  if (input['region'] !== undefined && typeof input['region'] !== 'string') {
    return 'Error: region must be a string when provided.';
  }
  const region = typeof input['region'] === 'string' ? compactLine(input['region']) : '';
  if (region.length > MAX_RESEARCH_REGION_CHARS) {
    return `Error: region must be ${MAX_RESEARCH_REGION_CHARS} characters or fewer.`;
  }

  return {
    objective,
    queries,
    maxResults,
    region: region || undefined,
    duplicateQueries,
  };
}

function boundedText(value: string, limit: number): string {
  const text = compactLine(value);
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function safeWebUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.length > MAX_RESULT_URL_CHARS) return '';
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      sensitiveQueryParameter(parsed) ||
      unsafeTargetReason(parsed)
    ) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function researchSource(result: SearchResponse['results'][number], rank: number): string {
  const url = safeWebUrl(result.url);
  const title = boundedText(result.title, 300) || url;
  const snippet = boundedText(stripTags(result.snippet), 600);
  return `${rank}. ${title}\n   ${url}${snippet ? `\n   ${snippet}` : ''}`;
}

export const research: Tool = {
  parallelSafe: true,
  spec: {
    name: 'research',
    description:
      'Build a parallel discovery map for a decision. Provide an objective and one to six ' +
      'purposeful queries. Results are grouped in query order, ranked sources are deduplicated ' +
      'globally, and blocked search pages remain distinct from genuinely empty searches. ' +
      'Use web_fetch to open sources before making factual claims.',
    parameters: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          maxLength: MAX_RESEARCH_OBJECTIVE_CHARS,
          description: 'The decision or question this research should inform.',
        },
        queries: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                maxLength: MAX_RESEARCH_QUERY_CHARS,
                description: 'A focused web-search query.',
              },
              purpose: {
                type: 'string',
                maxLength: MAX_RESEARCH_PURPOSE_CHARS,
                description: 'What this query is meant to establish.',
              },
            },
            required: ['query', 'purpose'],
            additionalProperties: false,
          },
        },
        max_results_per_query: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_RESEARCH_RESULTS,
          description: `Maximum ranked sources per query, from 1 to ${MAX_RESEARCH_RESULTS}.`,
        },
        region: {
          type: 'string',
          maxLength: MAX_RESEARCH_REGION_CHARS,
          description: 'DuckDuckGo region code such as "br-pt" or "us-en".',
        },
      },
      required: ['objective', 'queries'],
      additionalProperties: false,
    },
  },

  async run(input, context) {
    const parsed = parseResearchInput(input);
    if (typeof parsed === 'string') return { output: parsed, ok: false };

    throwIfAborted(context.signal);
    await authorize(context, SEARCH_HOSTS, 'run the research query matrix');

    // allSettled keeps groups in query order and lets one failed query leave a
    // useful status beside the other evidence. The shared network pool bounds
    // the endpoint work underneath this fan-out.
    const settled = await Promise.allSettled(
      parsed.queries.map((item) => search(item.query, {
        maxResults: parsed.maxResults,
        ...(parsed.region ? { region: parsed.region } : {}),
        signal: context.signal,
      })),
    );
    throwIfAborted(context.signal);

    const seenSources = new Set<string>();
    let sourceNumber = 0;
    let coveredQueries = 0;
    let blockedQueries = 0;
    let emptyQueries = 0;
    let failedQueries = 0;
    let duplicateSources = parsed.duplicateQueries;
    let instantAnswers = 0;
    const parts: string[] = [`Objective: ${parsed.objective}`];

    if (parsed.duplicateQueries > 0) {
      parts.push(`Query matrix: ${parsed.duplicateQueries} duplicate quer${parsed.duplicateQueries === 1 ? 'y' : 'ies'} removed.`);
    }

    for (const [index, settledResponse] of settled.entries()) {
      const query = parsed.queries[index]!;
      const response = settledResponse.status === 'fulfilled'
        ? settledResponse.value
        : {
            query: query.query,
            results: [],
            instant: null,
            related: [],
            suggestions: [],
            blocked: null,
          } satisfies SearchResponse;
      const failed = settledResponse.status === 'rejected';
      const candidates = response.results.flatMap((result) => {
        const url = safeWebUrl(result.url);
        return url ? [{ ...result, url }] : [];
      });
      const unique = candidates.filter((result) => {
        const key = canonicalSourceKey(result.url);
        if (seenSources.has(key)) {
          duplicateSources += 1;
          return false;
        }
        seenSources.add(key);
        sourceNumber += 1;
        return true;
      });
      if (candidates.length > 0) coveredQueries += 1;
      if (failed) failedQueries += 1;
      else if (response.blocked) blockedQueries += 1;
      else if (candidates.length === 0) emptyQueries += 1;

      const status = failed
        ? `Status: failed — ${boundedText(failureDetail(settledResponse.reason), 1_000)}`
        : response.blocked
        ? `Status: blocked — ${boundedText(response.blocked, 1_000)}`
        : candidates.length === 0
          ? 'Status: empty — no ranked sources matched this query.'
          : `Status: ${candidates.length} ranked source(s); ${unique.length} new source(s)${candidates.length === unique.length ? '' : `, ${candidates.length - unique.length} duplicate source(s) omitted globally`}.`;
      const group: string[] = [
        `Query ${index + 1}: ${query.query}`,
        `Purpose: ${query.purpose}`,
        status,
      ];

      if (response.instant) {
        instantAnswers += 1;
        const answer = boundedText(response.instant.abstract, 800);
        const instantUrl = safeWebUrl(response.instant.url);
        group.push(
          `Instant answer (context only, not a ranked source): ${answer}`,
          instantUrl ? `Instant answer source: ${instantUrl}` : '',
        );
      }
      if (unique.length > 0) {
        group.push(`Sources:\n${unique.map((result, resultIndex) => researchSource(result, sourceNumber - unique.length + resultIndex + 1)).join('\n')}`);
      } else {
        group.push('Sources: none from this query.');
      }
      parts.push(group.filter(Boolean).join('\n'));
    }

    parts.push(
      `Coverage: ${seenSources.size} unique ranked sources across ${settled.length} queries; ` +
      `${coveredQueries} covered, ${blockedQueries} blocked, ${emptyQueries} empty, ${failedQueries} failed; ` +
      `${duplicateSources} duplicate source(s) or query(ies) omitted globally.`,
    );

    // A valid matrix that completed with no matches is still a successful
    // discovery operation. Its explicit per-query `empty` status prevents the
    // caller from confusing “nothing matched” with an input or runtime error.
    const completedEmpty = emptyQueries > 0 || settled.length === 0;
    return {
      output: parts.join('\n\n'),
      ok: seenSources.size > 0 || instantAnswers > 0 || completedEmpty,
    };
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
        focus: {
          type: 'string',
          description: 'Optional case-insensitive term to locate and center in the returned window.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          maximum: MAX_PAGE_OFFSET,
          description: 'Character offset for the returned window. Defaults to 0.',
        },
        max_chars: {
          type: 'integer',
          minimum: MIN_PAGE_CHARS,
          maximum: MAX_PAGE_CHARS,
          description: `Window size in characters, from ${MIN_PAGE_CHARS} to ${MAX_PAGE_CHARS}.`,
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },

  async run(input, context) {
    throwIfAborted(context.signal);
    const raw = typeof input['url'] === 'string' ? input['url'].trim() : '';
    if (!raw) return { output: 'Error: web_fetch needs an absolute http(s) URL.', ok: false };
    if (raw.length > MAX_PAGE_URL_CHARS) {
      return { output: `Error: web_fetch URL must be ${MAX_PAGE_URL_CHARS} characters or fewer.`, ok: false };
    }
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return { output: 'Error: the supplied URL is not an absolute URL.', ok: false };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return { output: `Error: ${target.protocol} is not a protocol this tool speaks.`, ok: false };
    }
    if (target.username || target.password) {
      return { output: 'Error: web_fetch does not accept credentials in the URL.', ok: false };
    }
    if (target.search.length > MAX_PAGE_QUERY_CHARS) {
      return { output: `Error: web_fetch query must be ${MAX_PAGE_QUERY_CHARS} characters or fewer.`, ok: false };
    }
    const sensitiveParameter = sensitiveQueryParameter(target);
    if (sensitiveParameter) {
      return {
        output: `Error: web_fetch will not send the credential-like query parameter ${JSON.stringify(sensitiveParameter)} to a third-party reader.`,
        ok: false,
      };
    }
    const unsafeReason = unsafeTargetReason(target);
    if (unsafeReason) {
      return { output: `Error: web_fetch refused ${target.hostname}: ${unsafeReason}.`, ok: false };
    }
    // Fragments never reach an origin and can contain application state. Do not
    // disclose them to the reader or repeat them in provenance.
    target.hash = '';

    const rawOffset = input['offset'];
    const offset = rawOffset === undefined ? 0 : rawOffset;
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > MAX_PAGE_OFFSET) {
      return { output: `Error: offset must be an integer from 0 to ${MAX_PAGE_OFFSET}.`, ok: false };
    }
    const rawMaxChars = input['max_chars'];
    const maxChars = rawMaxChars === undefined ? MAX_PAGE_CHARS : rawMaxChars;
    if (
      typeof maxChars !== 'number' ||
      !Number.isInteger(maxChars) ||
      maxChars < MIN_PAGE_CHARS ||
      maxChars > MAX_PAGE_CHARS
    ) {
      return { output: `Error: max_chars must be an integer from ${MIN_PAGE_CHARS} to ${MAX_PAGE_CHARS}.`, ok: false };
    }
    const rawFocus = input['focus'];
    if (rawFocus !== undefined && typeof rawFocus !== 'string') {
      return { output: 'Error: focus must be a string when provided.', ok: false };
    }
    const focus = typeof rawFocus === 'string' ? rawFocus.trim() : '';
    if (focus.length > MAX_FOCUS_CHARS) {
      return { output: `Error: focus must be ${MAX_FOCUS_CHARS} characters or fewer.`, ok: false };
    }

    // Both hosts are named: the reader is a third party that will see the URL,
    // and the developer approving this deserves to know that rather than see
    // only the site they asked for.
    await authorize(
      context,
      [target.hostname, READER],
      `read ${target.hostname} through the third-party reader ${READER}`,
    );

    const timeout = AbortSignal.timeout(30_000);
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;

    const response = await webNetworkPool.run(
      () => fetch(`https://${READER}/${target.toString()}`, {
        headers: { 'User-Agent': 'plif/0.1 (+https://github.com/plif)' },
        redirect: 'manual',
        signal,
      }),
      signal,
    );
    throwIfAborted(context.signal);

    if (response.status >= 300 && response.status < 400) {
      return {
        output: `Error: the reader attempted an unauthorised redirect (${response.status}); web_fetch did not follow it.`,
        ok: false,
      };
    }

    if (!response.ok) {
      return {
        output:
          `Error: fetching ${target.hostname} returned ${response.status}. ` +
          'The page may be behind a login, or the reader service may be rate limiting.',
        ok: false,
      };
    }

    const { bytes, truncated } = await readLimited(response, MAX_PAGE_BYTES);
    throwIfAborted(context.signal);
    const body = decodeUtf8Prefix(bytes, truncated);
    if (!body.trim()) return { output: `${target} returned an empty document.`, ok: false };

    const characters = [...body];
    const total = characters.length;
    const foundCodeUnit = focus ? body.toLowerCase().indexOf(focus.toLowerCase()) : -1;
    const foundAt = foundCodeUnit >= 0 ? [...body.slice(0, foundCodeUnit)].length : -1;
    if (foundAt < 0 && offset >= total && offset > 0) {
      return {
        output:
          `Source: ${target.toString()}\n\n` +
          `Error: offset ${offset} is beyond this ${total}-character reader document.`,
        ok: false,
      };
    }
    let start = Math.min(offset, total);
    if (foundAt >= 0) {
      start = Math.max(0, foundAt - Math.floor(maxChars / 2));
      start = Math.min(start, Math.max(0, total - maxChars));
    }
    const end = Math.min(total, start + maxChars);
    const focusNote = focus
      ? foundAt >= 0
        ? `Focus: ${JSON.stringify(focus)} found at character ${foundAt}.`
        : `Focus: ${JSON.stringify(focus)} was not found in the reader text.`
      : '';
    const rangeTotal = truncated ? `${total}+` : String(total);
    const output = [
      `Source: ${target.toString()}`,
      `Characters ${start}-${Math.max(start, end - 1)} of ${rangeTotal}`,
      focusNote,
      characters.slice(start, end).join(''),
      ...(truncated ? [`Reader response limited to ${MAX_PAGE_BYTES} bytes; total length is at least ${total} characters.`] : []),
    ].filter(Boolean).join('\n\n');

    return { output, ok: true };
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
      response = await webNetworkPool.run(
        () => fetch(current, {
          method: requestMethod,
          headers: requestHeaders,
          ...(requestBody === undefined ? {} : { body: requestBody }),
          redirect: 'manual',
          signal,
        }),
        signal,
      );
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

function decodeUtf8Prefix(bytes: Uint8Array, truncated: boolean): string {
  if (!truncated || bytes.length === 0) return new TextDecoder().decode(bytes);

  let lead = bytes.length - 1;
  while (lead >= 0 && (bytes[lead]! & 0xc0) === 0x80) lead -= 1;
  if (lead < 0) return '';

  const first = bytes[lead]!;
  const expected = first < 0x80
    ? 1
    : (first & 0xe0) === 0xc0
      ? 2
      : (first & 0xf0) === 0xe0
        ? 3
        : (first & 0xf8) === 0xf0
          ? 4
          : 1;
  const available = bytes.length - lead;
  const safe = expected > available ? bytes.subarray(0, lead) : bytes;
  return new TextDecoder().decode(safe);
}

export const WEB_TOOLS: readonly Tool[] = [webSearch, research, webFetch, curl];

/**
 * Lay the answer out for a model, not a browser.
 *
 * Numbered so the agent can refer to "result 3", URL on its own line so it is
 * copyable, and the instant answer first because when there is one it is
 * usually the whole answer.
 */
export function format(response: SearchResponse): string {
  const parts: string[] = [];
  const instant = response.instant
    ? {
        heading: boundedText(response.instant.heading, 300) || 'Instant answer',
        abstract: boundedText(response.instant.abstract, 2_000),
        source: boundedText(response.instant.source, 200),
        url: safeWebUrl(response.instant.url),
      }
    : null;
  const ranked = response.results.slice(0, MAX_FORMAT_RESULTS).flatMap((result) => {
    const url = safeWebUrl(result.url);
    return url ? [{ ...result, url }] : [];
  });

  if (instant) {
    parts.push(
      `## ${instant.heading}`,
      instant.abstract,
      instant.url ? `— ${instant.source}: ${instant.url}` : `— ${instant.source}`,
    );
  }

  if (ranked.length > 0) {
    parts.push(
      '## Results',
      ranked
        .map(
          (result, index) =>
            `${index + 1}. ${boundedText(result.title, 300) || result.url}\n   ${result.url}${
              result.snippet ? `\n   ${boundedText(stripTags(result.snippet), 600)}` : ''
            }`,
        )
        .join('\n'),
    );
  }

  if (response.related.length > 0) {
    const related = response.related.slice(0, MAX_FORMAT_RESULTS).flatMap((item) => {
      const url = safeWebUrl(item.url);
      return url ? [`- ${boundedText(item.title, 300) || url}: ${url}`] : [];
    });
    if (related.length > 0) parts.push('## Related', related.join('\n'));
  }

  // The distinction the whole module exists to preserve. "Nothing found" and
  // "we were turned away" lead a model to opposite conclusions, and only one of
  // them is a reason to stop looking.
  if (response.blocked) {
    parts.push(
      '## Web results unavailable',
      `${boundedText(response.blocked, 1_000)}\n` +
        'This is not the same as "nothing matched" — the ranked list above is ' +
        'missing, not empty. What is shown came from the Instant Answer API. ' +
        'Try web_fetch on a URL you can guess (official docs, a repository), or ' +
        'say you could not search rather than answering from memory.',
    );
  }

  if (response.suggestions.length > 0 && ranked.length === 0) {
    parts.push(
      '## How this is usually phrased',
      response.suggestions.slice(0, 6).map((item) => `- ${boundedText(item, 200)}`).join('\n'),
    );
  }

  if (parts.length === 0) {
    return `No results for "${boundedText(response.query, MAX_SEARCH_QUERY_CHARS)}", and no instant answer. The query may be too specific.`;
  }

  return parts.join('\n\n');
}
