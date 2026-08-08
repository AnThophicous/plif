/**
 * Reading the Claude plugin marketplaces.
 *
 * The entries are written by three thousand different people and the shapes
 * vary more than the schema suggests: `source` is a string in some, an object
 * with four different `source` discriminators in others; `author` is sometimes
 * a string and sometimes an object; half the community entries have no
 * category at all. Anything that assumes one shape drops entries silently,
 * which is the worst way for a catalogue to be wrong.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  MARKETPLACES,
  categoriesOf,
  declaredServers,
  installMarketplacePlugin,
  loadCatalog,
  manifestBaseUrls,
  searchPlugins,
  sourceUrl,
} from '../src/marketplace/catalog.js';
import type { CatalogPlugin, MarketplaceSource } from '../src/marketplace/catalog.js';
import { loadGlobalConfig, mcpServersOf } from '../src/config/global.js';

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-marketplace-'));

/**
 * A real HTTP server on localhost, not a `file://` URL.
 *
 * `fetch` does not implement the file scheme, so a file-backed fixture fails
 * with the same "could not reach either marketplace" a genuine outage
 * produces — a test that would pass whether the parser worked or not.
 */
const routes = new Map<string, string>();
const server = createServer((request, response) => {
  const body = routes.get(request.url ?? '');
  if (body === undefined) {
    response.writeHead(404).end('no such fixture');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(body);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(scratch, { recursive: true, force: true });
});

let route = 0;

/** A marketplace served locally, so the parser is tested without the network. */
async function localMarketplace(body: unknown, id = 'official'): Promise<MarketplaceSource> {
  const at = `/m${(route += 1)}.json`;
  routes.set(at, JSON.stringify(body));
  return {
    id,
    label: id,
    curator: 'test',
    url: `${origin}${at}`,
    repo: `https://github.com/anthropics/claude-plugins-${id}`,
  };
}

function plugin(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { name: 'thing', description: 'does a thing', ...over };
}

async function parse(entries: readonly unknown[], id = 'official'): Promise<CatalogPlugin[]> {
  const source = await localMarketplace({ plugins: entries }, id);
  const catalog = await loadCatalog({
    cacheFile: path.join(scratch, `cache-${Math.random().toString(36).slice(2)}.json`),
    refresh: true,
    sources: [source],
  });
  return [...catalog.plugins];
}

describe('parsing entries', () => {
  it('reads an author given as an object or as a string', () => {
    // Both appear in the real data, in the same file.
    return (async () => {
      const [asObject, asString] = await parse([
        plugin({ name: 'a', author: { name: 'Adobe' } }),
        plugin({ name: 'b', author: 'Google LLC' }),
      ]);
      assert.equal(asObject?.author, 'Adobe');
      assert.equal(asString?.author, 'Google LLC');
    })();
  });

  it('keeps every source shape rather than dropping the ones it does not know', async () => {
    const parsed = await parse([
      plugin({ name: 'a', source: './plugins/a' }),
      plugin({ name: 'b', source: { source: 'git-subdir', url: 'https://x.git', path: 'p', ref: 'v1' } }),
      plugin({ name: 'c', source: { source: 'github', repo: 'o/r', commit: 'abc' } }),
      plugin({ name: 'd', source: { source: 'url', url: 'https://y.git' } }),
      plugin({ name: 'e', source: { source: 'martian' } }),
    ]);
    assert.deepEqual(
      parsed.map((entry) => entry.source.kind),
      ['relative', 'git-subdir', 'github', 'url', 'unknown'],
    );
  });

  it('drops an entry with no name, and only that one', async () => {
    // A nameless entry cannot be selected or installed; the rest are fine.
    const parsed = await parse([plugin({ name: 'a' }), { description: 'nameless' }, plugin({ name: 'b' })]);
    assert.deepEqual(parsed.map((entry) => entry.name), ['a', 'b']);
  });

  it('merges tags and keywords, which are two names for one thing', async () => {
    const [entry] = await parse([plugin({ tags: ['db'], keywords: ['sql'] })]);
    assert.deepEqual(entry?.tags, ['db', 'sql']);
  });

  it('survives a missing category, which most community entries have', async () => {
    const [entry] = await parse([plugin({})]);
    assert.equal(entry?.category, undefined);
  });
});

describe('deduplication', () => {
  it('prefers the official copy when both lists carry a plugin', async () => {
    const official = await localMarketplace({ plugins: [plugin({ name: 'shared' })] }, 'official');
    const community = await localMarketplace({ plugins: [plugin({ name: 'shared' })] }, 'community');
    const catalog = await loadCatalog({
      cacheFile: path.join(scratch, 'dedupe.json'),
      refresh: true,
      // Community first, so a naive "last wins" would pick the wrong one.
      sources: [community, official],
    });
    assert.equal(catalog.plugins.length, 1);
    assert.equal(catalog.plugins[0]?.origin, 'official');
  });
});

describe('resilience', () => {
  it('keeps the good list when one marketplace fails', async () => {
    const good = await localMarketplace({ plugins: [plugin({ name: 'a' })] }, 'official');
    const bad: MarketplaceSource = {
      id: 'community',
      label: 'community',
      curator: 'test',
      url: 'file:///definitely/not/here.json',
      repo: 'https://github.com/x/y',
    };
    const catalog = await loadCatalog({
      cacheFile: path.join(scratch, 'partial.json'),
      refresh: true,
      sources: [good, bad],
    });
    assert.equal(catalog.plugins.length, 1);
    // The failure is reported rather than swallowed: a catalogue quietly
    // missing two thousand entries looks like a search that found nothing.
    const failed = catalog.sources.find((entry) => entry.id === 'community');
    assert.equal(failed?.ok, false);
    assert.ok(failed?.problem);
  });

  it('falls back to a stale cache rather than showing an empty screen', async () => {
    const cacheFile = path.join(scratch, 'stale.json');
    const good = await localMarketplace({ plugins: [plugin({ name: 'cached' })] }, 'official');
    await loadCatalog({ cacheFile, refresh: true, sources: [good] });

    const dead: MarketplaceSource = { ...good, url: 'file:///gone.json' };
    const catalog = await loadCatalog({ cacheFile, refresh: true, sources: [dead] });

    assert.equal(catalog.plugins[0]?.name, 'cached');
    assert.equal(catalog.stale, true, 'staleness must be visible, not hidden');
  });

  it('serves the cache without touching the network when it is fresh', async () => {
    const cacheFile = path.join(scratch, 'fresh.json');
    const good = await localMarketplace({ plugins: [plugin({ name: 'x' })] }, 'official');
    await loadCatalog({ cacheFile, refresh: true, sources: [good] });

    const dead: MarketplaceSource = { ...good, url: 'file:///gone.json' };
    const catalog = await loadCatalog({ cacheFile, sources: [dead] });
    assert.equal(catalog.plugins[0]?.name, 'x');
    assert.equal(catalog.stale, false);
  });
});

describe('search', () => {
  const plugins = [
    { name: 'github-cli-health-check', description: '', category: undefined, tags: [] },
    { name: 'github', description: '', category: undefined, tags: [] },
    { name: 'gh-mcp', description: 'talks to github', category: undefined, tags: [] },
    { name: 'notion', description: 'notes', category: undefined, tags: ['github'] },
  ] as unknown as CatalogPlugin[];

  it('puts the exact name first, however late it appears', () => {
    // Over three thousand entries this is the difference between finding
    // `github` in one keystroke and scrolling past forty that mention it.
    assert.equal(searchPlugins(plugins, 'github')[0]?.name, 'github');
  });

  it('ranks a name match above a description or tag match', () => {
    const names = searchPlugins(plugins, 'github').map((entry) => entry.name);
    assert.ok(names.indexOf('github-cli-health-check') < names.indexOf('gh-mcp'));
    assert.ok(names.indexOf('gh-mcp') < names.indexOf('notion'));
  });

  it('returns everything for an empty query', () => {
    assert.equal(searchPlugins(plugins, '   ').length, plugins.length);
  });
});

describe('presentation helpers', () => {
  it('counts categories, most populated first', () => {
    const counted = categoriesOf([
      { category: 'database' },
      { category: 'development' },
      { category: 'development' },
      { category: undefined },
    ] as unknown as CatalogPlugin[]);
    assert.deepEqual(counted, [
      { name: 'development', count: 2 },
      { name: 'database', count: 1 },
    ]);
  });

  it('resolves a relative source against the marketplace it came from', () => {
    // The most common shape in the official list. Without the origin it would
    // show no link at all, which is most of the catalogue.
    const url = sourceUrl({
      name: 'github',
      origin: 'official',
      source: { kind: 'relative', path: './plugins/github' },
    } as CatalogPlugin);
    assert.equal(
      url,
      `${MARKETPLACES.find((entry) => entry.id === 'official')?.repo}/tree/main/plugins/github`,
    );
  });

  it('strips the .git suffix so the link is browsable', () => {
    const url = sourceUrl({
      origin: 'community',
      source: { kind: 'git-subdir', url: 'https://github.com/o/r.git', path: 'p' },
    } as CatalogPlugin);
    assert.equal(url, 'https://github.com/o/r');
  });
});

describe('manifest locations', () => {
  const bases = (source: CatalogPlugin['source'], origin = 'community'): string[] =>
    manifestBaseUrls({ origin, source } as CatalogPlugin);

  it('puts a ref in a github source, which a browsable link does not carry', () => {
    // The bug this covers: rewriting the display URL by string replacement
    // produced raw.githubusercontent.com/o/r/.mcp.json — no branch at all, so
    // every github-sourced plugin 404ed and reported "no supported manifest".
    const urls = bases({ kind: 'github', repo: 'o/r' });

    assert.equal(urls[0], 'https://raw.githubusercontent.com/o/r/main');
    assert.ok(urls.includes('https://raw.githubusercontent.com/o/r/master'));
    for (const url of urls) assert.doesNotMatch(url, /raw\.githubusercontent\.com\/o\/r$/);
  });

  it('prefers a pinned commit over a guessed branch', () => {
    const urls = bases({ kind: 'github', repo: 'o/r', commit: 'abc123' });
    assert.equal(urls[0], 'https://raw.githubusercontent.com/o/r/abc123');
  });

  it('keeps the subdirectory of a git-subdir source', () => {
    const urls = bases({ kind: 'git-subdir', url: 'https://github.com/o/r.git', path: 'plugins/pw' });
    assert.equal(urls[0], 'https://raw.githubusercontent.com/o/r/main/plugins/pw');
  });

  it('accepts a git-subdir url written as a bare owner/repo', () => {
    // How most of the community list writes it. Requiring the host left 429
    // entries with no candidate URL at all, so they could never install.
    const urls = bases({
      kind: 'git-subdir',
      url: 'barnburner121/claude-plugin-marketplace',
      path: 'generated-plugins/a11y-fixer',
      ref: 'main',
    });

    assert.equal(
      urls[0],
      'https://raw.githubusercontent.com/barnburner121/claude-plugin-marketplace/main/generated-plugins/a11y-fixer',
    );
  });

  it('does not mistake a path for a repository', () => {
    assert.deepEqual(bases({ kind: 'git-subdir', url: 'a/b/c', path: 'p' }), []);
  });

  it('honours an explicit ref on a git-subdir source', () => {
    const urls = bases({ kind: 'git-subdir', url: 'https://github.com/o/r', path: './p', ref: 'v2' });
    assert.equal(urls[0], 'https://raw.githubusercontent.com/o/r/v2/p');
  });

  it('resolves a relative source inside its own marketplace repository', () => {
    const urls = manifestBaseUrls({
      origin: 'official',
      source: { kind: 'relative', path: './plugins/github' },
    } as CatalogPlugin);

    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /^https:\/\/raw\.githubusercontent\.com\/anthropics\/[^/]+\/main\/plugins\/github$/);
  });

  it('converts a tree URL and leaves a raw URL alone', () => {
    assert.equal(
      bases({ kind: 'url', url: 'https://github.com/o/r/tree/dev/sub' })[0],
      'https://raw.githubusercontent.com/o/r/dev/sub',
    );
    assert.equal(
      bases({ kind: 'url', url: 'https://raw.githubusercontent.com/o/r/main/' })[0],
      'https://raw.githubusercontent.com/o/r/main',
    );
  });

  it('gives nothing to install for a source it cannot resolve', () => {
    assert.deepEqual(bases({ kind: 'unknown', raw: '???' }), []);
  });
});

