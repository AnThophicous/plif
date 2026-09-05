/**
 * Local security policy for the bundled MCP server.
 *
 * This package turns plif's own tool surface into an MCP server, which means
 * an arbitrary MCP *client* — some other editor, some other agent — is the
 * caller. That client is untrusted. It gets the read and search tools by
 * default and nothing else; writing to the workspace and running commands are
 * separate opt-ins that only the machine's owner can grant, through
 * ~/.plif/mcp-security.json.
 *
 * The reason the grants are split that way rather than handed out with the
 * connection is that the three tiers fail differently. A read leaks; a write
 * corrupts; an exec owns the machine. A client that only needed to look at
 * files should not be one JSON-RPC frame away from the third.
 *
 * Every field defaults to the safest value, and nothing is ever granted
 * because a field is missing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEVELOPER_POLICY } from '@plif/core';
import type { PolicyDocument } from '@plif/core';

/**
 * The engine policy this server runs its container under.
 *
 * Like the ACP adapter, the served workspace is a host mount rather than an
 * isolated container layer, so the core developer policy's write rule is too
 * loose on its own. The extra rules downgrade host-visible writes and
 * execution to `ask`. Policy evaluation takes the most restrictive matching
 * decision, so the VCS deny rules still win.
 *
 * `ask` matters even though no human is watching a stdio server: with no
 * question broker able to reach a user, an `ask` decision is refused rather
 * than granted, which is the direction a headless surface should fail in. The
 * tier grants below are what actually open a lane, and they are explicit.
 */
export const MCP_POLICY: PolicyDocument = Object.freeze({
  ...DEVELOPER_POLICY,
  rules: Object.freeze([
    ...DEVELOPER_POLICY.rules,
    {
      name: 'mcp-host-workspace-writes',
      actions: ['fs.write', 'fs.delete'] as const,
      match: '/**',
      decision: 'ask' as const,
      rationale:
        'The MCP server mounts a real workspace; a client write lands on the host and must be granted explicitly.',
    },
    {
      name: 'mcp-host-workspace-execution',
      actions: ['exec'] as const,
      argvPattern: '.*',
      decision: 'ask' as const,
      rationale: 'A command reached through MCP can do anything the workspace mount allows.',
    },
  ]),
});

/** The tool tiers a client can be granted, in order of what they cost to get wrong. */
export type ToolTier = 'read' | 'skills' | 'edit' | 'exec';

export interface McpSecurityPolicy {
  /**
   * Filesystem reads and search: read_file, list_dir, glob, grep. On by
   * default — a server that cannot read anything has no reason to exist.
   */
  readonly allowRead: boolean;
  /** Expose plif's skill catalogue as MCP prompts and a `skill` tool. On by default; it is read-only. */
  readonly allowSkills: boolean;
  /** write_file, edit_file, apply_patch. Off by default. */
  readonly allowEdit: boolean;
  /** run_command and shell_command. Off by default, and the last thing to turn on. */
  readonly allowExec: boolean;
  /**
   * Directories this server may serve, in addition to the working directory it
   * was started in. A client cannot name a workspace at all — the launcher's
   * cwd decides — so this exists for a launcher that wants to pin the set
   * rather than inherit whatever shell started it.
   */
  readonly workspaceRoots: readonly string[];
  /** Hard ceiling on concurrent in-flight tool calls, so one client cannot fork-bomb the engine. */
  readonly maxConcurrentCalls: number;
}

export const DEFAULT_POLICY: McpSecurityPolicy = Object.freeze({
  allowRead: true,
  allowSkills: true,
  allowEdit: false,
  allowExec: false,
  workspaceRoots: Object.freeze([]),
  maxConcurrentCalls: 8,
});

export function securityPolicyPath(): string {
  return path.join(os.homedir(), '.plif', 'mcp-security.json');
}

function booleanFrom(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(1|true|yes|on)$/i.test(value)) return true;
    if (/^(0|false|no|off)$/i.test(value)) return false;
  }
  return fallback;
}

function numberFrom(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (parsed > 0) return parsed;
  }
  return fallback;
}

function rootsFrom(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return DEFAULT_POLICY.workspaceRoots;
  const roots = value.filter(
    (entry): entry is string => typeof entry === 'string' && path.isAbsolute(entry),
  );
  return Object.freeze([...new Set(roots.map((root) => path.resolve(root)))]);
}

/**
 * Load the policy from JSON if it is there.
 *
 * An absent file means the safe defaults. A malformed one fails loudly: a
 * server that quietly ran on defaults after the owner believed they had
 * configured it is the failure this refuses to have.
 *
 * Only the concurrency ceiling can be tightened from the environment. The
 * grants cannot, because the environment of a stdio server is set by whoever
 * launched it — which in the threat model here can be the client.
 */
export async function loadSecurityPolicy(): Promise<McpSecurityPolicy> {
  let file: Record<string, unknown> = {};
  const filePath = securityPolicyPath();
  if (fs.existsSync(filePath)) {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('policy file must contain a JSON object');
      }
      file = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `plif-mcp: could not read security policy at ${filePath}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    allowRead: booleanFrom(file['allowRead'], DEFAULT_POLICY.allowRead),
    allowSkills: booleanFrom(file['allowSkills'], DEFAULT_POLICY.allowSkills),
    allowEdit: booleanFrom(file['allowEdit'], DEFAULT_POLICY.allowEdit),
    allowExec: booleanFrom(file['allowExec'], DEFAULT_POLICY.allowExec),
    workspaceRoots: rootsFrom(file['workspaceRoots']),
    maxConcurrentCalls: numberFrom(
      process.env['PLIF_MCP_MAX_CONCURRENT_CALLS'] ?? file['maxConcurrentCalls'],
      DEFAULT_POLICY.maxConcurrentCalls,
    ),
  };
}

/** The tiers this policy grants, for the startup log and the server instructions. */
export function grantedTiers(policy: McpSecurityPolicy): readonly ToolTier[] {
  const tiers: ToolTier[] = [];
  if (policy.allowRead) tiers.push('read');
  if (policy.allowSkills) tiers.push('skills');
  if (policy.allowEdit) tiers.push('edit');
  if (policy.allowExec) tiers.push('exec');
  return tiers;
}

/** Component-aware containment check, so `/srv/app-evil` is not inside `/srv/app`. */
export function isWorkspaceAllowed(workspace: string, roots: readonly string[]): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const candidate = normalize(workspace);
  return roots.some((root) => {
    const relative = path.relative(normalize(root), candidate);
    return (
      relative === '' ||
      (relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  });
}
