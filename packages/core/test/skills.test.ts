import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { BUILTIN_SKILLS, SkillRegistry, parseSkill, skillTool, writeSkill } from '../src/harness/skills.js';
import { parseServerConfigs, qualifiedToolName } from '../src/harness/mcp.js';
import { buildSystemPrompt } from '../src/harness/prompt.js';
import { detectShell } from '../src/harness/environment.js';
import { DEFAULT_CAPABILITIES } from '../src/types.js';
import type { ToolContext } from '../src/harness/tools.js';

const context = {} as ToolContext;

describe('parseSkill', () => {
  it('reads name and description from frontmatter', () => {
    const skill = parseSkill(
      '---\nname: deploy\ndescription: how this project ships\n---\n\nRun the pipeline.',
      '/x/deploy/SKILL.md',
      'project',
    );

    assert.equal(skill?.name, 'deploy');
    assert.equal(skill?.description, 'how this project ships');
    assert.equal(skill?.instructions, 'Run the pipeline.');
  });

  it('rejects a skill with no description, since the catalogue would be useless', () => {
    assert.equal(parseSkill('---\nname: x\n---\nbody', '/x/x/SKILL.md', 'user'), null);
  });

  it('rejects a name that could not be typed or matched safely', () => {
    assert.equal(
      parseSkill('---\nname: Bad Name!\ndescription: d\n---\nb', '/x/y/SKILL.md', 'user'),
      null,
    );
  });

  it('rejects a file with no frontmatter at all', () => {
    assert.equal(parseSkill('just some markdown', '/x/y/SKILL.md', 'user'), null);
  });

  it('survives a UTF-8 BOM, which Windows editors add invisibly', () => {
    const withBom = '﻿---\nname: deploy\ndescription: ships it\n---\n\nbody';
    assert.equal(parseSkill(withBom, '/x/deploy/SKILL.md', 'project')?.name, 'deploy');
  });
});

describe('SkillRegistry', () => {
  let root: string;
  let workspace: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-skills-'));
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-ws-'));

    await writeSkill(path.join(root, 'skills'), {
      name: 'user-thing',
      description: 'a user level skill',
      instructions: 'do the user thing',
    });
    await writeSkill(path.join(workspace, '.plif', 'skills'), {
      name: 'project-thing',
      description: 'a project level skill',
      instructions: 'do the project thing',
    });
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('finds builtin, user and project skills', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const names = registry.list().map((skill) => skill.name);

    for (const builtin of BUILTIN_SKILLS) assert.ok(names.includes(builtin.name));
    assert.ok(names.includes('user-thing'));
    assert.ok(names.includes('project-thing'));
  });

  it('lets a project skill override a user skill of the same name', async () => {
    await writeSkill(path.join(root, 'skills'), {
      name: 'shared',
      description: 'user version',
      instructions: 'user body',
    });
    await writeSkill(path.join(workspace, '.plif', 'skills'), {
      name: 'shared',
      description: 'project version',
      instructions: 'project body',
    });

    const registry = await SkillRegistry.load({ workspace, root });
    assert.equal(registry.get('shared')?.scope, 'project');
    assert.equal(registry.get('shared')?.instructions, 'project body');
  });

  it('puts only names and descriptions in the catalogue, never the bodies', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const catalogue = registry.catalogue();

    assert.match(catalogue, /user-thing: a user level skill/);
    assert.equal(catalogue.includes('do the user thing'), false);
  });

  it('returns the full instructions when the skill tool is called', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const result = await skillTool(registry).run({ name: 'project-thing' }, context);

    assert.equal(result.ok, true);
    assert.match(result.output, /do the project thing/);
  });

  it('lists what exists when asked for a skill that does not', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const result = await skillTool(registry).run({ name: 'nope' }, context);

    assert.equal(result.ok, false);
    assert.match(result.output, /Available:/);
  });

  it('refuses to write a skill whose name could not be resolved', async () => {
    await assert.rejects(() =>
      writeSkill(root, { name: '../escape', description: 'd', instructions: 'i' }),
    );
  });
});

