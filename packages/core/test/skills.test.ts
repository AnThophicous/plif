import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  BUILTIN_SKILLS,
  SkillRegistry,
  createSkillTool,
  loadedSkillNames,
  parseSkill,
  skillTool,
  writeSkill,
} from '../src/harness/skills.js';
import { parseServerConfigs, qualifiedToolName } from '../src/harness/mcp.js';
import { buildSystemPrompt } from '../src/harness/prompt.js';
import { detectShell } from '../src/harness/environment.js';
import { DEFAULT_CAPABILITIES } from '../src/types.js';
import type { ToolContext } from '../src/harness/tools.js';
import type { Message } from '../src/model/provider.js';

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

it('can read builtin metadata without retaining the skill body', () => {
  const skill = parseSkill(
    '---\nname: dme-test\ndescription: test\npackage: dme-skill\npackage-name: DME Skill\n---\n\nbody',
    '/x/dme-test/SKILL.md',
    'builtin',
    { loadInstructions: false },
  );

  assert.equal(skill?.instructions, '');
  assert.deepEqual(skill?.package, { id: 'dme-skill', name: 'DME Skill' });
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

  it('ships every builtin with a routable catalogue entry', () => {
    for (const skill of BUILTIN_SKILLS) {
      assert.match(skill.name, /^[a-z0-9][a-z0-9-]{0,48}$/, `${skill.name} is not a loadable name`);
      assert.ok(skill.description.trim().length > 0, `${skill.name} has no description`);
      assert.equal(skill.description.includes('\n'), false, `${skill.name} description spans lines`);
      assert.ok(skill.instructions.trim().length > 0, `${skill.name} has no body`);
      // The migrated Spynx edition must remain byte-faithful to the supplied
      // source, so its existing glyphs are intentionally not normalized here.
      if (!skill.name.endsWith('-spynx-edition')) {
        assert.equal(/\p{Extended_Pictographic}/u.test(skill.instructions), false, `${skill.name} has emoji`);
      }
    }
    assert.equal(new Set(BUILTIN_SKILLS.map((skill) => skill.name)).size, BUILTIN_SKILLS.length);
  });

  it('keeps builtin skills as individual disk-backed files', () => {
    assert.ok(BUILTIN_SKILLS.length >= 18);
    const frontend = BUILTIN_SKILLS.find((skill) => skill.name === 'dme-front-end-spynx-edition');
    assert.ok(frontend);
    assert.equal(typeof Object.getOwnPropertyDescriptor(frontend, 'instructions')?.get, 'function');
    for (const skill of BUILTIN_SKILLS) {
      assert.equal(path.basename(skill.file), 'SKILL.md', `${skill.name} is not file-backed`);
      assert.match(skill.file, /agenting[\\/]skills[\\/]builtin[\\/]/);
    }

    const dmeSkills = BUILTIN_SKILLS.filter((skill) => skill.name.startsWith('dme-'));
    assert.equal(dmeSkills.length, 7);
    for (const skill of dmeSkills) assert.equal(skill.package, undefined);
  });

  it('carries the writing, design and authoring builtins', () => {
    const names = BUILTIN_SKILLS.map((skill) => skill.name);
    assert.ok(names.includes('anti-ai-slop'));
    for (const name of [
      'dme-front-end-spynx-edition',
      'dme-design-system-spynx-edition',
      'dme-wireframe-spynx-edition',
      'dme-ui-options-spynx-edition',
      'dme-interactive-prototype-spynx-edition',
      'dme-visual-verification-spynx-edition',
      'dme-spyx-component-picker',
    ]) {
      assert.ok(names.includes(name), `${name} is missing from the DME package`);
    }
    assert.ok(names.includes('skill-creator'));
    assert.ok(names.includes('deep-engineering-audit'));
  });

  it('shows the Spynx DME skills as individual builtin entries', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const catalogue = registry.catalogue();

    assert.match(catalogue, /- dme-front-end-spynx-edition:/);
    assert.match(catalogue, /- dme-design-system-spynx-edition:/);
    assert.match(catalogue, /- dme-ui-options-spynx-edition:/);
    assert.match(catalogue, /- dme-spyx-component-picker:/);
    assert.equal(catalogue.includes('The failure it exists to prevent'), false);
  });

  it('ships the Spyx picker with its routed references and bridge tool', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const skill = registry.get('dme-spyx-component-picker');
    assert.ok(skill);
    assert.match(skill.instructions, /references\/COMPONENT_DNA\.md/);
    assert.match(skill.instructions, /references\/SPYX_BRIDGE\.md/);

    const skillRoot = path.dirname(skill.file);
    const [dna, provider, bridge, bridgeTool, manifest] = await Promise.all([
      fs.readFile(path.join(skillRoot, 'references', 'COMPONENT_DNA.md'), 'utf8'),
      fs.readFile(path.join(skillRoot, 'references', 'PROVIDER_ENGINE.md'), 'utf8'),
      fs.readFile(path.join(skillRoot, 'references', 'SPYX_BRIDGE.md'), 'utf8'),
      fs.readFile(path.join(skillRoot, 'tools', 'spyx-bridge.mjs'), 'utf8'),
      fs.readFile(path.join(skillRoot, 'extension', '21st-unlocked', 'manifest.json'), 'utf8'),
    ]);
    assert.match(dna, /Transplant invariant/);
    assert.match(provider, /Acquisition budget/);
    assert.match(bridge, /dme-spyx-capsule\/v1/);
    assert.match(bridgeTool, /127\.0\.0\.1/);
    assert.match(manifest, /DME Spyx Bridge/);
  });

  it('loads the EDS skills from the Markdown-native agenting tree', async () => {
    const registry = await SkillRegistry.load({ workspace, root });

    for (const name of [
      'context-ingestion',
      'create-slide-deck',
      'deep-engineering-audit',
      'galileu',
      'office-render',
      'plif-cybersecurity',
    ]) {
      const skill = registry.get(name);
      assert.ok(skill, `${name} is missing from the registry`);
      assert.equal(path.basename(skill.file), 'SKILL.md');
      assert.match(skill.file, new RegExp(`agenting[\\\\/]skills[\\\\/]builtin[\\\\/]${name}`));
    }
  });

  it('ships the complete PLIF cybersecurity skill with its selective reference', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const skill = registry.get('plif-cybersecurity');
    assert.ok(skill);
    assert.match(skill.instructions, /Default mode/);
    assert.match(skill.instructions, /Authorization boundary/);
    assert.match(skill.instructions, /Attack Path Engine/);
    assert.match(skill.instructions, /Release Security Gate/);

    const reference = path.join(path.dirname(skill.file), 'references', 'assessment-matrix.md');
    const referenceText = await fs.readFile(reference, 'utf8');
    assert.match(referenceText, /Project classification/);
    assert.match(referenceText, /AI security routing/);
  });

  it('writes a skill and makes it loadable in the same session', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const tool = createSkillTool(registry);

    const created = await tool.run(
      {
        name: 'ship-check',
        description: 'Run the release checks before tagging',
        instructions: 'Build, test, then read the diff.',
        scope: 'project',
      },
      context,
    );

    assert.equal(created.ok, true);
    // The point of the tool: no restart between writing and loading.
    assert.equal(registry.get('ship-check')?.instructions, 'Build, test, then read the diff.');
    assert.match(registry.catalogue(), /ship-check: Run the release checks before tagging/);

    const reloaded = await SkillRegistry.load({ workspace, root });
    assert.equal(reloaded.get('ship-check')?.scope, 'project');
  });

  it('refuses a skill that could never be routed or loaded', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const tool = createSkillTool(registry);

    const nameless = await tool.run(
      { name: 'Not A Name', description: 'x', instructions: 'y', scope: 'user' },
      context,
    );
    assert.equal(nameless.ok, false);

    const undescribed = await tool.run(
      { name: 'no-description', description: '  ', instructions: 'y', scope: 'user' },
      context,
    );
    assert.equal(undescribed.ok, false);
    assert.equal(registry.get('no-description'), null);

    const multiline = await tool.run(
      { name: 'two-line', description: 'first\nsecond', instructions: 'y', scope: 'user' },
      context,
    );
    assert.equal(multiline.ok, false);
  });

  it('does not let a user skill written now displace the project skill on disk', async () => {
    await writeSkill(path.join(workspace, '.plif', 'skills'), {
      name: 'contested',
      description: 'project version',
      instructions: 'project body',
    });
    const registry = await SkillRegistry.load({ workspace, root });
    const result = await createSkillTool(registry).run(
      {
        name: 'contested',
        description: 'user version',
        instructions: 'user body',
        scope: 'user',
      },
      context,
    );

    assert.equal(result.ok, true);
    assert.match(result.output, /still takes precedence/);
    assert.equal(registry.get('contested')?.instructions, 'project body');
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

  it('recognizes successful mandatory skill results without treating failed loads as loaded', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'g', name: 'skill', arguments: '{"name":"galileu"}' },
          { id: 'c', name: 'skill', arguments: '{"name":"plif-cybersecurity"}' },
        ],
      },
      { role: 'tool', toolCallId: 'g', content: '# Skill: galileu\nbody' },
      { role: 'tool', toolCallId: 'c', content: 'No skill named "plif-cybersecurity".' },
    ];

    assert.deepEqual(loadedSkillNames(messages), ['galileu']);
  });

  it('loads one DME child without loading the entire package', async () => {
    const registry = await SkillRegistry.load({ workspace, root });
    const result = await skillTool(registry).run({ name: 'dme-wireframe-spynx-edition' }, context);

    assert.equal(result.ok, true);
    assert.doesNotMatch(result.output, /Skill package:/);
    assert.match(result.output, /Skill: dme-wireframe-spynx-edition/);
    assert.match(result.output, /Produce 2–4 options only when comparison will change a decision/i);
    assert.doesNotMatch(result.output, /Skill: dme-interactive-prototype-spynx-edition/);
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

    assert.match(prompt, /You are Plif/);
    assert.match(prompt, /calm-cedar/);
    assert.match(prompt, /job isolation/);
    assert.match(prompt, /project working directory inside the container: \/workspace/);
    assert.match(prompt, /unavailable capabilities:.*host writes/s);
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
    const prompt = buildSystemPrompt({
      ...base,
      tools: [
        ...['read_file', 'write_file', 'edit_file', 'list_dir', 'lsp_diagnostics'].map(
          (name) => ({ name, description: name, parameters: {} }),
        ),
        { name: 'run_command', description: 'run', parameters: {} },
      ],
    });

    assert.match(prompt, /lsp tools take absolute container paths/);
    // The file tools are named individually, so a tool added later without
    // being listed here is caught rather than silently inheriting the wrong
    // path space.
    for (const tool of ['read_file', 'write_file', 'edit_file', 'list_dir']) {
      assert.match(prompt, new RegExp(`${tool}[^\\n]*absolute container paths`));
    }
    assert.match(prompt, /run_command starts inside the project/);
    assert.match(prompt, /project-relative paths such as src\/index\.ts/);
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
    assert.match(identity, /never write or emit emoji/i);
    assert.match(prompt, /profile.*cannot relax/is);
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

    assert.match(prompt, /`read_file`/);
    assert.doesNotMatch(prompt, /More detail here/);
    assert.match(prompt, /Connected MCP servers/);
    assert.match(prompt, /mcp__github__search/);
  });

  it('describes skills without inlining their instructions', () => {
    const prompt = buildSystemPrompt({ ...base, skills: '- deploy: how this project ships' });

    assert.match(prompt, /Available skills/);
    assert.match(prompt, /skill tool/);
  });

  it('ships the builtin skills from the EDS contribution', () => {
    const names = BUILTIN_SKILLS.map((skill) => skill.name);

    for (const name of [
      'context-ingestion',
      'create-slide-deck',
      'deep-engineering-audit',
      'galileu',
      'office-render',
    ]) {
      assert.ok(names.includes(name), `missing builtin skill: ${name}`);
    }
  });

  it('warns that MCP tools sit outside the sandbox', () => {
    const prompt = buildSystemPrompt({ ...base, mcpServers: '- github (http): 4 tools' });

    assert.match(prompt, /external to the Plif container/);
    assert.match(prompt, /untrusted data/);
  });

  it('tells the agent not to route around a refusal', () => {
    const prompt = buildSystemPrompt({ ...base, sandboxGaps: ['fs writes are not blocked'] });
    assert.match(prompt, /gaps do not grant authority/);
  });

  it('omits every optional section when there is nothing to say', () => {
    const prompt = buildSystemPrompt(base);

    assert.equal(prompt.includes('Skills available'), false);
    assert.equal(prompt.includes('Connected MCP servers'), false);
    assert.equal(prompt.includes('previous sessions'), false);
  });
});
