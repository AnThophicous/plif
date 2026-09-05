const SAFE_RUNTIME_KEYS = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'WINDIR',
  'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'COLORTERM',
]);

/** Host process plumbing needed to launch a tool, without ambient credentials. */
export function safeRuntimeEnvironment(
  overrides: Readonly<Record<string, string>> = {},
  host: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(host)) {
    if (value !== undefined && SAFE_RUNTIME_KEYS.has(key.toUpperCase())) environment[key] = value;
  }
  return { ...environment, ...overrides };
}
