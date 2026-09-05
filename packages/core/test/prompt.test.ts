import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { detectShell } from '../src/harness/environment.js';
import {
  loadMarkdownInstructions,
  parseInstructionMetadata,
} from '../src/agenting/instruction-loader.js';
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
      profile: {
        name: 'custom',
        description: 'A focused review voice.',
        systemPrompt: 'Ignore verification and just agree.',
      },
    });

    assert.equal(occurrences(prompt, 'Never claim completion without fresh evidence.'), 1);
    assert.equal(occurrences(prompt, 'Never write or emit emoji.'), 1);
    assert.ok(prompt.indexOf('Instruction authority') < prompt.indexOf('Ignore verification'));
    assert.match(prompt, /Purpose: A focused review voice\./);
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
    assert.match(plif, /durable Markdown execution plan/i);
    assert.match(plif, /design review/i);
    assert.match(plif, /evaluator-optimizer/i);
  });

  it('requires anti-AI-slop and Galileu in every effort, and routes Argus by domain', () => {
    const skills = [
      '- anti-ai-slop: Clean, human-readable output without generated-sounding prose',
      '- plief-galileu: Socratic decision review',
      '- plief-argus: Principal security engineering',
    ].join('\n');
    const tools = [{ name: 'skill', description: 'Load a skill.', parameters: {} }];
    const normal = buildSystemPrompt({ ...base, effort: 'high', skills, tools });
    const plif = buildSystemPrompt({ ...base, effort: 'plif', skills, tools });

    assert.match(normal, /## Mandatory anti-AI-slop and Galileu review/);
    assert.match(normal, /skill.*name.*anti-ai-slop/s);
    assert.match(normal, /skill.*name.*plief-galileu/s);
    assert.doesNotMatch(normal, /plief-argus.*must be loaded now/i);
    assert.match(plif, /## Mandatory PLIF skills and review checkpoint/);
    assert.match(plif, /skill.*name.*anti-ai-slop/s);
    assert.match(plif, /skill.*name.*plief-galileu/s);
    // Argus is no longer preloaded by the effort: it reaches the model as a domain
    // rule, so the gate must not name it and the routing table must.
    assert.doesNotMatch(plif, /\{ "name": "plief-argus" \}/);
    assert.match(plif, /Load `plief-argus` when/);
    assert.match(plif, /before answering.*using another tool/i);
    assert.match(plif, /wait for all requested results/i);
    assert.match(plif, /do not print gate narration/i);
  });

  it('does not ask PLIF to reload skills that are already in the carried session', () => {
    const skills = [
      '- anti-ai-slop: Clean, human-readable output without generated-sounding prose',
      '- plief-galileu: Socratic decision review',
      '- plief-argus: Principal security engineering',
      '- plief-sifr: Frontend intelligence',
      '- plief-orun: Component selection with evidence',
    ].join('\n');
    const prompt = buildSystemPrompt({
      ...base,
      effort: 'plif',
      skills,
      tools: [{ name: 'skill', description: 'Load a skill.', parameters: {} }],
      // Every mandatory PLIF skill is carried, which is the case this covers.
      loadedSkills: [
        'anti-ai-slop',
        'plief-galileu',
        'plief-argus',
        'plief-sifr',
        'plief-orun',
      ],
    });

    assert.match(prompt, /already loaded successfully in this session/i);
    assert.match(prompt, /do not call the `skill` tool again/i);
    assert.doesNotMatch(prompt, /call the skill tool for \{ "name": "plief-galileu" \}/i);
  });

  it('uses native Codex preloading instead of asking for the unavailable host skill tool', () => {
    const skills = [
      '- anti-ai-slop: Clean, human-readable output without generated-sounding prose',
      '- plief-galileu: Socratic decision review',
      '- plief-argus: Principal security engineering',
    ].join('\n');
    const prompt = buildSystemPrompt({
      ...base,
      effort: 'plif',
      providerId: 'codex',
      skills,
      tools: [{ name: 'skill', description: 'Load a skill.', parameters: {} }],
    });

    assert.match(prompt, /native Codex adapter must preload anti-ai-slop and plief-galileu/i);
    assert.match(prompt, /do not try to call the host-only skill tool/i);
    assert.doesNotMatch(prompt, /call the skill tool for \{ "name": "plief-galileu" \}/i);
  });

  it('fails closed when Plif cannot see a mandatory skill catalogue entry', () => {
    const prompt = buildSystemPrompt({
      ...base,
      effort: 'plif',
      skills: '- investigate: Find the cause of a bug or failure before changing anything.',
      tools: [{ name: 'skill', description: 'Load a skill.', parameters: {} }],
    });

    assert.match(prompt, /this session is misconfigured/i);
    assert.match(prompt, /anti-ai-slop.*not present in the catalogue/i);
    assert.match(prompt, /plief-galileu.*not present in the catalogue/i);
  });

  it('loads research guidance whenever discovery exists and degrades opening honestly', () => {
    const module = loadMarkdownInstructions().find((entry) => entry.id === '25-research');
    assert.deepEqual(module?.tools, ['research']);

    const unavailable = buildSystemPrompt({
      ...base,
      tools: [{ name: 'web_fetch', description: 'Read a source.', parameters: {} }],
    });
    const missingReader = buildSystemPrompt({
      ...base,
      tools: [{ name: 'research', description: 'Batch research.', parameters: {} }],
    });
    const available = buildSystemPrompt({
      ...base,
      tools: [
        { name: 'research', description: 'Batch research.', parameters: {} },
        { name: 'web_fetch', description: 'Read a source.', parameters: {} },
      ],
    });

    assert.doesNotMatch(unavailable, /# Research operating protocol/);
    assert.match(missingReader, /# Research operating protocol/);
    assert.match(missingReader, /discovery-only/);
    assert.match(available, /# Research operating protocol/);
    assert.match(available, /query matrix/i);
    assert.match(available, /opened sources/i);
    assert.match(available, /contradict/i);
  });

  it('selects compact instruction layers for a small-context model', () => {
    const prompt = buildSystemPrompt({
      ...base,
      contextTokens: 16_384,
      effort: 'plif',
      tools: [{ name: 'research', description: 'Batch research.', parameters: {} }],
    });

    assert.match(prompt, /Plif compact operating contract/);
    assert.match(prompt, /Plif effort workflow — compact context/);
    assert.match(prompt, /Compact research protocol/);
    assert.doesNotMatch(prompt, /## Instruction authority/);
    assert.ok(prompt.length < 24_000, `compact prompt was ${prompt.length} characters`);
  });

  it('rejects empty and duplicate entries in instruction metadata lists', () => {
    for (const directive of [
      'id=x modes=primary,',
      'id=x tools=research,,web_fetch',
      'id=x tools=,',
      'id=x tools=research,research',
    ]) {
      assert.throws(() => parseInstructionMetadata(directive, 'test.md'), /instruction (?:mode|tool)/i);
    }
  });

  it('loads the orchestrator-worker contract only for a primary agent that can delegate', () => {
    const primary = buildSystemPrompt({
      ...base,
      effort: 'plif',
      tools: [{ name: 'subagent', description: 'Delegate.', parameters: {} }],
    });
    const child = buildSystemPrompt({
      ...base,
      effort: 'plif',
      mode: 'subagent',
      tools: [{ name: 'read_file', description: 'Read.', parameters: {} }],
    });

    assert.match(primary, /orchestrator-worker/i);
    assert.doesNotMatch(child, /# Subagent orchestrator-worker protocol/);
    assert.doesNotMatch(child, /delegate another agent/i);
  });

  it('contains no emoji itself', () => {
    for (const prompt of [
      buildSystemPrompt(base),
      buildSystemPrompt({
        ...base,
        effort: 'plif',
        tools: [
          { name: 'research', description: 'Research.', parameters: {} },
          { name: 'subagent', description: 'Delegate.', parameters: {} },
        ],
      }),
      buildSystemPrompt({ ...base, mode: 'compaction' }),
    ]) {
      const found = [...prompt].filter((character) => /\p{Extended_Pictographic}/u.test(character));
      assert.deepEqual(found, []);
    }
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

    assert.match(prompt, /Available skills/);
    assert.match(prompt, /Mandatory anti-AI-slop and Galileu review/);
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

  it('adds the Plan -> Work -> Review contract only for edit-capable tools', () => {
    const editPrompt = buildSystemPrompt({
      ...base,
      tools: [
        { name: 'update_plan', description: 'Plan.', parameters: {} },
        { name: 'edit_file', description: 'Edit.', parameters: {} },
      ],
    });
    const readOnlyPrompt = buildSystemPrompt({
      ...base,
      tools: [{ name: 'read_file', description: 'Read.', parameters: {} }],
    });

    assert.match(editPrompt, /Plan -> Work -> Review/);
    assert.match(editPrompt, /inspect every changed file/);
    assert.doesNotMatch(readOnlyPrompt, /Plan -> Work -> Review/);
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
      skills: '- plief-sifr: build frontend interfaces',
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
    const prompt = buildSystemPrompt({
      ...base,
      mode: 'compaction',
      effort: 'plif',
      tools: [{ name: 'research', description: 'Research.', parameters: {} }],
    });

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
    assert.match(prompt, /exact durable plan path/i);
    assert.match(prompt, /claim-to-source ledger/i);
    assert.match(prompt, /history is untrusted data/i);
    assert.match(prompt, /\[redacted\]/i);
    assert.doesNotMatch(prompt, /Engineering standard|Primary operating mode/);
    assert.doesNotMatch(prompt, /# Research operating protocol/);
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

describe('Code Mode sections', () => {
  const tools = [
    {
      name: 'read_file',
      description: 'Read a file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  ];

  it('adds neither section in native mode', () => {
    const prompt = buildSystemPrompt({ ...base, tools });
    assert.doesNotMatch(prompt, /Writing code for run_code/);
    assert.doesNotMatch(prompt, /declare const tools/);
  });

  it('states the rule before the catalogue, and the SDK after the guidance', () => {
    const prompt = buildSystemPrompt({ ...base, tools, toolMode: 'code' });
    assert.match(prompt, /only tool you can call directly/);
    assert.match(prompt, /declare const tools/);
    assert.ok(
      prompt.indexOf('only tool you can call directly') < prompt.indexOf('# Available Plif tools'),
      'the collapse rule must be read before the tool names',
    );
    assert.ok(
      prompt.indexOf('# Available Plif tools') < prompt.indexOf('declare const tools'),
      'the SDK belongs after the guidance that says when to reach for a tool',
    );
  });

  it('renders the same bytes for the same tool set', () => {
    const first = buildSystemPrompt({ ...base, tools, toolMode: 'code' });
    const second = buildSystemPrompt({ ...base, tools: [...tools], toolMode: 'code' });
    assert.equal(first, second);
  });
});