describe('parseServerConfigs', () => {
  it('reads stdio and http servers', () => {
    const parsed = parseServerConfigs({
      local: { command: 'node', args: ['server.js'] },
      remote: { url: 'https://example.test/mcp', headers: { authorization: 'Bearer x' } },
    });

    assert.deepEqual(parsed['local'], { command: 'node', args: ['server.js'] });
    assert.equal((parsed['remote'] as { url: string }).url, 'https://example.test/mcp');
  });

  it('skips entries with neither a command nor a url', () => {
    const parsed = parseServerConfigs({ broken: { nonsense: true }, ok: { command: 'x' } });

    assert.equal(parsed['broken'], undefined);
    assert.ok(parsed['ok']);
  });

  it('preserves an explicit disable', () => {
    const parsed = parseServerConfigs({ off: { command: 'x', enabled: false } });
    assert.equal(parsed['off']?.enabled, false);
  });

  it('expands environment references in stdio and HTTP fields', () => {
    const parsed = parseServerConfigs(
      {
        remote: {
          url: 'https://${PLIF_OAUTH_HOST}/mcp',
          headers: { Authorization: 'Bearer ${PLIF_TOKEN}' },
        },
        local: {
          command: '${PLIF_NODE}',
          args: ['${PLIF_ARG}'],
          cwd: '${PLIF_CWD}',
          env: { CHILD_TOKEN: '${PLIF_TOKEN}' },
        },
      },
      {
        PLIF_OAUTH_HOST: 'mcp.example.test',
        PLIF_TOKEN: 'test-token',
        PLIF_NODE: 'node',
        PLIF_ARG: 'server.mjs',
        PLIF_CWD: 'C:/work',
      },
    );

    const remote = parsed['remote'] as { url: string; headers?: Record<string, string> };
    const local = parsed['local'] as {
      command: string;
      args?: readonly string[];
      cwd?: string;
      env?: Readonly<Record<string, string>>;
    };
    assert.equal(remote.url, 'https://mcp.example.test/mcp');
    assert.equal(remote.headers?.['Authorization'], 'Bearer test-token');
    assert.equal(local.command, 'node');
    assert.deepEqual(local.args, ['server.mjs']);
    assert.equal(local.cwd, 'C:/work');
    assert.equal(local.env?.['CHILD_TOKEN'], 'test-token');
  });

  it('rejects a missing environment reference without exposing other values', () => {
    assert.throws(
      () =>
        parseServerConfigs(
          { remote: { url: 'https://example.test/${MISSING}' } },
          { PRESENT: 'do-not-print-this' },
        ),
      (error: unknown) => {
        assert.match(String(error), /MISSING/);
        assert.doesNotMatch(String(error), /do-not-print-this/);
        return true;
      },
    );
  });

  it('honours the shell-style default the official catalogue writes', () => {
    // context7 ships `"Authorization": "${CONTEXT7_API_KEY:-}"`. Without this
    // the literal braces were sent as the header value.
    const parsed = parseServerConfigs(
      {
        c7: {
          url: 'https://mcp.context7.test/mcp',
          headers: { Authorization: '${C7_KEY:-}', Extra: '${C7_MODE:-fast}' },
        },
      },
      {},
    );

    const headers = (parsed['c7'] as { headers?: Record<string, string> }).headers;
    assert.equal(headers?.['Extra'], 'fast');
  });

  it('sends no header at all rather than an empty credential', () => {
    // `${KEY:-}` asks for the header to be omitted when the key is unset. An
    // empty Authorization is not the same request as no Authorization.
    const parsed = parseServerConfigs(
      { c7: { url: 'https://x.test/mcp', headers: { Authorization: '${C7_KEY:-}' } } },
      {},
    ) as Record<string, { headers?: Record<string, string>; unsetVariables?: readonly string[] }>;

    assert.equal(parsed['c7']?.headers, undefined);
    assert.deepEqual(parsed['c7']?.unsetVariables, ['C7_KEY']);
  });

  it('drops a bearer header whose key is missing, not just an empty one', () => {
    // "Bearer ${KEY:-}" expands to "Bearer " — non-empty, and not a credential.
    const parsed = parseServerConfigs(
      { s: { url: 'https://x.test/mcp', headers: { Authorization: 'Bearer ${S_KEY:-}' } } },
      {},
    ) as Record<string, { headers?: Record<string, string>; unsetVariables?: readonly string[] }>;

    assert.equal(parsed['s']?.headers, undefined);
    assert.deepEqual(parsed['s']?.unsetVariables, ['S_KEY']);
  });

  it('does not treat a real default as a missing credential', () => {
    const parsed = parseServerConfigs(
      { s: { url: 'https://x.test/mcp', headers: { Accept: '${S_MODE:-application/json}' } } },
      {},
    ) as Record<string, { headers?: Record<string, string>; unsetVariables?: readonly string[] }>;

    assert.deepEqual(parsed['s']?.headers, { Accept: 'application/json' });
    assert.equal(parsed['s']?.unsetVariables, undefined);
  });

  it('keeps the other headers when only one of them is empty', () => {
    const parsed = parseServerConfigs(
      {
        c7: {
          url: 'https://x.test/mcp',
          headers: { Authorization: '${C7_KEY:-}', Accept: 'application/json' },
        },
      },
      {},
    ) as Record<string, { headers?: Record<string, string>; unsetVariables?: readonly string[] }>;

    assert.deepEqual(parsed['c7']?.headers, { Accept: 'application/json' });
    assert.deepEqual(parsed['c7']?.unsetVariables, ['C7_KEY']);
  });

  it('reports nothing unset once the variable is there', () => {
    const parsed = parseServerConfigs(
      { c7: { url: 'https://x.test/mcp', headers: { Authorization: '${C7_KEY:-}' } } },
      { C7_KEY: 'Bearer real' },
    ) as Record<string, { headers?: Record<string, string>; unsetVariables?: readonly string[] }>;

    assert.deepEqual(parsed['c7']?.headers, { Authorization: 'Bearer real' });
    assert.equal(parsed['c7']?.unsetVariables, undefined);
  });

  it('prefers the real value over the default when the variable is set', () => {
    const parsed = parseServerConfigs(
      { c7: { url: 'https://x.test/mcp', headers: { Authorization: '${C7_KEY:-}' } } },
      { C7_KEY: 'Bearer real' },
    );

    const headers = (parsed['c7'] as { headers?: Record<string, string> }).headers;
    assert.equal(headers?.['Authorization'], 'Bearer real');
  });

  it('still rejects a bare reference that names nothing', () => {
    assert.throws(
      () => parseServerConfigs({ x: { url: 'https://x.test/${NOPE}' } }, {}),
      /NOPE/,
    );
  });

  it('keeps the oauth block and expands it like any other field', () => {
    const parsed = parseServerConfigs(
      {
        remote: {
          url: 'https://example.test/mcp',
          oauth: { scope: '${PLIF_SCOPE}', clientMetadataUrl: 'https://example.test/client.json' },
        },
      },
      { PLIF_SCOPE: 'repo read:user' },
    );

    const remote = parsed['remote'] as {
      oauth?: { scope?: string; clientMetadataUrl?: string };
    };
    assert.equal(remote.oauth?.scope, 'repo read:user');
    assert.equal(remote.oauth?.clientMetadataUrl, 'https://example.test/client.json');
  });

  it('adds no oauth block to a server that did not ask for one', () => {
    const parsed = parseServerConfigs({ remote: { url: 'https://example.test/mcp' } });
    assert.equal('oauth' in (parsed['remote'] as object), false);
  });

  it('namespaces tools so two servers cannot collide', () => {
    assert.equal(qualifiedToolName('github', 'search'), 'mcp__github__search');
    assert.notEqual(qualifiedToolName('a', 'x'), qualifiedToolName('b', 'x'));
  });
});

