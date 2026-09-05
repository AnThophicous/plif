/**
 * Which of plif's tools this server exposes, and how one becomes an MCP tool.
 *
 * The selection is an allowlist keyed by tier, not a subtraction from
 * `DEFAULT_TOOLS`. That direction matters: a tool added to core later shows up
 * here only when someone decides which tier it belongs to, so a new tool
 * cannot arrive on an untrusted client's menu by default. The tools left out
 * are left out for one of two reasons — they need loop state an MCP call does
 * not have (goals, plans, tasks, session search, edit conflicts), or they are
 * a privilege surface no remote caller should reach (config, profiles,
 * ask_user).
 *
 * Everything still runs through `Container`, so the path jail, policy engine,
 * sandbox and audit log apply to an MCP call exactly as they do to a call the
 * model made in-loop. This file only decides what is on the menu.
 */

import type { Tool, ToolContext, ToolResult } from '@plif/core';
import type { ToolTier, McpSecurityPolicy } from './security.js';

/** The tier each exposed tool belongs to, by core tool name. */
const TIER_BY_TOOL: Readonly<Record<string, ToolTier>> = Object.freeze({
  read_file: 'read',
  list_dir: 'read',
  glob: 'read',
  grep: 'read',
  write_file: 'edit',
  edit_file: 'edit',
  apply_patch: 'edit',
  run_command: 'exec',
  shell_command: 'exec',
  skill: 'skills',
});

function tierGranted(tier: ToolTier, policy: McpSecurityPolicy): boolean {
  switch (tier) {
    case 'read':
      return policy.allowRead;
    case 'skills':
      return policy.allowSkills;
    case 'edit':
      return policy.allowEdit;
    case 'exec':
      return policy.allowExec;
  }
}

/**
 * Filter a session tool set down to what the policy grants.
 *
 * A tool with no tier is dropped rather than defaulted, which is what keeps
 * the allowlist honest as core grows.
 */
export function exposedTools(
  tools: readonly Tool[],
  policy: McpSecurityPolicy,
): readonly Tool[] {
  return tools.filter((tool) => {
    const tier = TIER_BY_TOOL[tool.spec.name];
    return tier !== undefined && tierGranted(tier, policy);
  });
}

export function tierOf(name: string): ToolTier | undefined {
  return TIER_BY_TOOL[name];
}

/** An MCP `tools/list` entry built from a plif tool spec. */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
  };
}

/**
 * Describe a tool for `tools/list`.
 *
 * The parameter schema goes across verbatim. Plif tools already carry plain
 * JSON Schema, so there is nothing to translate — and translating it through
 * Zod and back, which the MCP SDK's high-level helper would require, is how
 * `additionalProperties: false` and the tighter numeric bounds get quietly
 * dropped from the contract a client validates against.
 *
 * The annotations are derived from the tier rather than restated per tool, so
 * a client's "this is safe to auto-run" heuristic agrees with the grant that
 * actually gated the tool.
 */
export function describeTool(tool: Tool): McpToolDescriptor {
  const tier = TIER_BY_TOOL[tool.spec.name];
  const readOnly = tier === 'read' || tier === 'skills';
  return {
    name: tool.spec.name,
    description: tool.spec.description,
    inputSchema: tool.spec.parameters,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: tier === 'edit' || tier === 'exec',
      idempotentHint: readOnly,
      // A command can reach the network; nothing else here can.
      openWorldHint: tier === 'exec',
    },
  };
}

/**
 * The MCP `tools/call` result shape, narrowed to the text content this server returns.
 *
 * The index signature is what the SDK's result type requires of anything a
 * request handler returns, and the fields are mutable for the same reason: a
 * `readonly` shape is not assignable to it.
 */
export interface McpCallResult {
  content: { type: 'text'; text: string }[];
  isError: boolean;
  [key: string]: unknown;
}

/**
 * Run one tool and shape its result for the wire.
 *
 * A tool that failed comes back as `isError` with its message as content
 * rather than as a JSON-RPC error, because that is the difference MCP draws:
 * a protocol error means the call could not be attempted, while a tool that
 * ran and refused is a result the client's model should get to read and react
 * to. Collapsing the second into the first is what leaves a client retrying a
 * denied write forever without ever seeing why it was denied.
 *
 * The diff, when there is one, is appended rather than dropped. In-loop the
 * diff has a separate audience — the terminal — but an MCP client has only
 * this channel, and a write whose result says nothing about what changed is
 * not reviewable.
 */
export async function callTool(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<McpCallResult> {
  let result: ToolResult;
  try {
    result = await tool.run(input, context);
  } catch (error) {
    return {
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
  const text = result.diff ? `${result.output}\n\n${result.diff}` : result.output;
  return {
    content: [{ type: 'text', text }],
    isError: !result.ok,
  };
}
