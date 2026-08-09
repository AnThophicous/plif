import { definePromptModule } from './types.js';

export const toolsModule = definePromptModule({
  id: '60-tools',
  order: 60,
  enabled: (context) => (context.tools?.some((tool) => !tool.name.startsWith('mcp__')) ?? false),
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
      'prompt, and do not call a tool merely because it is available.',
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
        '  necessarily a command that succeeded.',
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
        '  settle. Ask one focused decision and make options mutually exclusive.',
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
