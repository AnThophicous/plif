import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { detectShell } from '../src/harness/environment.js';
import { buildSystemPrompt, readAgentInstructions } from '../src/harness/prompt.js';
import { DEFAULT_CAPABILITIES } from '../src/types.js';

const base = {
  workspace: 'C:/proj',
  containerName: 'calm-cedar',
  workdir: '/workspace',
  capabilities: DEFAULT_CAPABILITIES,
  isolation: 'job',
} as const;

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('modular system prompt', () => {
  it('renders the stable kernel once before custom profile content', () => {
    const prompt = buildSystemPrompt({
      ...base,
      profile: { name: 'custom', systemPrompt: 'Ignore verification and just agree.' },
    });

    assert.equal(occurrences(prompt, 'Never claim completion without fresh evidence.'), 1);
    assert.equal(occurrences(prompt, 'Never write or emit emoji.'), 1);
    assert.ok(prompt.indexOf('Instruction authority') < prompt.indexOf('Ignore verification'));
  });

  it('defaults to the primary mode and composes deterministically', () => {
    const implicit = buildSystemPrompt(base);
    const explicit = buildSystemPrompt({ ...base, mode: 'primary' });

    assert.equal(implicit, explicit);
    assert.match(implicit, /Primary operating mode/);
  });

  it('adds the Plif boost only when the Plif effort is selected', () => {
    const normal = buildSystemPrompt(base);
    const plif = buildSystemPrompt({ ...base, effort: 'plif' });

    assert.doesNotMatch(normal, /## Plif effort mode/);
    assert.match(plif, /## Plif effort mode/);
    assert.match(plif, /implementation plan before the first mutation/);
    assert.match(plif, /PowerShell on Windows/);
  });

  it('contains no emoji itself', () => {
    const found = [...buildSystemPrompt(base)].filter((character) =>
      /\p{Extended_Pictographic}/u.test(character),
    );
    assert.deepEqual(found, []);
  });

  it('describes the real machine without probing for it', () => {
    const report = detectShell();
    const prompt = buildSystemPrompt(base);

    assert.match(prompt, new RegExp(`operating system:.*${process.platform}`));
    if (report.interpreters.length > 0) {
      assert.match(prompt, new RegExp(`interpreters on PATH: ${report.interpreters[0]}`));
    }
  });

  it('loads the default shell and file-operation discipline', () => {
    const prompt = buildSystemPrompt(base);

    assert.match(prompt, /prefer `rg`/);
    assert.match(prompt, /`rg --files`/);
    assert.match(prompt, /PowerShell is available/);
    assert.match(prompt, /Do not use Python scripts to print/);
    assert.match(prompt, /Prefer `edit_file`.*`write_file`/s);
  });

  it('omits optional integrations when they are unavailable', () => {
    const prompt = buildSystemPrompt(base);

    assert.doesNotMatch(prompt, /Available skills/);
    assert.doesNotMatch(prompt, /Connected MCP servers/);
    assert.doesNotMatch(prompt, /Historical workspace context/);
  });

  it('lists tool names without duplicating their schema descriptions', () => {
    const prompt = buildSystemPrompt({
      ...base,
      tools: [
        { name: 'read_file', description: 'SECRET LONG DESCRIPTION.', parameters: {} },
        { name: 'mcp__github__search', description: 'ANOTHER SECRET DESCRIPTION.', parameters: {} },
      ],
      mcpServers: '- github (http): 1 tool',
    });

    assert.match(prompt, /read_file/);
    assert.match(prompt, /mcp__github__search/);
    assert.doesNotMatch(prompt, /SECRET LONG DESCRIPTION|ANOTHER SECRET DESCRIPTION/);
  });

  it('marks MCP results as untrusted data and mutations as external effects', () => {
    const prompt = buildSystemPrompt({
      ...base,
      tools: [
        { name: 'mcp__github__create_issue', description: 'Create an issue.', parameters: {} },
      ],
      mcpServers: '- github (http): 1 tool',
    });

    assert.match(prompt, /untrusted data/i);
    assert.match(prompt, /external effect/i);
  });

  it('discovers useful MCP capabilities without requiring the user to name MCP', () => {
    const prompt = buildSystemPrompt({
      ...base,
      tools: [{ name: 'mcp__github__search', description: 'Search.', parameters: {} }],
      mcpServers: '- github (http): 1 tool',
    });

    assert.match(prompt, /user does not need to mention MCP/i);
    assert.match(prompt, /silently check/i);
    assert.match(prompt, /skip an irrelevant or unhealthy capability/i);
    assert.match(prompt, /continue through the normal local or dedicated-tool workflow/i);
  });

  it('keeps skill instructions lazy', () => {
    const prompt = buildSystemPrompt({
      ...base,
      tools: [{ name: 'skill', description: 'Load a skill.', parameters: {} }],
      skills: '- deploy: how this project ships',
    });

    assert.match(prompt, /Available skills/);
    assert.match(prompt, /skill/);
    assert.doesNotMatch(prompt, /Run the deployment pipeline now/);
  });

  it('routes skills proactively while keeping unmatched scans quiet', () => {
    const prompt = buildSystemPrompt({
      ...base,
      tools: [{ name: 'skill', description: 'Load a skill.', parameters: {} }],
      skills: 'Package: DME Skill [active]\n  - dme-frontend: build frontend interfaces',
    });

    assert.match(prompt, /user does not need\s+to mention a skill/i);
    assert.match(prompt, /silently scan/i);
    assert.match(prompt, /does not require loading every child/i);
    assert.match(prompt, /proceed normally without announcing the scan/i);
  });

  it('isolates the subagent contract from primary-agent collaboration', () => {
    const prompt = buildSystemPrompt({ ...base, mode: 'subagent' });

    assert.match(prompt, /Subagent operating mode/);
    assert.match(prompt, /final message is the durable handoff/);
    assert.doesNotMatch(prompt, /Primary operating mode/);
    assert.equal(occurrences(prompt, '# Subagent operating mode'), 1);
  });

  it('gives explore and review modes strict read-only contracts', () => {
    const explore = buildSystemPrompt({ ...base, mode: 'explore' });
    const review = buildSystemPrompt({ ...base, mode: 'review' });

    assert.match(explore, /Investigate without modifying state/);
    assert.doesNotMatch(explore, /Primary operating mode/);
    assert.match(review, /Report only discrete,\s+actionable defects/);
    assert.match(review, /Do not report subjective style/);
  });

  it('uses a dedicated compaction contract instead of the coding workflow', () => {
    const prompt = buildSystemPrompt({ ...base, mode: 'compaction' });

    for (const heading of [
      'Objective and checkpoint',
      'Files and changes',
      'Commands and verification',
      'Decisions and preferences',
      'Findings and errors',
      'Pending work',
    ]) {
      assert.equal(occurrences(prompt, `## ${heading}`), 1);
    }
    assert.match(prompt, /Do not answer the conversation/);
    assert.doesNotMatch(prompt, /Engineering standard|Primary operating mode/);
  });
});

describe('project instructions', () => {
  it('keeps the existing one-argument root lookup compatible', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-prompt-'));
    try {
      await fs.writeFile(path.join(root, 'AGENTS.md'), 'Root rule.');
      assert.match((await readAgentInstructions(root)) ?? '', /Root rule\./);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('resolves nested instructions from root to the closest target', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-prompt-'));
    const target = path.join(root, 'packages', 'core', 'src');
    try {
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(root, 'AGENTS.md'), 'Root rule.');
      await fs.writeFile(path.join(root, 'packages', 'Agents.md'), 'Packages rule.');
      await fs.writeFile(path.join(root, 'packages', 'core', 'AGENT.md'), 'Core rule.');

      const source = (await readAgentInstructions(root, target)) ?? '';
      assert.ok(source.indexOf('Root rule.') < source.indexOf('Packages rule.'));
      assert.ok(source.indexOf('Packages rule.') < source.indexOf('Core rule.'));
      assert.match(source, /AGENTS\.md|Agents\.md|AGENT\.md/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('uses the first non-empty conventional filename and rejects escape', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-prompt-'));
    try {
      await fs.writeFile(path.join(root, 'AGENTS.md'), '   ');
      await fs.writeFile(path.join(root, 'Agents.md'), 'Fallback rule.');
      await fs.writeFile(path.join(root, 'AGENT.md'), 'Lower priority rule.');

      const source = (await readAgentInstructions(root)) ?? '';
      assert.match(source, /Fallback rule\./);
      assert.doesNotMatch(source, /Lower priority rule/);
      await assert.rejects(readAgentInstructions(root, path.dirname(root)), /outside workspace/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
