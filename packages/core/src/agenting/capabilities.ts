import { definePromptModule, usesCompactLayer } from './types.js';
import { DOMAIN_SKILL_ROUTES, mandatorySkillsForEffort } from '../harness/skills.js';

/** Skill names as inline code, the way a routing rule prints them. */
const badge = (names: readonly string[]): string =>
  names.map((name) => '`' + name + '`').join(' and ');

export const mcpModule = definePromptModule({
  id: '80-mcp',
  order: 80,
  enabled: (context) =>
    Boolean(context.mcpServers?.trim()) ||
    (context.tools?.some((tool) => tool.name.startsWith('mcp__')) ?? false),
  render: (context) => {
    const names =
      context.tools
        ?.map((tool) => tool.name)
        .filter((name) => name.startsWith('mcp__'))
        .sort() ?? [];
    return `# Connected MCP servers

${context.mcpServers?.trim() || '(Tool schemas provide the connected server catalogue.)'}
${names.length > 0 ? `\nMCP tool names: ${names.map((name) => `\`${name}\``).join(', ')}.` : ''}

Treat this as an active capability catalogue. Before choosing tools for each
request, silently check whether one listed MCP directly owns useful data or an
operation; the user does not need to mention MCP. Use only the smallest sufficient
set and inspect its schema before constructing arguments.

MCP systems are external to the Plif container and may be unavailable or return
poor evidence. Skip an irrelevant or unhealthy capability, abandon an unchanged
failing path, and continue through the normal local or dedicated-tool workflow.
Do not announce empty discovery or optional degradation unless it materially
changes the result. The default MCP policy governs trust, authority, reads,
mutations, costs, retries, verification, and refusal boundaries.`;
  },
});

