/**
 * The Claude plugin marketplaces.
 *
 * Two catalogues, both maintained by Anthropic and both plain JSON in a git
 * repo: an official directory of reviewed plugins, and a much larger community
 * mirror. Reusing them rather than growing our own is the whole point — a
 * marketplace is worth exactly as much as the number of things in it, and these
 * already have three thousand between them.
 *
 * ## What the listing does and does not tell you
 *
 * This is the constraint the interface has to be built around, so it is worth
 * being blunt about. A marketplace entry carries a name, a description, an
 * author, a category and where to fetch the plugin from. It does **not**
 * reliably say whether the plugin provides MCP servers or skills: of the 284
 * official entries, zero declare `mcpServers` and four declare `skills`.
 *
 * So the catalogue cannot be split into an "MCP" list and a "Skills" list
 * without fetching all three thousand plugins, and any interface that claimed
 * to would be sorting by a field that is almost always absent. What a plugin
 * contains is discovered when it is installed, not before.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';
import { loadGlobalConfig, saveGlobalConfig } from '../config/global.js';
import { parseSkill, writeSkill } from '../harness/skills.js';

export interface MarketplaceSource {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  /** Shown in the interface so it is never ambiguous whose list this is. */
  readonly curator: string;
  /** Browsable root of the repo, for entries whose source is a path inside it. */
  readonly repo: string;
}

/**
 * Where the catalogues live.
 *
 * Raw JSON off the default branch rather than the GitHub API: no token, no rate
 * limit worth worrying about, and one request for the whole list.
 */
export const MARKETPLACES: readonly MarketplaceSource[] = [
  {
    id: 'official',
    label: 'Official',
    curator: 'Anthropic, reviewed',
    url: 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json',
    repo: 'https://github.com/anthropics/claude-plugins-official',
  },
  {
    id: 'community',
    label: 'Community',
    curator: 'Anthropic mirror, security-scanned',
    url: 'https://raw.githubusercontent.com/anthropics/claude-plugins-community/main/.claude-plugin/marketplace.json',
    repo: 'https://github.com/anthropics/claude-plugins-community',
  },
];

/** Where a plugin is fetched from. Four shapes appear in the real data. */
export type PluginSource =
  | { readonly kind: 'git-subdir'; readonly url: string; readonly path: string; readonly ref?: string; readonly sha?: string }
  | { readonly kind: 'github'; readonly repo: string; readonly commit?: string; readonly sha?: string }
  | { readonly kind: 'url'; readonly url: string; readonly sha?: string }
  /** A path inside the marketplace repository itself. */
  | { readonly kind: 'relative'; readonly path: string }
  | { readonly kind: 'unknown'; readonly raw: string };

export interface CatalogPlugin {
  readonly name: string;
  readonly displayName: string | undefined;
  readonly description: string;
  readonly author: string | undefined;
  readonly category: string | undefined;
  readonly homepage: string | undefined;
  readonly version: string | undefined;
  readonly tags: readonly string[];
  readonly source: PluginSource;
  /** Only a handful of entries declare these; absence means "not stated". */
  readonly declaresMcp: boolean;
  readonly declaresSkills: boolean;
  /** Which marketplace it came from. */
  readonly origin: string;
}

export interface Catalog {
  readonly plugins: readonly CatalogPlugin[];
  /** When this was fetched, for the "as of" line and the cache TTL. */
  readonly fetchedAt: number;
  /** True when it came from disk because the network was unavailable. */
  readonly stale: boolean;
  /** Per-marketplace outcome, so a partial failure is visible rather than silent. */
  readonly sources: readonly { id: string; ok: boolean; count: number; problem?: string }[];
}

