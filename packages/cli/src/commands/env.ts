/** Presentation contracts for the project-scoped `/env` command. */

import path from 'node:path';

import { PlifError } from '@plif/core';

export type EnvStorage = 'encrypted' | 'memory';

export interface EnvVariableStatus {
  readonly name: string;
  /** True when the decrypted value is currently attached to the running container. */
  readonly loaded: boolean;
}

export interface EnvStatus {
  readonly workspace?: string;
  readonly sessionId: string;
  readonly storage: EnvStorage;
  readonly variables: readonly EnvVariableStatus[];
  /** Safe explanation when the OS-backed store is unavailable. */
  readonly warning?: string;
}

export interface EnvSetResult {
  readonly name: string;
  readonly saved: boolean;
}

export interface EnvImportResult {
  readonly names: readonly string[];
}

export interface EnvCommandActions {
  readonly status: () => Promise<EnvStatus>;
  readonly set: (name: string, value?: string) => Promise<EnvSetResult>;
  readonly importFile: (file: string) => Promise<EnvImportResult>;
  readonly delete: (name: string) => Promise<boolean>;
  readonly clear: () => Promise<number>;
}

export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENV_NAME_LENGTH = 128;

function invalid(message: string, hint?: string): PlifError {
  return new PlifError('INVALID_ARGUMENT', message, hint ? { hint } : {});
}

/** Validate one environment variable name without ever touching its value. */
export function normalizeEnvName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw invalid('environment variable name is required');
  if (name.length > MAX_ENV_NAME_LENGTH || !ENV_NAME_PATTERN.test(name)) {
    throw invalid(
      `invalid environment variable name "${name.slice(0, 48)}"`,
      'Use letters, digits and underscores; the first character must be a letter or underscore.',
    );
  }
  return name;
}

/** Paths named like `.env`, `.env.local` or `secrets.env` are accepted. */
export function isDotEnvPath(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env');
}
