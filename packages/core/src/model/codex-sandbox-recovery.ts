import { existsSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface CodexSandboxRecovery {
  readonly repaired: boolean;
  readonly statePath: string;
  readonly backupPath?: string;
}

/**
 * Recover the known Windows Codex sandbox state corruption without weakening
 * the active permission policy. The native helper persists this file outside
 * the repository; after an interrupted write it can contain only NUL bytes,
 * which makes every subsequent sandbox setup fail before a command starts.
 * Quarantine is intentionally recoverable: Codex recreates the state file.
 */
export function repairCorruptCodexWindowsSandboxState(
  codexHome = process.env['CODEX_HOME']?.trim() || join(homedir(), '.codex'),
  platform = process.platform,
): CodexSandboxRecovery {
  const statePath = join(resolve(codexHome), '.sandbox', 'deny_read_acl_state.json');
  if (platform !== 'win32' || !existsSync(statePath)) return { repaired: false, statePath };

  let bytes: Buffer;
  try {
    bytes = readFileSync(statePath);
  } catch {
    return { repaired: false, statePath };
  }

  let invalid = bytes.length === 0 || bytes.includes(0);
  if (!invalid) {
    try {
      const parsed: unknown = JSON.parse(bytes.toString('utf8'));
      invalid = parsed === null || typeof parsed !== 'object' || Array.isArray(parsed);
    } catch {
      invalid = true;
    }
  }
  if (!invalid) return { repaired: false, statePath };

  let backupPath = `${statePath}.corrupt-${Date.now()}`;
  let suffix = 0;
  while (existsSync(backupPath)) backupPath = `${statePath}.corrupt-${Date.now()}-${++suffix}`;
  try {
    renameSync(statePath, backupPath);
    return { repaired: true, statePath, backupPath };
  } catch {
    // If another Codex process owns the file, leave it untouched and let the
    // native error surface rather than deleting or weakening sandbox state.
    return { repaired: false, statePath };
  }
}
