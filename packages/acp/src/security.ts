/**
 * Local security policy for the ACP adapter.
 *
 * The ACP host is untrusted by default: everything it could grant itself in
 * the original PR (bypass mode, arbitrary MCP servers, persisted model
 * switches, skill mirroring into the workspace) now requires a local opt-in.
 *
 * Privilege-granting fields come only from ~/.plif/acp-security.json. The
 * environment may tighten the session-count ceiling, but cannot silently turn
 * on edit/bypass modes, host MCP execution, or persistent model changes.
 *
 * Every field defaults to the SAFEST value. Nothing is ever granted because
 * a field is missing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEVELOPER_POLICY } from '@plif/core';
import type { PolicyDocument } from '@plif/core';

/**
 * ACP mounts the selected workspace read-write, so the core developer policy
 * cannot be reused verbatim: its ordinary write rule assumes writes land in
 * an isolated container layer. Keep the normal rules, then add a stricter
 * approval rule for the host-backed workspace. Policy evaluation chooses the
 * most restrictive matching decision, so VCS protection still wins with deny.
 */
export const ACP_POLICY: PolicyDocument = Object.freeze({
  ...DEVELOPER_POLICY,
  rules: Object.freeze([
    ...DEVELOPER_POLICY.rules,
    {
      name: 'acp-host-workspace-writes',
      actions: ['fs.write', 'fs.delete'] as const,
      match: '/**',
      decision: 'ask' as const,
      rationale: 'This ACP session mounts the selected workspace on the host; approve each change explicitly.',
    },
    {
      name: 'acp-host-workspace-execution',
      actions: ['exec'] as const,
      argvPattern: '.*',
      decision: 'ask' as const,
      rationale: 'A command can write through the host-backed workspace mount; approve it explicitly.',
    },
  ]),
});

export interface AcpSecurityPolicy {
  /** Allow the host to auto-approve workspace writes/deletes. Off by default. */
  readonly allowAcceptEdits: boolean;
  /**
   * Allow the host to switch the session to `bypassPermissions`, which
   * auto-approves EVERY action (commands, writes, network). Off by default.
   */
  readonly allowBypassPermissions: boolean;
  /**
   * Allow MCP servers proposed by the host. Off by default. When on, the
   * server `command` must still start with one of `hostMcpCommandPrefixes`.
   */
  readonly allowHostMcpServers: boolean;
  /** Allowed first token of a host-proposed MCP stdio command. */
  readonly hostMcpCommandPrefixes: readonly string[];
  /**
   * Allow the host to switch the active model. Off by default. When on, the
   * switch is session-local unless `persistModelSwitch` is also true.
   */
  readonly allowModelSwitch: boolean;
  /**
   * Persist host model switches into ~/.plif/config.toml. Requires
   * `allowModelSwitch`. Off by default.
   */
  readonly persistModelSwitch: boolean;
  /** Hard cap on simultaneous sessions. */
  readonly maxSessions: number;
  /** Additional directories the local ACP launcher explicitly permits. */
  readonly workspaceRoots: readonly string[];
}

export const DEFAULT_POLICY: AcpSecurityPolicy = Object.freeze({
  allowAcceptEdits: false,
  allowBypassPermissions: false,
  allowHostMcpServers: false,
  hostMcpCommandPrefixes: Object.freeze(['npx', 'node', 'bunx', 'uvx', 'python']),
  allowModelSwitch: false,
  persistModelSwitch: false,
  maxSessions: 8,
  workspaceRoots: Object.freeze([]),
});

export function securityPolicyPath(): string {
  return path.join(os.homedir(), '.plif', 'acp-security.json');
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
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (parsed > 0) return parsed;
  }
  return fallback;
}

function prefixesFrom(value: unknown, fallback: readonly string[]): readonly string[] {
  if (Array.isArray(value)) {
    const cleaned = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    if (cleaned.length > 0) return Object.freeze([...cleaned]);
  }
  return fallback;
}

function rootsFrom(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return DEFAULT_POLICY.workspaceRoots;
  const roots = value.filter((entry): entry is string => typeof entry === 'string' && path.isAbsolute(entry));
  return Object.freeze([...new Set(roots.map((root) => path.resolve(root)))]);
}

/**
 * Load the policy from JSON (if present). The file is never required — absent file means the safe
 * defaults. A malformed file fails LOUD (the adapter must not silently run
 * with an empty policy when the user believed they configured one).
 */
export async function loadSecurityPolicy(): Promise<AcpSecurityPolicy> {
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
        `plif-acp: could not read security policy at ${filePath}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const env = process.env;

  return {
    allowAcceptEdits: booleanFrom(
      file['allowAcceptEdits'],
      DEFAULT_POLICY.allowAcceptEdits,
    ),
    allowBypassPermissions: booleanFrom(
      file['allowBypassPermissions'],
      DEFAULT_POLICY.allowBypassPermissions,
    ),
    allowHostMcpServers: booleanFrom(
      file['allowHostMcpServers'],
      DEFAULT_POLICY.allowHostMcpServers,
    ),
    hostMcpCommandPrefixes: prefixesFrom(
      file['hostMcpCommandPrefixes'],
      DEFAULT_POLICY.hostMcpCommandPrefixes,
    ),
    allowModelSwitch: booleanFrom(
      file['allowModelSwitch'],
      DEFAULT_POLICY.allowModelSwitch,
    ),
    persistModelSwitch: booleanFrom(
      file['persistModelSwitch'],
      DEFAULT_POLICY.persistModelSwitch,
    ),
    maxSessions: numberFrom(
      env['PLIF_ACP_MAX_SESSIONS'] ?? file['maxSessions'],
      DEFAULT_POLICY.maxSessions,
    ),
    workspaceRoots: rootsFrom(file['workspaceRoots']),
  };
}

/** Component-aware workspace check used before an ACP host path becomes a mount. */
export function isWorkspaceAllowed(workspace: string, roots: readonly string[]): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const candidate = normalize(workspace);
  return roots.some((root) => {
    const relative = path.relative(normalize(root), candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  });
}

/** Helper for callers that want to display the policy decisions. */
export type SecurityDecision = { readonly granted: boolean; readonly reason: string };
