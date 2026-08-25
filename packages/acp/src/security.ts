/**
 * Local security policy for the ACP adapter.
 *
 * The ACP host is untrusted by default: everything it could grant itself in
 * the original PR (bypass mode, arbitrary MCP servers, persisted model
 * switches, skill mirroring into the workspace) now requires a local opt-in.
 *
 * Policy source, in order of precedence:
 *   1. ~/.plif/acp-security.json  (recommended — survives restarts)
 *   2. PLIF_ACP_* environment variables (per-launch overrides)
 *
 * Every field defaults to the SAFEST value. Nothing is ever granted because
 * a field is missing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AcpSecurityPolicy {
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
}

export const DEFAULT_POLICY: AcpSecurityPolicy = Object.freeze({
  allowBypassPermissions: false,
  allowHostMcpServers: false,
  hostMcpCommandPrefixes: Object.freeze(['npx', 'node', 'bunx', 'uvx', 'python']),
  allowModelSwitch: false,
  persistModelSwitch: false,
  maxSessions: 8,
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

/**
 * Load the policy: JSON file (if present) merged over the defaults, then env
 * overrides. The file is never required — absent file means the safe
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
    allowBypassPermissions: booleanFrom(
      env['PLIF_ACP_ALLOW_BYPASS'] ?? file['allowBypassPermissions'],
      DEFAULT_POLICY.allowBypassPermissions,
    ),
    allowHostMcpServers: booleanFrom(
      env['PLIF_ACP_ALLOW_HOST_MCP'] ?? file['allowHostMcpServers'],
      DEFAULT_POLICY.allowHostMcpServers,
    ),
    hostMcpCommandPrefixes: prefixesFrom(
      file['hostMcpCommandPrefixes'],
      DEFAULT_POLICY.hostMcpCommandPrefixes,
    ),
    allowModelSwitch: booleanFrom(
      env['PLIF_ACP_ALLOW_MODEL_SWITCH'] ?? file['allowModelSwitch'],
      DEFAULT_POLICY.allowModelSwitch,
    ),
    persistModelSwitch: booleanFrom(
      env['PLIF_ACP_PERSIST_MODEL_SWITCH'] ?? file['persistModelSwitch'],
      DEFAULT_POLICY.persistModelSwitch,
    ),
    maxSessions: numberFrom(
      env['PLIF_ACP_MAX_SESSIONS'] ?? file['maxSessions'],
      DEFAULT_POLICY.maxSessions,
    ),
  };
}

/** Helper for callers that want to display the policy decisions. */
export type SecurityDecision = { readonly granted: boolean; readonly reason: string };