export interface MarketplaceInstallResult {
  readonly name: string;
  readonly mcpServers: readonly string[];
  /** Skills written to the user's skills directory. */
  readonly skills: readonly string[];
  /** Skills the plugin declared that could not be fetched, with the reason. */
  readonly skippedSkills: readonly { readonly name: string; readonly reason: string }[];
  /** Servers that were already configured and have just been overwritten. */
  readonly replaced: readonly string[];
  readonly configFile: string;
  /** Where installed skills landed, when any did. */
  readonly skillsDirectory?: string;
}

/** How long a cached catalogue is served without re-fetching. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

function normaliseSource(raw: unknown): PluginSource {
  if (typeof raw === 'string') return { kind: 'relative', path: raw };
  if (!raw || typeof raw !== 'object') return { kind: 'unknown', raw: String(raw) };

  const source = raw as Record<string, unknown>;
  const kind = typeof source['source'] === 'string' ? source['source'] : '';

  if (kind === 'git-subdir') {
    return {
      kind: 'git-subdir',
      url: String(source['url'] ?? ''),
      path: String(source['path'] ?? ''),
      ...(source['ref'] ? { ref: String(source['ref']) } : {}),
      ...(source['sha'] ? { sha: String(source['sha']) } : {}),
    };
  }
  if (kind === 'github') {
    return {
      kind: 'github',
      repo: String(source['repo'] ?? ''),
      ...(source['commit'] ? { commit: String(source['commit']) } : {}),
      ...(source['sha'] ? { sha: String(source['sha']) } : {}),
    };
  }
  if (kind === 'url') {
    return {
      kind: 'url',
      url: String(source['url'] ?? ''),
      ...(source['sha'] ? { sha: String(source['sha']) } : {}),
    };
  }
  return { kind: 'unknown', raw: JSON.stringify(raw).slice(0, 200) };
}

function normalisePlugin(raw: unknown, origin: string): CatalogPlugin | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const name = typeof entry['name'] === 'string' ? entry['name'] : '';
  if (!name) return null;

  const author = entry['author'];
  const authorName =
    typeof author === 'string'
      ? author
      : author && typeof author === 'object'
        ? (author as { name?: unknown }).name
        : undefined;

  const tags = [
    ...(Array.isArray(entry['tags']) ? (entry['tags'] as unknown[]) : []),
    ...(Array.isArray(entry['keywords']) ? (entry['keywords'] as unknown[]) : []),
  ].filter((tag): tag is string => typeof tag === 'string');

  return {
    name,
    displayName: typeof entry['displayName'] === 'string' ? entry['displayName'] : undefined,
    description: typeof entry['description'] === 'string' ? entry['description'] : '',
    author: typeof authorName === 'string' ? authorName : undefined,
    category: typeof entry['category'] === 'string' ? entry['category'] : undefined,
    homepage: typeof entry['homepage'] === 'string' ? entry['homepage'] : undefined,
    version: typeof entry['version'] === 'string' ? entry['version'] : undefined,
    tags,
    source: normaliseSource(entry['source']),
    declaresMcp: Boolean(entry['mcpServers']),
    declaresSkills: Array.isArray(entry['skills']) && entry['skills'].length > 0,
    origin,
  };
}

async function fetchOne(
  source: MarketplaceSource,
  signal: AbortSignal | undefined,
): Promise<CatalogPlugin[]> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(source.url, { signal: combined });
  if (!response.ok) {
    throw new PlifError('NETWORK_ERROR', `${source.label} marketplace returned ${response.status}`, {
      detail: { url: source.url, status: response.status },
      hint: 'GitHub may be rate limiting or the branch may have moved.',
    });
  }

  const body = (await response.json()) as { plugins?: unknown };
  const plugins = Array.isArray(body.plugins) ? body.plugins : [];
  return plugins
    .map((entry) => normalisePlugin(entry, source.id))
    .filter((plugin): plugin is CatalogPlugin => plugin !== null);
}

export interface CatalogOptions {
  /** Where to keep the cached copy. */
  readonly cacheFile: string;
  readonly signal?: AbortSignal;
  /** Ignore the cache and go to the network. */
  readonly refresh?: boolean;
  readonly sources?: readonly MarketplaceSource[];
}