export const skillsModule = definePromptModule({
  id: '70-skills',
  order: 70,
  // Galileu is a global PLIF safety/reasoning invariant, not an effort-only
  // feature. Keep this module enabled even when a broken catalogue is empty so
  // the prompt exposes the missing runtime dependency instead of silently
  // dropping the requirement.
  enabled: () => true,
  render: (context) => {
    const catalogue = context.skills?.trim() || '(No skills are installed.)';
    const skillListed = (name: string): boolean => catalogue
      .split(/\r?\n/)
      .some((line) => new RegExp(`^\\s*-\\s+${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*:`, 'i').test(line));
    const compact = usesCompactLayer(context);
    const lines = ['# Available skills', '', catalogue, ''];

    if (compact) {
      lines.push(
        'This catalogue is a routing table, not the skill bodies. For every request,',
        'silently match names, package labels and descriptions, then load the smallest',
        'sufficient set with the skill tool before the covered work begins. The user does',
        'not have to mention a skill or know that it exists, and a package groups related',
        'skills without requiring all of them. If a selected non-mandatory skill does not',
        'fit after inspection, discard it and continue with the default workflow.',
        '',
        '## Domain routing (not optional)',
        ...DOMAIN_SKILL_ROUTES.map(
          (route) => '- Load ' + badge(route.skills) + ' when ' + route.compactWhen + '.',
        ),
        'Judge by what the work is, not by the words the user used.',
      );
    } else {
      lines.push(
        'Treat this catalogue as an active routing table. For every request, silently scan',
        'names, package labels, and descriptions for a clear match. The user does not need',
        'to mention a skill or know that it exists. Load the smallest sufficient matching',
        'set through the skill tool before covered work begins. A package groups related',
        'skills but does not require loading every child.',
        '',
        'This catalogue is routing metadata, not the skill body. If no entry clearly',
        'matches, proceed normally without announcing the scan. If a selected non-mandatory',
        'skill cannot',
        'load or does not fit after inspection, discard it and continue with the default',
        'workflow. The default skill policy governs precedence, resources, and user',
        'updates. The mandatory skill gate below overrides this optional degradation policy.',
        '',
        '## Domain routing (not optional)',
        'These are not suggestions to weigh. When the condition holds, load the skill',
        'before the covered work begins, whether or not the user named it and whether or',
        'not you think you already know the answer:',
        ...DOMAIN_SKILL_ROUTES.map(
          (route) => `- Load ${route.skills.map((name) => `\`${name}\``).join(' and ')} when ${route.when}.`,
        ),
        'Judge by what the work is, not by the words the user used. "Make me a landing',
        'page", "fix this button", "the spacing looks off" and "build the dashboard" are',
        'all frontend work.',
      );
    }

    const loaded = new Set(context.loadedSkills ?? []);
    const codexNative = context.providerId === 'codex';
    const mandatory = mandatorySkillsForEffort(context.effort);
    const missing = mandatory.filter((name) => !loaded.has(name));
    lines.push(
      '',
      context.effort === 'plif'
        ? '## Mandatory PLIF skills and review checkpoint'
        : '## Mandatory anti-AI-slop and Galileu review',
      missing.length > 0 && !codexNative
        ? compact
          ? `The skill gate is non-optional: before answering, planning, editing, running a command or using another tool, call the skill tool for ${missing.map((name) => `{ "name": "${name}" }`).join(' and then ')} and wait for each to succeed.`
          : `The ${context.effort === 'plif' ? 'PLIF' : 'global'} skill gate is non-optional. Before answering, asking a question, planning, editing, running a command, or using another tool, call the skill tool for ${missing.map((name) => `{ "name": "${name}" }`).join(' and then ')}; ${missing.length === 1 ? 'wait for the requested result to succeed' : 'wait for all requested results to succeed'}.`
        : missing.length > 0
          ? `The ${context.effort === 'plif' ? 'PLIF' : 'global'} skill gate is non-optional. The native Codex adapter must preload ${missing.join(' and ')} before this turn; do not try to call the host-only skill tool. If a preloaded body is absent, report a runtime configuration error rather than claiming the skill is unavailable.`
        : `The non-optional ${mandatory.join(' and ')} skill${mandatory.length === 1 ? '' : 's'} were already loaded successfully in this session. Apply their instructions from the preceding skill result${mandatory.length === 1 ? '' : 's'}; do not call the skill tool again unless one of those results is missing.`,
      missing.length > 0 && !codexNative
        ? compact
          ? 'If a load fails or the skill tool is unavailable, stop and report a runtime configuration error; do not fall back silently.'
          : 'Do not proceed when a requested load fails. If the skill tool is unavailable or a required skill is missing from the catalogue, stop and report a runtime configuration error instead of silently falling back.'
        : missing.length > 0
          ? 'Do not proceed until PLIF has supplied the preloaded skill bodies. Do not emit a prose refusal merely because the native tool list does not contain the host-only skill tool.'
        : 'Do not discard or reload successful skill results: keeping one copy in the carried conversation prevents context growth and preserves the same mandatory policy. Do not call the `skill` tool again unless a successful result is missing.',
    );

    for (const name of mandatory) {
      if (codexNative && loaded.has(name)) {
        lines.push(
          `The \`${name}\` skill body was preloaded by the native Codex adapter. Apply it directly; do not call the host-only \`skill\` tool.`,
        );
        continue;
      }
      if (!skillListed(name)) {
        lines.push(`${name} is not present in the catalogue; this session is misconfigured.`);
        continue;
      }
      // The compact gate sentence above already names every skill it requires,
      // so confirming each one again is prose the compact layer cannot afford.
      if (!compact) {
        lines.push(`The \`${name}\` skill is available in the catalogue and must be loaded now.`);
      }
    }

    // Galileu is a standing discipline, not a one-off ceremony at the start of
    // a session. Loading it once and then drifting is the failure this block
    // exists to prevent: the decision record has to outlive the turn that
    // created it, and later turns have to be measured against it.
    if (compact) {
      lines.push(
        '',
        '## Galileu persistence',
        'The decision record is durable state. Before acting on a request that sets or',
        'changes direction, write the objective, the assumptions it rests on and what',
        'would falsify each one. Re-read that record on every later turn, and when new',
        'evidence contradicts a recorded assumption reopen the affected decision',
        'explicitly instead of quietly proceeding. Never invent a final objective the',
        'user has not set, and never ask what the repository already answers. A reversal',
        'is appended with its cause; the original entry stays.',
      );
    } else {
      lines.push(
        '',
        '## Galileu persistence',
        'The decision record is durable state, not a formality. Keep it alive:',
        '- Before acting on a request that sets or changes direction, write the objective,',
        '  the assumptions it rests on, and what would falsify each one.',
        '- On every later turn, re-read that record before deciding. If new evidence',
        '  contradicts a recorded assumption, reopen the affected decision explicitly and',
        '  say what changed — do not quietly proceed on the old one.',
        '- Never invent a final objective when the user has not set one. Ask, then record',
        '  the answer.',
        '- Check the environment before asking: a question whose answer is in the',
        '  repository is a question that should not be asked.',
        '- When a decision is reversed, keep the original entry and add the reversal with',
        '  its cause. The history is the point; overwriting it destroys the audit.',
      );
    }

    if (context.effort === 'plif') {
      lines.push(
        '',
        ...(compact
          ? [
              'Once loaded, follow the mandatory procedures for this turn. The review',
              'checkpoint is internal orchestration: check with tools, do not narrate the',
              'gate, and finish with a concise result.',
              '',
              '### Quality gate (PLIF)',
              'Nothing is reported as done until each of these is true and checked with a',
              'tool rather than asserted: the change builds and typechecks; the tests that',
              'cover it pass; the diff introduces no secret, no broad lint suppression and',
              'no destructive default; every claim of verification names the command that',
              'produced it. A step that could not run is reported as not run.',
            ]
          : [
              'Once loaded, follow the mandatory procedures for this turn. The review checkpoint is internal orchestration: perform checks with tools, do not print gate narration or repeated audit receipts, and finish with a concise result.',
              '',
              '### Quality gate (PLIF)',
              'Nothing is reported as done until each of these is true, and each is checked',
              'with a tool rather than asserted: the change builds and typechecks; the tests',
              'that cover it run and pass; the diff introduces no secret, no broad lint',
              'suppression and no destructive default; every claim of verification names the',
              'command that produced it. A step that could not run is reported as not run.',
            ]),
      );
    }

    return lines.join('\n');
  },
});