describe('system prompt', () => {
  const base = {
    workspace: 'C:/proj',
    containerName: 'calm-cedar',
    workdir: '/workspace',
    capabilities: DEFAULT_CAPABILITIES,
    isolation: 'job',
  };

  it('states who the agent is, where it is, and what it may not do', () => {
    const prompt = buildSystemPrompt(base);

    assert.match(prompt, /You are plif/);
    assert.match(prompt, /calm-cedar/);
    assert.match(prompt, /job isolation/);
    assert.match(prompt, /the current project is \/workspace/);
    assert.match(prompt, /You may not:.*host/s);
  });

  it('names the operating system so the agent never probes for it', () => {
    const prompt = buildSystemPrompt(base);

    assert.match(prompt, /The machine and the shell/);
    assert.match(prompt, new RegExp(`operating system:.*${process.platform}`));
    assert.match(prompt, /no shell between you and/);
  });

  it('separates the two path spaces, which is what run_command gets wrong', () => {
    // Container paths are for the file tools. run_command launches a real
    // program already inside the working directory, and handing it /workspace
    // gets "No such file or directory" — a wasted turn every time.
    const prompt = buildSystemPrompt(base);

    assert.match(prompt, /the lsp tools take container paths/);
    // The file tools are named individually, so a tool added later without
    // being listed here is caught rather than silently inheriting the wrong
    // path space.
    for (const tool of ['read_file', 'write_file', 'edit_file', 'list_dir']) {
      assert.match(prompt, new RegExp(`${tool}[^\\n]*container paths`));
    }
    assert.match(prompt, /run_command does not/);
    assert.match(prompt, /\["ls","-la","src"\]/);
  });

  it('bans emoji up front, where a profile cannot outrank it', () => {
    // Placement is the whole point, and it was learned the hard way: with the
    // rule only at the very end, a "be warm and animated" profile — which sits
    // near the top — won, and the model answered with two emoji. The rule has
    // to be in the identity block and has to say that it beats the profile.
    const prompt = buildSystemPrompt({
      ...base,
      profile: { name: 'entusiasta', systemPrompt: 'Seja caloroso, animado e divertido.' },
    });

    const identity = prompt.slice(0, prompt.indexOf('Seja caloroso'));
    assert.match(identity, /never write an emoji/i);
    assert.match(prompt, /never authorises an emoji/i);
  });

  it('contains no emoji itself', () => {
    // An instruction not to use emoji, illustrated with one, is an instruction
    // the model will average out.
    const prompt = buildSystemPrompt(base);
    const found = [...prompt].filter((character) => /\p{Extended_Pictographic}/u.test(character));
    assert.deepEqual(found, []);
  });

  it('lists an interpreter that exists rather than one it assumes', () => {
    const report = detectShell();
    const prompt = buildSystemPrompt(base);

    if (report.interpreters.length > 0) {
      assert.match(prompt, new RegExp(`interpreters on PATH: ${report.interpreters[0]}`));
    }
    // The empty-PATH container gets the opposite advice, and must not be told
    // about interpreters it cannot resolve by name.
    const inert = buildSystemPrompt({
      ...base,
      capabilities: { ...DEFAULT_CAPABILITIES, envRead: false },
    });
    assert.match(inert, /this container has no PATH/);
    assert.doesNotMatch(inert, /interpreters on PATH/);
  });

  it('enumerates the tools it actually has', () => {
    const prompt = buildSystemPrompt({
      ...base,
      tools: [
        { name: 'read_file', description: 'Read a file. More detail here.', parameters: {} },
        { name: 'mcp__github__search', description: 'Search GitHub.', parameters: {} },
      ],
    });

    assert.match(prompt, /- read_file: Read a file\./);
    assert.match(prompt, /From connected MCP servers/);
    assert.match(prompt, /mcp__github__search/);
  });

  it('describes skills without inlining their instructions', () => {
    const prompt = buildSystemPrompt({ ...base, skills: '- deploy: how this project ships' });

    assert.match(prompt, /Skills available/);
    assert.match(prompt, /skill\(name\)/);
  });

  it('warns that MCP tools sit outside the sandbox', () => {
    const prompt = buildSystemPrompt({ ...base, mcpServers: '- github (http): 4 tools' });

    assert.match(prompt, /outside your\ncontainer/);
    assert.match(prompt, /untrusted input/);
  });

  it('tells the agent not to route around a refusal', () => {
    const prompt = buildSystemPrompt({ ...base, sandboxGaps: ['fs writes are not blocked'] });
    assert.match(prompt, /refusal is the/);
  });

  it('omits every optional section when there is nothing to say', () => {
    const prompt = buildSystemPrompt(base);

    assert.equal(prompt.includes('Skills available'), false);
    assert.equal(prompt.includes('Connected MCP servers'), false);
    assert.equal(prompt.includes('previous sessions'), false);
  });
});
