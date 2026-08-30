import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { changelogFromNpmTarball } from './changelog.js';

const REGISTRY = 'https://registry.npmjs.org';
const PACKAGE = '@plif/cli';
const TIMEOUT_MS = 2_500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface UpdateStatus {
  readonly current: string;
  readonly latest: string;
  readonly behind: boolean;
  /** The command that installs it, ready to be shown. */
  readonly command: string;
  readonly packageName: string;
  readonly tarball?: string;
  readonly integrity?: string;
  readonly changelog: string;
}

export interface UpdateCheckOptions {
  readonly current: string;
  readonly cacheFile: string;
  readonly registry?: string;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
}

interface Cache {
  readonly checkedAt: number;
  readonly latest: string;
  readonly tarball?: string;
  readonly integrity?: string;
  readonly changelog?: string;
}

/**
 * Compare two semver-ish versions.
 *
 * Deliberately small: the registry publishes what this project publishes, and
 * a prerelease sorts below the release it precedes, which is all the ordering
 * an "is there something newer" question needs.
 */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (value: string): { parts: number[]; pre: string } => {
    const [core = '', pre = ''] = value.replace(/^v/, '').split('-', 2);
    return { parts: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre };
  };

  const a = parse(candidate);
  const b = parse(current);

  for (let index = 0; index < 3; index += 1) {
    const left = a.parts[index] ?? 0;
    const right = b.parts[index] ?? 0;
    if (left !== right) return left > right;
  }

  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre > b.pre;
}

async function readCache(file: string, ttlMs: number): Promise<Cache | null> {
  try {
    const cache = JSON.parse(await readFile(file, 'utf8')) as Cache;
    if (typeof cache.latest !== 'string' || typeof cache.checkedAt !== 'number') return null;
    return Date.now() - cache.checkedAt < ttlMs ? cache : null;
  } catch {
    return null;
  }
}

async function writeCache(file: string, update: Omit<Cache, 'checkedAt'>): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ checkedAt: Date.now(), ...update } satisfies Cache), 'utf8');
  } catch {
    // A cache that cannot be written costs one request next time.
  }
}

/**
 * Is there a newer plif?
 *
 * Built to be started and forgotten. It resolves to null for every boring
 * reason — offline, opted out, already current, registry slow — so a caller
 * can fire it without a timeout of its own and without a branch for failure.
 * It never throws, and it never delays a first frame: the answer arrives when
 * it arrives, and the interface decides whether it is still worth showing.
 *
 * Opting out is `PLIF_NO_UPDATE_CHECK=1`, which CI images should set.
 */
export async function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateStatus | null> {
  const environment = options.environment ?? process.env;
  if (environment['PLIF_NO_UPDATE_CHECK']) return null;

  const ttlMs = options.ttlMs ?? CACHE_TTL_MS;
  const command = `npm install -g ${PACKAGE}@latest`;

  const decide = (cache: Cache): UpdateStatus | null =>
    isNewer(cache.latest, options.current) && cache.changelog
      ? {
          current: options.current,
          latest: cache.latest,
          behind: true,
          command,
          packageName: PACKAGE,
          ...(cache.tarball ? { tarball: cache.tarball } : {}),
          ...(cache.integrity ? { integrity: cache.integrity } : {}),
          changelog: cache.changelog,
        }
      : null;

  const cached = await readCache(options.cacheFile, ttlMs);
  if (cached) return decide(cached);

  try {
    const request = options.fetchImpl ?? fetch;
    // The scope's slash has to be encoded: the registry routes on one path
    // segment, and `@plif/cli` unencoded reads as a package inside a namespace
    // it does not have.
    const response = await request(
      `${options.registry ?? REGISTRY}/${encodeURIComponent(PACKAGE)}/latest`,
      {
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
        headers: { accept: 'application/vnd.npm.install-v1+json' },
      },
    );
    if (!response.ok) return null;

    const body = (await response.json()) as {
      version?: unknown;
      ['dist-tags']?: { latest?: unknown };
      versions?: Record<string, { dist?: { tarball?: unknown; integrity?: unknown } }>;
      dist?: { tarball?: unknown; integrity?: unknown };
    };
    const latest = typeof body['dist-tags']?.latest === 'string'
      ? body['dist-tags'].latest
      : typeof body.version === 'string' ? body.version : null;
    if (!latest) return null;
    const release = body.versions?.[latest]?.dist ?? body.dist;
    let cache: Omit<Cache, 'checkedAt'> = {
      latest,
      ...(typeof release?.tarball === 'string' ? { tarball: release.tarball } : {}),
      ...(typeof release?.integrity === 'string' ? { integrity: release.integrity } : {}),
    };
    if (cache.tarball && isNewer(latest, options.current)) {
      try {
        const changelogResponse = await request(cache.tarball, {
          signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
          headers: { accept: 'application/octet-stream' },
        });
        if (changelogResponse.ok) {
          const section = changelogFromNpmTarball(new Uint8Array(await changelogResponse.arrayBuffer()), latest);
          if (section) cache = { ...cache, changelog: section.text };
        }
      } catch {
        return null;
      }
    }
    await writeCache(options.cacheFile, cache);
    return decide({ checkedAt: Date.now(), ...cache });
  } catch {
    // Offline, blocked, slow, or behind a proxy that hates us. None of that is
    // the developer's problem right now.
    return null;
  }
}
