import { definePromptModule } from './types.js';

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
  enabled: (context) => Boolean(context.skills?.trim()),
  render: (context) => `# Available skills

${context.skills!.trim()}

Treat this catalogue as an active routing table. For every request, silently scan
names, package labels, and descriptions for a clear match. The user does not need
to mention a skill or know that it exists. Load the smallest sufficient matching
set through the skill tool before covered work begins. A package groups related
skills but does not require loading every child.

This catalogue is routing metadata, not the skill body. If no entry clearly
matches, proceed normally without announcing the scan. If a selected skill cannot
load or does not fit after inspection, discard it and continue with the default
workflow. The default skill policy governs precedence, resources, and user
updates.`,
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
    if (hasAny(names, 'web_search', 'web_fetch', 'http_request', 'curl')) {
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
        '- Inspect an attached image only through a model or tool that actually supports',
        '  vision. Do not pretend to see pixels unavailable to the active model.',
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