/**
 * Load the catalogue, from disk when it is fresh and from the network when it
 * is not.
 *
 * Falling back to a stale cache on a network failure is deliberate. Three
 * thousand entries that are six hours old are useful; an error message is not,
 * and "browse the plugins" is a thing people do on a train. The staleness is
 * surfaced rather than hidden, so nobody is misled about how current it is.
 */
export async function loadCatalog(options: CatalogOptions): Promise<Catalog> {
  const sources = options.sources ?? MARKETPLACES;

  if (!options.refresh) {
    const cached = await readCache(options.cacheFile);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  }

  const results = await Promise.allSettled(
    sources.map((source) => fetchOne(source, options.signal)),
  );

  const plugins: CatalogPlugin[] = [];
  const outcomes: { id: string; ok: boolean; count: number; problem?: string }[] = [];

  for (const [index, result] of results.entries()) {
    const source = sources[index] as MarketplaceSource;
    if (result.status === 'fulfilled') {
      plugins.push(...result.value);
      outcomes.push({ id: source.id, ok: true, count: result.value.length });
    } else {
      const problem =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      outcomes.push({ id: source.id, ok: false, count: 0, problem });
    }
  }

  if (plugins.length === 0) {
    // Nothing came back. A stale cache beats an empty screen.
    const cached = await readCache(options.cacheFile);
    if (cached) {
      return { ...cached, stale: true, sources: outcomes };
    }
    throw new PlifError('NETWORK_ERROR', 'could not reach either plugin marketplace', {
      detail: { sources: outcomes },
      hint: 'Check the network, then press r to retry.',
    });
  }

  const catalog: Catalog = {
    plugins: dedupe(plugins),
    fetchedAt: Date.now(),
    stale: false,
    sources: outcomes,
  };
  await writeCache(options.cacheFile, catalog);
  return catalog;
}

/**
 * One entry per plugin name, official winning.
 *
 * The community mirror repeats much of the official list. Showing both would
 * put the same plugin on screen twice with no way to tell which to pick, and
 * the reviewed copy is the one to prefer.
 */
