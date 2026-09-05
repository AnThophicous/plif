/**
 * `${VAR}` expansion for configuration values.
 *
 * This started life inside the MCP loader, which is where the shape was worked
 * out: a template may name an environment variable, may supply a default, and
 * a template whose variable is unset is *not* the same as a template that
 * expands to the empty string. Model provider headers need exactly the same
 * three rules, and re-deriving them there would have produced a second, subtly
 * different implementation of a security-relevant decision — whether a
 * half-formed credential goes out on the wire.
 *
 * So the rules live here, and both callers use them. The MCP module re-exports
 * these names so existing imports keep working.
 */

import { PlifError } from '../errors.js';

/** Matches `${NAME}`, `${NAME-default}` and `${NAME:-default}`. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}/g;

/**
 * Variables this template needs and cannot get.
 *
 * A reference with a non-empty default is not a gap — `${MODE:-fast}` is fully
 * satisfied by its own default and nobody should be asked for it.
 */
export function credentialGaps(
  value: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const gaps: string[] = [];
  for (const match of value.matchAll(REFERENCE)) {
    const name = match[1] as string;
    if (environment[name]?.trim()) continue;
    if (match[2]?.trim()) continue;
    gaps.push(name);
  }
  return gaps;
}

export function expandEnvironment(
  value: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return value.replace(
    REFERENCE,
    (_match, name: string, fallback: string | undefined) => {
      const resolved = environment[name];
      if (resolved) return resolved;
      if (fallback !== undefined) return fallback;
      if (resolved !== undefined) return resolved;
      throw new PlifError(
        'INVALID_ARGUMENT',
        `configuration references missing environment variable ${name}`,
      );
    },
  );
}

/**
 * Expand a header map, dropping the headers whose credentials are not there.
 *
 * `"Authorization": "${API_KEY:-}"` means "omit this when the key is unset",
 * not "send an empty credential", and the judgement is made on the variables
 * rather than on the result: `"Bearer ${KEY:-}"` expands to a non-empty
 * `"Bearer "` that is not a credential, and sending it is both useless and a
 * header the server has to reject.
 *
 * Names of the variables that came up short are collected rather than
 * swallowed, so a caller can say which one to set instead of reporting a bare
 * refusal.
 */
export function expandHeaders(
  input: unknown,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { readonly headers: Record<string, string>; readonly unsetVariables: readonly string[] } {
  const headers: Record<string, string> = {};
  const unset: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { headers, unsetVariables: unset };
  }
  for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
    if (typeof item !== 'string') continue;
    const gaps = credentialGaps(item, environment);
    if (gaps.length > 0) {
      unset.push(...gaps);
      continue;
    }
    const value = expandEnvironment(item, environment);
    if (value.trim()) headers[key] = value;
  }
  return { headers, unsetVariables: [...new Set(unset)] };
}