describe('installing into the config', () => {
  async function served(manifest: unknown): Promise<CatalogPlugin> {
    const at = `/p${(route += 1)}`;
    routes.set(`${at}/.mcp.json`, JSON.stringify(manifest));
    return { name: 'fixture', origin: 'community', source: { kind: 'url', url: `${origin}${at}` } } as CatalogPlugin;
  }

  async function configFile(body: unknown): Promise<string> {
    const file = path.join(scratch, `config-${(route += 1)}.jsonc`);
    await fs.writeFile(file, JSON.stringify(body), 'utf8');
    return file;
  }

  const servers = { added: { command: 'npx', args: ['thing'] } };

  it('writes into mcp when the config has no servers yet', async () => {
    const plugin = await served({ mcpServers: servers });
    const file = await configFile({ model: 'x' });

    const result = await installMarketplacePlugin(plugin, file);

    assert.deepEqual(result.mcpServers, ['added']);
    assert.deepEqual(result.replaced, []);
    const config = await loadGlobalConfig(file);
    assert.deepEqual(mcpServersOf(config), servers);
    assert.equal(config.model, 'x', 'the rest of the config survives');
  });

  it('writes into mcpServers when that is the key already in use', async () => {
    // The reader takes `mcp` when it exists and never merges the two, so
    // writing the new server under `mcp` hid every server this file had.
    const plugin = await served({ mcpServers: servers });
    const file = await configFile({ mcpServers: { mine: { command: 'node' } } });

    await installMarketplacePlugin(plugin, file);

    const config = await loadGlobalConfig(file);
    assert.equal(config.mcp, undefined, 'no shadowing key was introduced');
    assert.deepEqual(mcpServersOf(config), {
      mine: { command: 'node' },
      added: { command: 'npx', args: ['thing'] },
    });
  });

  it('says which of your servers it overwrote', async () => {
    const plugin = await served({ mcpServers: servers });
    const file = await configFile({ mcp: { added: { command: 'my-own-thing' } } });

    const result = await installMarketplacePlugin(plugin, file);

    assert.deepEqual(result.replaced, ['added']);
  });

  it('refuses a plugin whose manifest declares no server', async () => {
    const plugin = await served({ name: 'commands-only', description: 'agents and commands' });
    const file = await configFile({});

    await assert.rejects(installMarketplacePlugin(plugin, file), /declares no MCP server/);
    assert.deepEqual(await loadGlobalConfig(file), {}, 'nothing was written');
  });

  it('separates a plugin that publishes nothing from one that declares nothing', async () => {
    const missing = { name: 'gone', origin: 'community', source: { kind: 'url', url: `${origin}/nowhere` } } as CatalogPlugin;

    await assert.rejects(
      installMarketplacePlugin(missing, await configFile({})),
      /publishes no manifest/,
    );
  });
});

describe('manifest shapes', () => {
  it('reads the wrapped form context7 ships', () => {
    const servers = declaredServers({
      mcpServers: { context7: { type: 'http', url: 'https://mcp.context7.test/mcp' } },
    });
    assert.deepEqual(Object.keys(servers), ['context7']);
  });

  it('reads the bare form playwright ships', () => {
    // The whole reason playwright reported "no supported install manifest":
    // its .mcp.json is a bare name → config map with no wrapper.
    const servers = declaredServers({
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
    });
    assert.deepEqual(Object.keys(servers), ['playwright']);
  });

  it('does not mistake plugin metadata for a server', () => {
    const servers = declaredServers({
      name: 'playwright',
      description: 'browser automation',
      version: '1.0.0',
      author: { name: 'Microsoft' },
    });
    assert.deepEqual(servers, {});
  });

  it('prefers the wrapper when a manifest carries both', () => {
    const servers = declaredServers({
      mcpServers: { real: { url: 'https://real.test/mcp' } },
      decoy: { command: 'no' },
    });
    assert.deepEqual(Object.keys(servers), ['real']);
  });
});