function dedupe(plugins: readonly CatalogPlugin[]): CatalogPlugin[] {
  const byName = new Map<string, CatalogPlugin>();
  for (const plugin of plugins) {
    const existing = byName.get(plugin.name);
    if (!existing || (existing.origin !== 'official' && plugin.origin === 'official')) {
      byName.set(plugin.name, plugin);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Rank plugins against a query.
 *
 * Tiers, not a score: an exact name, a name prefix, a name substring, then the
 * description and tags. Over three thousand entries the difference between
 * "sorted by relevance" and "sorted by whatever matched" is the difference
 * between finding `github` in one keystroke and scrolling past forty plugins
 * whose descriptions mention GitHub.
 */
export function searchPlugins(
  plugins: readonly CatalogPlugin[],
  query: string,
  limit = 200,
): CatalogPlugin[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return plugins.slice(0, limit);

  const tiers: CatalogPlugin[][] = [[], [], [], []];

  for (const plugin of plugins) {
    const name = plugin.name.toLowerCase();
    const display = (plugin.displayName ?? '').toLowerCase();
    if (name === needle || display === needle) tiers[0]?.push(plugin);
    else if (name.startsWith(needle) || display.startsWith(needle)) tiers[1]?.push(plugin);
    else if (name.includes(needle) || display.includes(needle)) tiers[2]?.push(plugin);
    else if (
      plugin.description.toLowerCase().includes(needle) ||
      plugin.category?.toLowerCase().includes(needle) ||
      plugin.tags.some((tag) => tag.toLowerCase().includes(needle))
    ) {
      tiers[3]?.push(plugin);
    }
  }

  return tiers.flat().slice(0, limit);
}

/** Every category present, most populated first. */
export function categoriesOf(plugins: readonly CatalogPlugin[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const plugin of plugins) {
    if (!plugin.category) continue;
    counts.set(plugin.category, (counts.get(plugin.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * A browsable URL for the plugin's source, for the detail pane.
 *
 * Takes the whole plugin rather than just its source, because a relative
 * source is a path *inside the marketplace repository* and needs the origin to
 * resolve. That is not an edge case: it is the most common shape in the
 * official directory, so a version that only handled the explicit kinds left
 * the majority of entries with no link at all.
 */
export function sourceUrl(plugin: CatalogPlugin): string | undefined {
  const { source } = plugin;
  switch (source.kind) {
    case 'git-subdir':
      return source.url.replace(/\.git$/, '');
    case 'github':
      return `https://github.com/${source.repo}`;
    case 'url':
      return source.url.replace(/\.git$/, '');
    case 'relative': {
      const origin = MARKETPLACES.find((entry) => entry.id === plugin.origin);
      if (!origin) return undefined;
      return `${origin.repo}/tree/main/${source.path.replace(/^\.\//, '')}`;
    }
    default:
      return undefined;
  }
}

/**
 * `owner/repo`, however the entry chose to write it.
 *
 * The community list writes a git-subdir url both ways: a full clone URL and a
 * bare `owner/repo`. Requiring the host dropped every bare one — 429 entries
 * that produced no candidate URL at all and could never be installed.
 */
function githubRepo(url: string): string | undefined {
  const cleaned = url.replace(/\.git(?=$|[/#?])/, '').trim();
  const hosted = /github\.com\/([^/#?]+)\/([^/#?]+)/.exec(cleaned);
  if (hosted) return `${hosted[1]}/${hosted[2]}`;
  const bare = /^([\w.-]+)\/([\w.-]+)$/.exec(cleaned);
  return bare ? `${bare[1]}/${bare[2]}` : undefined;
}

function rawBase(repo: string, ref: string, subdirectory = ''): string {
  const trimmed = subdirectory.replace(/^\.?\//, '').replace(/\/$/, '');
  return `https://raw.githubusercontent.com/${repo}/${ref}${trimmed ? `/${trimmed}` : ''}`;
}

function distinct(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/**
 * Where a plugin's manifests can actually be fetched from.
 *
 * Separate from `sourceUrl`, which builds a page for a human to open. A raw
 * manifest URL needs a ref and the plugin's subdirectory, and neither survives
 * rewriting a `github.com` link by string replacement.
 */
export function manifestBaseUrls(plugin: CatalogPlugin): string[] {
  const { source } = plugin;
  switch (source.kind) {
    case 'github': {
      const repo = githubRepo(`https://github.com/${source.repo}`) ?? source.repo;
      return distinct([source.commit, source.sha, 'main', 'master']).map((ref) => rawBase(repo, ref));
    }
    case 'git-subdir': {
      const repo = githubRepo(source.url);
      if (!repo) return [];
      return distinct([source.ref, source.sha, 'main', 'master']).map((ref) =>
        rawBase(repo, ref, source.path),
      );
    }
    case 'relative': {
      const origin = MARKETPLACES.find((entry) => entry.id === plugin.origin);
      const repo = origin ? githubRepo(origin.repo) : undefined;
      return repo ? [rawBase(repo, 'main', source.path)] : [];
    }
    case 'url': {
      const url = source.url.replace(/\.git(?=$|[/#?])/, '').replace(/\/$/, '');
      if (url.includes('raw.githubusercontent.com')) return [url];
      const repo = githubRepo(url);
      if (!repo) return [url];
      const tree = /\/(?:tree|blob)\/([^/]+)\/?(.*)$/.exec(url);
      if (tree) return [rawBase(repo, tree[1] as string, tree[2] ?? '')];
      return distinct([source.sha, 'main', 'master']).map((ref) => rawBase(repo, ref));
    }
    default:
      return [];
  }
}

/**
 * The MCP servers a manifest declares.
 *
 * Both shapes ship in the official catalogue: context7 wraps its servers in
 * `mcpServers`, playwright writes the bare map. Reading only the wrapper made
 * every bare manifest look like no manifest at all.
 */
export function declaredServers(parsed: Record<string, unknown>): Record<string, unknown> {
  const wrapped = parsed['mcpServers'];
  if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    return { ...(wrapped as Record<string, unknown>) };
  }

  const bare: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const config = value as Record<string, unknown>;
    if (typeof config['command'] === 'string' || typeof config['url'] === 'string') {
      bare[name] = config;
    }
  }
  return bare;
}

/** Install the machine-readable MCP/skill manifests exposed by a plugin. */

/**
 * Fetch and write the skills a plugin ships.
 *
 * plif used to report these and throw them away — the install failed with
 * "it ships skills rather than a server, copy them into your skills directory
 * by hand", which is the interface knowing exactly what to do and declining to
 * do it.
 *
 * Two things are deliberate. Skills land under the plugin's own name, so two
 * plugins that both ship a `review` skill do not silently overwrite each
 * other and the winner is not decided by install order. And every installed
 * skill records where it came from: a skill is *instructions the model will
 * follow*, so installing one from a three-thousand-entry community catalogue
 * is installing behaviour, and the provenance has to survive into the file
 * where someone reading it later can see it.
 */
async function installPluginSkills(
  plugin: CatalogPlugin,
  declared: readonly string[],
  bases: readonly string[],
  skillsRoot: string,
): Promise<{
  readonly installed: string[];
  readonly skipped: { name: string; reason: string }[];
}> {
  const installed: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const entry of declared) {
    // A manifest may name the directory (`skills/review`) or just the skill.
    const declaredName =
      entry.split(/[\\/]+/).filter(Boolean).at(-1) ?? '';
    if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(declaredName)) {
      skipped.push({ name: entry, reason: 'the declared name is not a usable skill name' });
      continue;
    }

    const candidates = bases.flatMap((base) => [
      `${base}/${entry.replace(/^\/+/, '')}/SKILL.md`,
      `${base}/skills/${declaredName}/SKILL.md`,
    ]);

    let source: string | null = null;
    for (const url of distinct(candidates)) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) continue;
        source = await response.text();
        break;
      } catch {
        continue;
      }
    }
    if (source === null) {
      skipped.push({ name: declaredName, reason: 'no SKILL.md was found in the plugin source' });
      continue;
    }

    const parsed = parseSkill(source, 'plugin', 'user');
    if (!parsed) {
      skipped.push({ name: declaredName, reason: 'the SKILL.md has no readable frontmatter' });
      continue;
    }

    // Namespaced by plugin, so a common skill name cannot collide.
    const name = `${slugForSkill(plugin.name)}-${declaredName}`.slice(0, 48).replace(/-+$/, '');
    try {
      await writeSkill(skillsRoot, {
        name,
        description: parsed.description,
        instructions:
          `${parsed.instructions.trim()}

---
` +
          `Installed from the "${plugin.name}" plugin (${plugin.origin} marketplace).`,
      });
      installed.push(name);
    } catch (error) {
      skipped.push({
        name: declaredName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { installed, skipped };
}

/** A plugin name, reduced to something a skill name can start with. */
function slugForSkill(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';
}

export async function installMarketplacePlugin(
  plugin: CatalogPlugin,
  configFile: string,
  /** Where a plugin's skills are written. Omit to install servers only. */
  skillsRoot?: string,
): Promise<MarketplaceInstallResult> {
  const bases = manifestBaseUrls(plugin);
  if (bases.length === 0) {
    throw new PlifError('INVALID_ARGUMENT', `cannot install ${plugin.name}: source is unknown`);
  }

  let mcp: Record<string, unknown> = {};
  const skills: string[] = [];
  const tried: string[] = [];
  let manifest: string | undefined;

  for (const base of bases) {
    for (const file of [`${base}/.mcp.json`, `${base}/.claude-plugin/plugin.json`]) {
      tried.push(file);
      let parsed: Record<string, unknown>;
      try {
        const response = await fetch(file, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) continue;
        parsed = JSON.parse(await response.text()) as Record<string, unknown>;
      } catch {
        continue;
      }
      manifest ??= file;
      mcp = { ...mcp, ...declaredServers(parsed) };
      if (Array.isArray(parsed['skills'])) {
        skills.push(...parsed['skills'].filter((item): item is string => typeof item === 'string'));
      }
    }
    if (Object.keys(mcp).length > 0) break;
  }

  // A plugin that ships skills and no server is a real install now, so the
  // fetch happens before anything is judged missing.
  //
  // Deduplicated first: the manifest is looked for under several base URLs and
  // several filenames, so a repo that answers on both `main` and `master` — or
  // ships both `.mcp.json` and `plugin.json` — declares the same skill more
  // than once, and installing it twice writes the same file twice and reports
  // it twice.
  const declaredSkills = distinct(skills);
  const skillOutcome = declaredSkills.length > 0 && skillsRoot
    ? await installPluginSkills(plugin, declaredSkills, bases, skillsRoot)
    : { installed: [], skipped: [] as { name: string; reason: string }[] };

  // Nothing to install only means nothing of *either* kind arrived.
  if (Object.keys(mcp).length === 0 && skillOutcome.installed.length === 0) {
    throw manifest
      ? new PlifError('INVALID_ARGUMENT', `${plugin.name} installed nothing plif can use`, {
          detail: {
            manifest,
            ...(declaredSkills.length ? { declaredSkills } : {}),
            ...(skillOutcome.skipped.length ? { skippedSkills: skillOutcome.skipped } : {}),
          },
          hint: declaredSkills.length
            ? 'It declares skills, but none of them could be fetched from its source.'
            : 'It is a Claude Code plugin of commands or agents. plif installs MCP servers and skills here.',
        })
      : new PlifError('INVALID_ARGUMENT', `${plugin.name} publishes no manifest plif can read`, {
          detail: { tried },
          hint: `Add its MCP servers by hand under "mcp" in ${configFile}.`,
        });
  }

  // Skills alone are a complete install; there is no config to write for them.
  if (Object.keys(mcp).length === 0) {
    return {
      name: plugin.name,
      mcpServers: [],
      skills: skillOutcome.installed,
      skippedSkills: skillOutcome.skipped,
      replaced: [],
      configFile,
      ...(skillsRoot ? { skillsDirectory: skillsRoot } : {}),
    };
  }

  const current = await loadGlobalConfig(configFile);
  // Whichever key this config already uses. Writing `mcp` into a file that
  // declares `mcpServers` hides every server it had, because the reader takes
  // the first key that exists and never merges the two.
  const key = current.mcp === undefined && current.mcpServers !== undefined ? 'mcpServers' : 'mcp';
  const existing =
    current[key] && typeof current[key] === 'object' && !Array.isArray(current[key])
      ? (current[key] as Record<string, unknown>)
      : {};
  const replaced = Object.keys(mcp).filter((server) => server in existing);

  await saveGlobalConfig({ ...current, [key]: { ...existing, ...mcp } }, configFile);
  return {
    name: plugin.name,
    mcpServers: Object.keys(mcp),
    skills: skillOutcome.installed,
    skippedSkills: skillOutcome.skipped,
    replaced,
    configFile,
    ...(skillsRoot ? { skillsDirectory: skillsRoot } : {}),
  };
}

async function readCache(file: string): Promise<Catalog | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Catalog;
    if (!Array.isArray(parsed.plugins)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(file: string, catalog: Catalog): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(catalog), 'utf8');
    await fs.rename(temporary, file);
  } catch {
    // A cache that cannot be written is a slower browser, not a broken one.
  }
}
