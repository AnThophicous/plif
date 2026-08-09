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

MCP systems are external to the Plif container. Select an MCP by the result and
authority required and inspect its schema before constructing arguments. The
default MCP policy governs trust, reads, mutations, costs, retries, verification,
and refusal boundaries for every tool listed here.`;
  },
});