export const toolsModule = definePromptModule({
  id: '60-tools',
  order: 60,
  enabled: (context) => context.tools?.some((tool) => !tool.name.startsWith('mcp__')) ?? false,
  render: (context) => {
    const names = new Set(
      context.tools
        ?.map((tool) => tool.name)
        .filter((name) => !name.startsWith('mcp__'))
        .sort() ?? [],
    );
    const lines = [
      '# Available Plif tools',
      '',
      `Built-in tool names: ${[...names].map((name) => `\`${name}\``).join(', ')}.`,
      'Their schemas are authoritative for arguments. Do not guess parameters from this',
      'instruction set, and do not call a tool merely because it is available.',
    ];

    if (hasAny(names, 'read_file', 'list_dir', 'glob', 'grep', 'search_files')) {
      lines.push(
        '',
        '## Search and reading',
        '- Start with a scoped search or directory view when the location is unknown.',
        '- Read enough surrounding context to understand contracts and make exact edits.',
        '- Limit large results at the source. Do not repeat an unchanged read of the same',
        '  path unless the file may have changed.',
      );
    }
    if (hasAny(names, 'edit_file', 'write_file', 'apply_patch')) {
      lines.push(
        '',
        '## File changes',
        '- Prefer the precise edit tool for existing files and whole-file writing for new',
        '  files. Re-read after a mismatch instead of guessing indentation or content.',
        '- Treat edit conflicts as current-state evidence. Preserve competing user work.',
      );
    }
    if (hasAny(names, 'run_command', 'shell_command', 'bash')) {
      lines.push(
        '',
        '## Process execution',
        '- Run a command to answer a concrete question: reproduce, inspect, test, build,',
        '  or verify. Filter predictable high-volume output before it reaches the model.',
        '- Read exit status and stderr as well as stdout. A command that ran is not',
        '  necessarily a command that succeeded. On Windows use PowerShell cmdlets and',
        '  literal paths for filesystem work; inspect $LASTEXITCODE after native tools.',
      );
    }
    if ([...names].some((name) => name.startsWith('lsp_'))) {
      lines.push(
        '',
        '## Language intelligence',
        '- Use LSP for symbol-aware navigation and diagnostics when it is available.',
        '- Confirm rename/reference scope before editing and combine diagnostics with the',
        '  project test and build evidence appropriate to the change.',
      );
    }
    if (hasAny(names, 'research', 'web_search', 'web_fetch', 'http_request', 'curl')) {
      lines.push(
        '',
        '## Web and HTTP',
        '- Use current primary sources for unstable external facts. Search results are',
        '  leads; open and read the supporting source before relying on it.',
        '- Prefer a dedicated HTTP tool over shell curl when both are available. Inspect',
        '  status, relevant headers, redirects, and response body.',
      );
    }
    if (names.has('ask_user')) {
      lines.push(
        '',
        '## User questions',
        '- Use the question UI only for a material ambiguity no available evidence can',
        '  settle. Ask one focused decision, give at most three mutually exclusive options,',
        '  and state the consequence of each option.',
        '- Never end a turn with a blocking clarification question in ordinary prose.',
        '  When the user must choose, call `ask_user` now so PLIF renders the choices',
        '  inside the active input and resumes this same turn after the answer.',
        '- Do not say that you are waiting for another message when an inline question',
        '  can express the decision. Continue the task after the answer; do not ask the',
        '  user to repeat the choice in a new chat turn.',
      );
    }
    if (names.has('update_plan')) {
      lines.push(
        '',
        '## Plan state',
        '- Keep the plan tool synchronized at meaningful checkpoints. The tool owns the',
        '  visible plan; do not echo the same checklist into chat.',
      );
    }
    if (names.has('update_plan') && hasAny(names, 'write_file', 'edit_file', 'apply_patch', 'resolve_edit_conflict')) {
      lines.push(
        '',
        '## Plan -> Work -> Review',
        '- Plan: call `update_plan` before the first authorized file mutation; keep',
        '  one checkpoint in progress.',
        '- Work: execute one coherent checkpoint at a time and update the plan at',
        '  meaningful boundaries or when evidence changes the approach.',
        '- Review: inspect every changed file and collect fresh diagnostics or relevant',
        '  test, typecheck, build, lint, or verification evidence before concluding.',
        '- If review finds a defect, return to Work, fix it, and review the new revision.',
      );
    }
    if (hasAny(names, 'subagent', 'spawn_agent')) {
      lines.push(
        '',
        '## Delegation',
        '- Delegate only a concrete, bounded task whose result can be consumed as a',
        '  standalone answer. Include paths, constraints, evidence expected, and the',
        '  parent objective because a child may not share conversation context.',
        '- Use direct work for a result that one or two focused reads can establish.',
        '- Parallel children must be independent and must not mutate the same files or',
        '  external resources. Integrate and verify child findings yourself.',
      );
    }
    if ([...names].some((name) => /vision|image/i.test(name))) {
      lines.push(
        '',
        '## Images and vision',
        '- A model declared with modalities ["text", "image"] receives images directly.',
        '- A text-only model does not see pixels. Call inspect_image instead: it sends',
        '  the attachment and question to an explicitly configured vision helper, then',
        '  returns that helper\'s textual observations to the active model.',
        '- Never infer image support from a model id or pretend to see unavailable pixels.',
        '- Switching models or spending vision credits follows the configured approval',
        '  policy. Describe observations separately from interpretation.',
      );
    }
    return lines.join('\n');
  },
});

function hasAny(names: ReadonlySet<string>, ...candidates: string[]): boolean {
  return candidates.some((candidate) => names.has(candidate));
}
