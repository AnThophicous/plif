/**
 * Installing a plugin's skills, not just its servers.
 *
 * plif used to report a plugin's skills and throw them away — the install
 * failed with "copy them into your skills directory by hand", which is the
 * interface knowing exactly what to do and declining to do it.
 *
 * A skill is instructions the model will follow, so the tests below care as
 * much about provenance and collisions as about the happy path.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { installMarketplacePlugin, type CatalogPlugin } from '../src/marketplace/catalog.js';
import { parseSkill } from '../src/harness/skills.js';
import { saveGlobalConfig } from '../src/config/global.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function plugin(name: string): CatalogPlugin {
  return {
    name,
    displayName: name,
    description: 'a test plugin',
    author: 'tester',
    category: undefined,
    homepage: undefined,
    version: '1.0.0',
    tags: [],
    source: { kind: 'github', repo: 'tester/example' },
    declaresMcp: false,
    declaresSkills: true,
    origin: 'community',
  };
}

/** Serve a manifest and a set of SKILL.md files; everything else 404s. */
function serve(files: Record<string, string>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.keys(files).find((suffix) => url.endsWith(suffix));
    if (!match) return new Response('not found', { status: 404 });
    return new Response(files[match], { status: 200 });
  }) as typeof globalThis.fetch;
}

async function scratch(): Promise<{ config: string; skills: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-plugin-'));
  const config = path.join(root, 'config.toml');
  await saveGlobalConfig({}, config);
  return { config, skills: path.join(root, 'skills') };
}

const manifest = (skills: string[]): string => JSON.stringify({ skills });
const skillFile = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo the ${name} thing carefully.\n`;

describe('installing plugin skills', () => {
  it('writes a declared skill to disk instead of refusing', async () => {
    const { config, skills } = await scratch();
    serve({
      '/.claude-plugin/plugin.json': manifest(['review']),
      '/skills/review/SKILL.md': skillFile('review', 'Review a diff for real defects'),
    });

    const result = await installMarketplacePlugin(plugin('acme-tools'), config, skills);

    assert.deepEqual(result.mcpServers, []);
    assert.deepEqual(result.skills, ['acme-tools-review']);
    const written = await fs.readFile(
      path.join(skills, 'acme-tools-review', 'SKILL.md'),
      'utf8',
    );
    assert.match(written, /Do the review thing carefully/);
  });

  it('namespaces by plugin, so two plugins can both ship "review"', async () => {
    // Otherwise the winner is decided by install order and the loser vanishes
    // without a word.
    const { config, skills } = await scratch();
    serve({
      '/.claude-plugin/plugin.json': manifest(['review']),
      '/skills/review/SKILL.md': skillFile('review', 'Review a diff'),
    });

    await installMarketplacePlugin(plugin('acme-tools'), config, skills);
    await installMarketplacePlugin(plugin('other-pack'), config, skills);

    assert.ok(await fs.stat(path.join(skills, 'acme-tools-review', 'SKILL.md')));
    assert.ok(await fs.stat(path.join(skills, 'other-pack-review', 'SKILL.md')));
  });

  it('records where the skill came from, inside the skill', async () => {
    // Installing a skill from a community catalogue is installing behaviour.
    // Whoever reads the file later has to be able to see its origin.
    const { config, skills } = await scratch();
    serve({
      '/.claude-plugin/plugin.json': manifest(['review']),
      '/skills/review/SKILL.md': skillFile('review', 'Review a diff'),
    });
    await installMarketplacePlugin(plugin('acme-tools'), config, skills);

    const written = await fs.readFile(path.join(skills, 'acme-tools-review', 'SKILL.md'), 'utf8');
    assert.match(written, /Installed from the "acme-tools" plugin \(community marketplace\)/);
    // And it must still parse as a skill after the provenance line is appended.
    assert.ok(parseSkill(written, 'x', 'user'));
  });

  it('names the skills it could not fetch rather than silently dropping them', async () => {
    const { config, skills } = await scratch();
    serve({
      '/.claude-plugin/plugin.json': manifest(['review', 'missing']),
      '/skills/review/SKILL.md': skillFile('review', 'Review a diff'),
    });

    const result = await installMarketplacePlugin(plugin('acme-tools'), config, skills);
    assert.deepEqual(result.skills, ['acme-tools-review']);
    assert.equal(result.skippedSkills.length, 1);
    assert.equal(result.skippedSkills[0]?.name, 'missing');
  });

  it('still fails when a plugin offers nothing plif can use', async () => {
    const { config, skills } = await scratch();
    serve({ '/.claude-plugin/plugin.json': JSON.stringify({ commands: ['x'] }) });

    await assert.rejects(
      () => installMarketplacePlugin(plugin('acme-tools'), config, skills),
      /installed nothing plif can use/,
    );
  });

  it('installs servers and skills together when a plugin ships both', async () => {
    const { config, skills } = await scratch();
    serve({
      '/.mcp.json': JSON.stringify({
        mcpServers: { acme: { command: 'npx', args: ['-y', 'acme-mcp'] } },
        skills: ['review'],
      }),
      '/skills/review/SKILL.md': skillFile('review', 'Review a diff'),
    });

    const result = await installMarketplacePlugin(plugin('acme-tools'), config, skills);
    assert.deepEqual(result.mcpServers, ['acme']);
    assert.deepEqual(result.skills, ['acme-tools-review']);
  });

  it('installs only servers when no skills directory is offered', async () => {
    // An embedder without a skills root must not have skills written anywhere
    // it did not ask for.
    const { config } = await scratch();
    serve({
      '/.mcp.json': JSON.stringify({
        mcpServers: { acme: { command: 'npx', args: ['-y', 'acme-mcp'] } },
        skills: ['review'],
      }),
      '/skills/review/SKILL.md': skillFile('review', 'Review a diff'),
    });

    const result = await installMarketplacePlugin(plugin('acme-tools'), config);
    assert.deepEqual(result.mcpServers, ['acme']);
    assert.deepEqual(result.skills, []);
  });
});
