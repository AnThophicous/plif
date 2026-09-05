/**
 * The curated MCP server list.
 *
 * A curated list is an endorsement, so the tests are about what it must never
 * recommend as much as about what it installs: nothing that reaches around the
 * container, and no credential written into a config file.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { loadGlobalConfig, saveGlobalConfig } from '../src/config/global.js';
import {
  CURATED_MCP_SERVERS,
  curatedServerConfig,
  findCuratedServer,
  installCuratedServer,
} from '../src/marketplace/servers.js';

async function scratchConfig(seed: Record<string, unknown> = {}): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-curated-'));
  const file = path.join(directory, 'config.toml');
  await saveGlobalConfig(seed, file);
  return file;
}

describe('the curated list', () => {
  it('covers the gaps plif does not fill natively', () => {
    const fills = new Set(CURATED_MCP_SERVERS.map((server) => server.fills));
    assert.ok(fills.has('browser'), 'plif has no browser of its own');
    assert.ok(fills.has('devtools'), 'plif has no devtools of its own');
  });

  it('never recommends a server that reaches around the container', () => {
    // This is the one that matters. A filesystem or memory MCP server reads
    // and writes outside the container — no path jail, no policy engine, no
    // audit log — so recommending one would quietly disable plif's security
    // model while looking like a convenience.
    for (const server of CURATED_MCP_SERVERS) {
      const spec = server.args.join(' ');
      assert.ok(!/server-filesystem/.test(spec), `${server.id} bypasses the path jail`);
      assert.ok(!/server-memory/.test(spec), `${server.id} duplicates native memory`);
    }
  });

  it('gives every entry a summary and a stable id', () => {
    const ids = new Set<string>();
    for (const server of CURATED_MCP_SERVERS) {
      assert.match(server.id, /^[a-z0-9-]+$/, `${server.id} is not a usable config key`);
      assert.ok(server.summary.length > 20, `${server.id} needs a real summary`);
      assert.ok(!ids.has(server.id), `${server.id} is listed twice`);
      ids.add(server.id);
    }
  });

  it('references a credential rather than embedding one', () => {
    // plif never writes a secret into a config file; the MCP loader resolves
    // ${VAR} from the environment and the encrypted store at connect time.
    const github = findCuratedServer('github');
    assert.ok(github);
    const config = curatedServerConfig(github) as { env?: Record<string, string> };
    assert.equal(config.env?.['GITHUB_PERSONAL_ACCESS_TOKEN'], '${GITHUB_PERSONAL_ACCESS_TOKEN}');
  });

  it('omits env entirely for a server that needs no credential', () => {
    const playwright = findCuratedServer('playwright');
    assert.ok(playwright);
    assert.equal('env' in curatedServerConfig(playwright), false);
  });
});

describe('installing one', () => {
  it('writes a config the MCP loader can read', async () => {
    const file = await scratchConfig();
    const server = findCuratedServer('playwright')!;
    const result = await installCuratedServer(server, file, {});

    const config = await loadGlobalConfig(file);
    const servers = config.mcp as Record<string, { command: string; args: string[] }>;
    assert.equal(servers['playwright']?.command, 'npx');
    assert.ok(servers['playwright']?.args.includes('@playwright/mcp@latest'));
    assert.equal(result.replaced, false);
  });

  it('keeps the servers that were already configured', async () => {
    const file = await scratchConfig({ mcp: { existing: { command: 'node', args: ['x.js'] } } });
    await installCuratedServer(findCuratedServer('context7')!, file, {});

    const servers = (await loadGlobalConfig(file)).mcp as Record<string, unknown>;
    assert.ok(servers['existing'], 'an existing server must survive');
    assert.ok(servers['context7']);
  });

  it('writes into whichever key the file already uses', async () => {
    // plif reads the first of `mcp` and `mcpServers` that exists and never
    // merges them, so writing into the other one hides everything configured.
    const file = await scratchConfig({ mcpServers: { existing: { command: 'node', args: [] } } });
    await installCuratedServer(findCuratedServer('context7')!, file, {});

    const config = await loadGlobalConfig(file);
    assert.equal(config.mcp, undefined, 'must not start a second, shadowing key');
    assert.ok((config.mcpServers as Record<string, unknown>)['context7']);
  });

  it('reports a replacement rather than doing it silently', async () => {
    const file = await scratchConfig();
    const server = findCuratedServer('github')!;
    await installCuratedServer(server, file, {});
    const second = await installCuratedServer(server, file, {});
    assert.equal(second.replaced, true);
  });

  it('says which credential is missing instead of refusing to install', async () => {
    const file = await scratchConfig();
    const missing = await installCuratedServer(findCuratedServer('github')!, file, {});
    assert.deepEqual(missing.unsetVariables, ['GITHUB_PERSONAL_ACCESS_TOKEN']);

    const present = await installCuratedServer(findCuratedServer('github')!, file, {
      GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_example',
    });
    assert.deepEqual(present.unsetVariables, []);
  });
});
