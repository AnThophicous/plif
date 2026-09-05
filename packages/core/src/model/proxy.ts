/**
 * Sending model traffic through an HTTP proxy.
 *
 * Node's `fetch` ignores `HTTPS_PROXY` and friends. That is a deliberate
 * choice by the runtime, and a correct one for a library — but for a terminal
 * agent it means that on a machine where `curl`, `git`, `npm` and every other
 * tool reach the internet, plif alone cannot, and says so as a connection
 * error that names no cause. A developer behind a corporate proxy has no way
 * to use the product and no way to find out why.
 *
 * So the environment gets read here, the way every other tool reads it, and
 * turned into a dispatcher that Node's fetch does accept.
 *
 * Two things are deliberate:
 *
 * - **Nothing is imported until a proxy is actually configured.** The proxy
 *   implementation is a real module load, and the overwhelming majority of
 *   runs have no proxy at all. `dispatcherFor` returns `undefined` without
 *   loading anything when the environment is silent.
 * - **`NO_PROXY` is honoured**, because the common corporate setup is a proxy
 *   for the internet and a direct route to an internal host. Ignoring it would
 *   send traffic for a local model server out through the proxy, which fails
 *   in a way that looks like the model server is down.
 */

import type { Dispatcher } from 'undici';

/** The environment slice this module reads; injectable so it can be tested. */
export type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The proxy URL that applies to `target`, or null.
 *
 * Precedence follows the de facto convention: the scheme-specific variable
 * first, then `ALL_PROXY`. Lowercase wins over uppercase because that is what
 * curl does, and a machine that sets both almost always set the lowercase one
 * on purpose.
 */
export function proxyForUrl(target: string, environment: ProxyEnvironment = process.env): string | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  // A loopback endpoint is never proxied. A local model server is the case
  // this protects, and no proxy configuration ever intends to cover it.
  if (isLoopback(url.hostname)) return null;
  if (isBypassed(url, environment)) return null;

  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const candidate =
    pick(environment, `${scheme}_proxy`) ??
    pick(environment, 'all_proxy');
  if (!candidate) return null;
  // A bare `host:port` is what people actually write. Give it a scheme rather
  // than rejecting a value that every other tool accepts.
  const normalized = /^[a-z0-9+.-]+:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  try {
    new URL(normalized);
  } catch {
    return null;
  }
  return normalized;
}

/**
 * A dispatcher for `fetch`, or `undefined` when the request goes out directly.
 *
 * Dispatchers are cached per proxy URL: each one owns a connection pool, and
 * building a fresh pool per request would defeat keep-alive on exactly the
 * link that most needs it.
 */
const dispatchers = new Map<string, Dispatcher>();

export async function dispatcherFor(
  target: string,
  environment: ProxyEnvironment = process.env,
): Promise<Dispatcher | undefined> {
  const proxy = proxyForUrl(target, environment);
  if (!proxy) return undefined;
  const cached = dispatchers.get(proxy);
  if (cached) return cached;
  const { ProxyAgent } = await import('undici');
  const agent = new ProxyAgent(proxy);
  dispatchers.set(proxy, agent);
  return agent;
}

/** Describe the proxy decision for `plif model` and the diagnostics screen. */
export function describeProxy(
  target: string,
  environment: ProxyEnvironment = process.env,
): string {
  const proxy = proxyForUrl(target, environment);
  if (!proxy) {
    const configured = pick(environment, 'https_proxy') ?? pick(environment, 'http_proxy') ?? pick(environment, 'all_proxy');
    if (!configured) return 'direct';
    return 'direct (excluded by NO_PROXY)';
  }
  // The proxy URL can carry credentials. Show the route, never the secret.
  try {
    const url = new URL(proxy);
    return `via ${url.protocol}//${url.host}`;
  } catch {
    return 'via a configured proxy';
  }
}

function pick(environment: ProxyEnvironment, name: string): string | undefined {
  const lower = environment[name]?.trim();
  if (lower) return lower;
  const upper = environment[name.toUpperCase()]?.trim();
  return upper || undefined;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

/**
 * Does `NO_PROXY` exempt this URL?
 *
 * The format is a comma-separated list of hosts, each optionally with a port
 * and optionally with a leading dot. `*` on its own disables proxying
 * entirely. Matching is on domain suffix at a label boundary, so `example.com`
 * covers `api.example.com` but not `notexample.com` — getting that wrong sends
 * an internal host's traffic to the proxy, or the reverse.
 */
function isBypassed(url: URL, environment: ProxyEnvironment): boolean {
  const raw = pick(environment, 'no_proxy');
  if (!raw) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  for (const entry of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (entry === '*') return true;
    const [rawHost = '', rawPort] = entry.replace(/^\*?\./, '.').split(':');
    if (rawPort && rawPort !== port) continue;
    const pattern = rawHost.toLowerCase();
    if (!pattern) continue;
    if (pattern.startsWith('.')) {
      if (host === pattern.slice(1) || host.endsWith(pattern)) return true;
      continue;
    }
    if (host === pattern || host.endsWith(`.${pattern}`)) return true;
  }
  return false;
}
