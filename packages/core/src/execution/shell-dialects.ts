/** A deterministic interpreter adapter. It builds argv; it never executes it. */
export interface ShellDialect {
  readonly id: 'powershell' | 'bash';
  readonly displayName: string;
  readonly executable: string;
  readonly capabilities: readonly ('pipeline' | 'redirection' | 'structured-output')[];
  argv(script: string): readonly string[];
  promptGuidance(): readonly string[];
}

export interface ShellDialectResolution {
  readonly dialect: ShellDialect | null;
  readonly reason: string | null;
}

export interface ShellDialectEnvironment {
  readonly platform: NodeJS.Platform;
  readonly interpreters: readonly string[];
}

export class PowerShellDialect implements ShellDialect {
  readonly id = 'powershell' as const;
  readonly displayName = 'PowerShell';
  readonly capabilities = Object.freeze([
    'pipeline',
    'redirection',
    'structured-output',
  ] as const);

  constructor(readonly executable: string) {}

  argv(script: string): readonly string[] {
    return Object.freeze([
      this.executable,
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
  }

  promptGuidance(): readonly string[] {
    return Object.freeze([
      'Use run_command for one executable and literal argv.',
      'Use shell_command for PowerShell cmdlets, pipelines, redirection, structured filtering, or multi-step expressions.',
      'Write PowerShell syntax; do not translate examples into a POSIX shell.',
    ]);
  }
}

export class BashDialect implements ShellDialect {
  readonly id = 'bash' as const;
  readonly displayName = 'Bash';
  readonly capabilities = Object.freeze(['pipeline', 'redirection'] as const);

  constructor(readonly executable: string = 'bash') {}

  argv(script: string): readonly string[] {
    return Object.freeze([
      this.executable,
      '--noprofile',
      '--norc',
      '-c',
      script,
    ]);
  }

  promptGuidance(): readonly string[] {
    return Object.freeze([
      'Use run_command for one executable and literal argv.',
      'Use shell_command only for pipelines, redirection, or multi-step Bash expressions.',
      'Startup profiles are disabled for deterministic execution.',
    ]);
  }
}

export function resolveShellDialect(
  environment: ShellDialectEnvironment,
): ShellDialectResolution {
  if (environment.platform !== 'win32') {
    const bash = findInterpreter(environment.interpreters, 'bash');
    if (bash) return Object.freeze({ dialect: new BashDialect(bash), reason: null });
    return Object.freeze({
      dialect: null,
      reason: 'Bash was not found on PATH; shell_command is unavailable.',
    });
  }

  const pwsh = findInterpreter(environment.interpreters, 'pwsh.exe', 'pwsh');
  if (pwsh) return Object.freeze({ dialect: new PowerShellDialect(pwsh), reason: null });

  const windowsPowerShell = findInterpreter(
    environment.interpreters,
    'powershell.exe',
    'powershell',
  );
  if (windowsPowerShell) {
    return Object.freeze({ dialect: new PowerShellDialect(windowsPowerShell), reason: null });
  }

  return Object.freeze({
    dialect: null,
    reason: 'PowerShell was not found on PATH; shell_command is unavailable.',
  });
}

function findInterpreter(
  interpreters: readonly string[],
  ...names: readonly string[]
): string | null {
  const expected = new Set(names.map((name) => name.toLowerCase()));
  return interpreters.find((name) => expected.has(name.toLowerCase())) ?? null;
}
