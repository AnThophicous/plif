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
