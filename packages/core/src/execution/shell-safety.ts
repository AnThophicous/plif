/**
 * Static inspection for the interpreter envelopes accepted by Plif.
 *
 * This module deliberately does not try to be a complete shell parser. It
 * recognizes a small, auditable invocation grammar and fails closed whenever
 * an interpreter could obtain code from somewhere other than the literal argv
 * being inspected. Direct argv remains direct and policy-controlled.
 */

export type ShellEnvelope = 'direct' | 'powershell' | 'bash' | 'cmd';
export type ShellInvocationState = 'direct' | 'static-envelope' | 'opaque' | 'malformed';

export interface ShellInvocationAnalysis {
  readonly state: ShellInvocationState;
  /** Alias retained for consumers that describe the discriminator as a kind. */
  readonly kind: ShellInvocationState;
  readonly envelope: ShellEnvelope;
  readonly executable: string;
  readonly script: string | null;
  /** Why static inspection was impossible, for opaque or malformed envelopes. */
  readonly reason: string | null;
  /** Compatibility field for callers that only distinguish malformed input. */
  readonly malformed: string | null;
}

export interface DangerousInvocation {
  readonly command: string;
  readonly reason: string;
}

interface Token {
  readonly value: string;
  readonly quoted: boolean;
  readonly dynamic: boolean;
  /** A substitution that executes code even when this token is only an argument. */
  readonly executesDynamic: boolean;
}

interface LexResult {
  readonly commands: readonly (readonly Token[])[];
  readonly error: string | null;
}

interface Inspection {
  readonly analysis: ShellInvocationAnalysis;
  readonly hard: DangerousInvocation | null;
  readonly background: DangerousInvocation | null;
}

const MAX_ENVELOPE_DEPTH = 6;

const HARD_DENIED_COMMANDS = new Map<string, string>([
  ['bcdedit', 'modifies the boot configuration'],
  ['bootcfg', 'modifies the boot configuration'],
  ['vssadmin', 'destroys shadow copies and backups'],
  ['wbadmin', 'destroys shadow copies and backups'],
  ['cipher', 'can wipe free space irrecoverably'],
  ['diskpart', 'operates on raw disks'],
  ['format', 'operates on raw disks'],
  ['reg', 'edits the registry outside the sandbox'],
  ['regedit', 'edits the registry outside the sandbox'],
  ['netsh', 'reconfigures host networking'],
  ['sc', 'controls Windows services and shares'],
  ['net', 'controls Windows services and shares'],
  ['schtasks', 'installs persistence outside the container lifetime'],
  ['at', 'installs persistence outside the container lifetime'],
  ['takeown', 'rewrites host ACLs, defeating the jail'],
  ['icacls', 'rewrites host ACLs, defeating the jail'],
  ['cacls', 'rewrites host ACLs, defeating the jail'],
  ['shutdown', 'terminates the host session'],
  ['logoff', 'terminates the host session'],
  ['mkfs', 'operates on raw block devices'],
  ['fdisk', 'operates on raw block devices'],
  ['dd', 'operates on raw block devices'],
  ['sudo', 'escalates privilege out of the sandbox'],
  ['runas', 'escalates privilege out of the sandbox'],
  ['su', 'escalates privilege out of the sandbox'],
  ['set-executionpolicy', 'changes PowerShell execution policy'],
]);

const POWERSHELL_NAMES = new Set(['powershell', 'pwsh']);
const BASH_NAMES = new Set(['bash', 'sh']);
const CMD_NAMES = new Set(['cmd']);

export function analyzeShellInvocation(argv: readonly string[]): ShellInvocationAnalysis {
  return inspectInvocation(argv, 0).analysis;
}

/** Integrity and host escapes that no configurable foreground rule may allow. */
export function classifyHardDeniedInvocation(
  argv: readonly string[],
): DangerousInvocation | null {
  return inspectInvocation(argv, 0).hard;
}

/**
 * The stricter background boundary: hard denials plus destructive operations
 * that remain configurable for foreground work.
 */
export function classifyBackgroundDangerousInvocation(
  argv: readonly string[],
): DangerousInvocation | null {
  return inspectInvocation(argv, 0).background;
}

function inspectInvocation(argv: readonly string[], depth: number): Inspection {
  const parsed = parseEnvelope(argv);
  if (parsed.state === 'opaque' || parsed.state === 'malformed') {
    const danger = unsafeEnvelope(parsed);
    return { analysis: parsed, hard: danger, background: danger };
  }

  if (parsed.state === 'direct') {
    const direct = inspectDirect(argv);
    return { analysis: parsed, hard: direct.hard, background: direct.background };
  }

  if (depth >= MAX_ENVELOPE_DEPTH) {
    const analysis = issueAnalysis(
      parsed,
      'opaque',
      `nested shell envelopes exceed the inspection depth of ${MAX_ENVELOPE_DEPTH}`,
    );
    const danger = unsafeEnvelope(analysis);
    return { analysis, hard: danger, background: danger };
  }

  const envelope = parsed.envelope as Exclude<ShellEnvelope, 'direct'>;
  const lexed = lexScript(parsed.script ?? '', envelope);
  if (lexed.error) {
    const analysis = issueAnalysis(parsed, 'malformed', lexed.error);
    const danger = unsafeEnvelope(analysis);
    return { analysis, hard: danger, background: danger };
  }

  let hard: DangerousInvocation | null = null;
  let background: DangerousInvocation | null = null;
  for (const command of lexed.commands) {
    const inspected = inspectScriptCommand(command, envelope, depth);
    if (inspected.issue) {
      const analysis = issueAnalysis(parsed, inspected.issue.state, inspected.issue.reason);
      const danger = unsafeEnvelope(analysis);
      return { analysis, hard: danger, background: danger };
    }
    hard ??= inspected.hard;
    background ??= inspected.background;
  }

  return { analysis: parsed, hard, background: hard ?? background };
}

function parseEnvelope(argv: readonly string[]): ShellInvocationAnalysis {
  if (argv.length === 0 || !argv[0]?.trim()) {
    return analysis('malformed', 'direct', '', null, 'an invocation needs a non-empty executable');
  }

  const executable = argv[0];
  const command = commandName(executable);
  if (POWERSHELL_NAMES.has(command)) return parsePowerShellEnvelope(argv, executable);
  if (BASH_NAMES.has(command)) return parseBashEnvelope(argv, executable, command);
  if (CMD_NAMES.has(command)) return parseCmdEnvelope(argv, executable);
  return analysis('direct', 'direct', executable, null, null);
}

function parsePowerShellEnvelope(
  argv: readonly string[],
  executable: string,
): ShellInvocationAnalysis {
  const args = argv.slice(1);
  let commandFlag = -1;

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index] ?? '';
    if (raw === '-') {
      return analysis('opaque', 'powershell', executable, null, 'PowerShell stdin scripts cannot be inspected');
    }
    if (!/^[-/]/.test(raw)) {
      return analysis(
        'opaque',
        'powershell',
        executable,
        null,
        'PowerShell script-file or implicit input cannot be inspected',
      );
    }

    const option = raw.replace(/^[-/]+/, '').toLowerCase();
    if (!option) {
      return analysis('opaque', 'powershell', executable, null, 'PowerShell option parsing is ambiguous');
    }
    if (
      isPowerShellOption(option, 'encodedcommand') ||
      isPowerShellOption(option, 'encodedarguments')
    ) {
      return analysis('opaque', 'powershell', executable, null, 'encoded PowerShell input cannot be inspected');
    }
    if (isPowerShellOption(option, 'file')) {
      return analysis('opaque', 'powershell', executable, null, 'PowerShell script files cannot be inspected');
    }
    if (isPowerShellOption(option, 'executionpolicy')) {
      return analysis(
        'opaque',
        'powershell',
        executable,
        null,
        'PowerShell execution-policy overrides are not permitted',
      );
    }
    if (isPowerShellOption(option, 'command') || option === 'c') {
      if (commandFlag !== -1) {
        return analysis('malformed', 'powershell', executable, null, 'conflicting PowerShell command flags');
      }
      commandFlag = index;
      const suffix = args.slice(index + 1);
      if (suffix.length === 0) {
        return analysis('malformed', 'powershell', executable, null, 'PowerShell -Command needs a script');
      }
      if (suffix[0] === '-') {
        return analysis('opaque', 'powershell', executable, null, 'PowerShell stdin scripts cannot be inspected');
      }
      return analysis('static-envelope', 'powershell', executable, suffix.join(' '), null);
    }

    if (!['nologo', 'noprofile', 'noninteractive'].includes(option)) {
      return analysis(
        'opaque',
        'powershell',
        executable,
        null,
        `unsupported PowerShell option "${raw}" makes the envelope ambiguous`,
      );
    }
  }

  return analysis(
    'opaque',
    'powershell',
    executable,
    null,
    'PowerShell invocation has no literal -Command script',
  );
}

function parseBashEnvelope(
  argv: readonly string[],
  executable: string,
  shell: string,
): ShellInvocationAnalysis {
  const args = argv.slice(1);
  let sawCommand = false;

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index] ?? '';
    if (raw === '--') {
      return analysis('opaque', 'bash', executable, null, `${shell} input after -- cannot be inspected`);
    }
    if (raw === '--noprofile' || raw === '--norc') {
      if (shell !== 'bash') {
        return analysis('opaque', 'bash', executable, null, `${shell} does not support Bash profile guards`);
      }
      continue;
    }
    if (/^--(?:login|rcfile|init-file|profile)(?:=|$)/i.test(raw)) {
      return analysis('opaque', 'bash', executable, null, 'login or profile-loading shells are not permitted');
    }
    if (raw.startsWith('--')) {
      return analysis('opaque', 'bash', executable, null, `unsupported shell option "${raw}" is ambiguous`);
    }
    if (raw.startsWith('-') && raw !== '-') {
      const options = raw.slice(1);
      if (/[lis]/i.test(options)) {
        return analysis('opaque', 'bash', executable, null, 'login, interactive, or stdin shell modes are not permitted');
      }
      if (!/^[ceuxvn]+$/i.test(options)) {
        return analysis('opaque', 'bash', executable, null, `unsupported shell option "${raw}" is ambiguous`);
      }
      if (options.toLowerCase().split('').filter((value) => value === 'c').length > 1 || sawCommand) {
        return analysis('malformed', 'bash', executable, null, 'conflicting shell command flags');
      }
      if (options.toLowerCase().includes('c')) {
        sawCommand = true;
        const script = args[index + 1];
        if (script === undefined) {
          return analysis('malformed', 'bash', executable, null, `${shell} -c needs a script`);
        }
        return analysis('static-envelope', 'bash', executable, script, null);
      }
      continue;
    }
    return analysis('opaque', 'bash', executable, null, `${shell} script files cannot be inspected`);
  }

  return analysis('opaque', 'bash', executable, null, `${shell} invocation has no literal -c script`);
}

function parseCmdEnvelope(argv: readonly string[], executable: string): ShellInvocationAnalysis {
  const args = argv.slice(1);
  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index] ?? '';
    const option = raw.toLowerCase();
    if (option === '/k' || option.startsWith('/k:')) {
      return analysis('opaque', 'cmd', executable, null, 'cmd /k leaves an uninspectable interactive shell');
    }
    if (option === '/c') {
      const suffix = args.slice(index + 1);
      if (suffix.length === 0) {
        return analysis('malformed', 'cmd', executable, null, 'cmd /c needs a script');
      }
      return analysis('static-envelope', 'cmd', executable, suffix.join(' '), null);
    }
    if (['/d', '/s', '/q', '/a', '/u'].includes(option)) continue;
    if (raw.startsWith('/')) {
      return analysis('opaque', 'cmd', executable, null, `unsupported cmd option "${raw}" is ambiguous`);
    }
    return analysis('opaque', 'cmd', executable, null, 'cmd script files or implicit input cannot be inspected');
  }
  return analysis('opaque', 'cmd', executable, null, 'cmd invocation has no literal /c script');
}

function inspectScriptCommand(
  original: readonly Token[],
  envelope: Exclude<ShellEnvelope, 'direct'>,
  depth: number,
): {
  readonly issue: { readonly state: 'opaque' | 'malformed'; readonly reason: string } | null;
  readonly hard: DangerousInvocation | null;
  readonly background: DangerousInvocation | null;
} {
  if (original.length === 0) return scriptInspection();
  if (original.some((token) => token.executesDynamic)) {
    return scriptIssue('opaque', 'command substitution inside the script cannot be inspected safely');
  }
  if (envelope === 'cmd' && original.some((token) => token.dynamic)) {
    return scriptIssue('opaque', 'cmd variable expansion can inject commands after inspection');
  }

  if (envelope === 'powershell') return inspectPowerShellCommand(original, depth);
  if (envelope === 'bash') return inspectBashCommand(original, depth);
  return inspectCmdCommand(original, depth);
}

function inspectPowerShellCommand(
  tokens: readonly Token[],
  depth: number,
): ReturnType<typeof inspectScriptCommand> {
  const first = tokens[0];
  if (!first) return scriptInspection();

  if (first.value === '&' || first.value === '.') {
    const target = tokens[1];
    if (!target) return scriptIssue('malformed', 'PowerShell call operator needs a target');
    if (target.dynamic || target.executesDynamic || !target.value.trim()) {
      return scriptIssue('opaque', 'non-literal PowerShell call operators cannot be inspected');
    }
    if (first.value === '.' || isScriptFile(target.value)) {
      return scriptIssue('opaque', 'PowerShell script-file invocation cannot be inspected');
    }
    return fromNestedInspection(inspectInvocation(tokens.slice(1).map((token) => token.value), depth + 1));
  }

  // A quoted string or a bare variable is an expression in PowerShell, not an invocation.
  if (first.quoted || first.dynamic) return scriptInspection();
  const command = commandName(first.value);
  if (!command || POWERSHELL_KEYWORDS.has(command)) return scriptInspection();
  if (command === 'invoke-expression' || command === 'iex') {
    return scriptIssue('opaque', 'dynamic Invoke-Expression input cannot be inspected');
  }
  if (command === 'start-process' || command === 'saps') {
    return inspectStartProcess(tokens, depth);
  }

  return fromNestedInspection(inspectInvocation(tokens.map((token) => token.value), depth + 1));
}

function inspectStartProcess(
  tokens: readonly Token[],
  depth: number,
): ReturnType<typeof inspectScriptCommand> {
  for (let index = 1; index < tokens.length; index += 1) {
    const option = tokens[index]?.value.replace(/^-+/, '').toLowerCase() ?? '';
    if (isPrefix(option, 'verb')) {
      const verb = tokens[index + 1];
      if (!verb || verb.dynamic || /^runas(?:user)?$/i.test(verb.value)) {
        return scriptIssue('opaque', 'PowerShell elevation through Start-Process is not permitted');
      }
    }
  }

  let target: Token | undefined;
  let targetIndex = -1;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const option = token.value.replace(/^-+/, '').toLowerCase();
    if (token.value.startsWith('-')) {
      if (isPrefix(option, 'filepath')) {
        target = tokens[index + 1];
        targetIndex = index + 1;
        break;
      }
      if (START_PROCESS_VALUE_OPTIONS.some((name) => isPrefix(option, name))) index += 1;
      continue;
    }
    target = token;
    targetIndex = index;
    break;
  }

  if (!target) return scriptIssue('malformed', 'Start-Process needs a literal executable');
  if (target.dynamic || target.executesDynamic || !target.value.trim()) {
    return scriptIssue('opaque', 'non-literal Start-Process targets cannot be inspected');
  }
  if (isScriptFile(target.value)) {
    return scriptIssue('opaque', 'Start-Process script-file targets cannot be inspected');
  }

  const argumentList: Token[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const option = tokens[index]?.value.replace(/^-+/, '').toLowerCase() ?? '';
    if (!isPrefix(option, 'argumentlist')) continue;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const value = tokens[cursor];
      if (!value || (value.value.startsWith('-') && cursor !== index + 1)) break;
      argumentList.push(value);
    }
    break;
  }
  if (argumentList.some((token) => token.dynamic || token.executesDynamic)) {
    return scriptIssue('opaque', 'dynamic Start-Process arguments cannot be inspected');
  }

  const nestedArgv = [target.value, ...argumentList.map((token) => token.value)];
  if (isInterpreter(target.value) && argumentList.length === 0) {
    return scriptIssue('opaque', 'Start-Process interpreter arguments cannot be inspected');
  }
  void targetIndex;
  return fromNestedInspection(inspectInvocation(nestedArgv, depth + 1));
}

function inspectBashCommand(
  original: readonly Token[],
  depth: number,
): ReturnType<typeof inspectScriptCommand> {
  let tokens = [...original];
  while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0].value)) tokens.shift();
  if (tokens[0]?.value === '!') tokens.shift();
  if (tokens.length === 0) return scriptInspection();

  const first = tokens[0];
  if (!first) return scriptInspection();
  if (first.dynamic) return scriptIssue('opaque', 'dynamic shell command names cannot be inspected');
  let command = commandName(first.value);

  if (['if', 'while', 'until', 'then'].includes(command)) {
    return inspectBashCommand(tokens.slice(1), depth);
  }
  if (['for', 'case', 'select', 'function'].includes(command)) {
    return scriptIssue('opaque', `shell ${command} constructs require parsing beyond the safe static grammar`);
  }
  if (['else', 'elif', 'fi', 'do', 'done', 'esac'].includes(command) && tokens.length === 1) {
    return scriptInspection();
  }
  if (command === 'eval' || command === 'source' || command === '.') {
    return scriptIssue('opaque', `dynamic shell primitive "${command}" cannot be inspected`);
  }
  if (command === 'xargs') {
    return scriptIssue('opaque', 'xargs constructs commands dynamically and cannot be inspected');
  }

  if (command === 'command' || command === 'builtin') {
    if (tokens[1]?.value.startsWith('-') && /[vV]/.test(tokens[1].value)) return scriptInspection();
    tokens = tokens.slice(1);
    while (tokens[0]?.value.startsWith('-')) tokens.shift();
  } else if (['exec', 'nohup', 'time'].includes(command)) {
    tokens = tokens.slice(1);
    while (tokens[0]?.value.startsWith('-')) tokens.shift();
  } else if (command === 'env') {
    tokens = tokens.slice(1);
    while (tokens[0]?.value.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]?.value ?? '')) {
      tokens.shift();
    }
  }

  if (tokens.length === 0) return scriptInspection();
  if (tokens[0]?.dynamic) return scriptIssue('opaque', 'dynamic shell command names cannot be inspected');
  command = commandName(tokens[0]?.value ?? '');

  if (command === 'find') {
    const execAt = tokens.findIndex((token) => /^-(?:exec|execdir|ok|okdir)$/i.test(token.value));
    if (execAt >= 0 && tokens[execAt + 1]) {
      return inspectBashCommand(tokens.slice(execAt + 1), depth);
    }
  }
  return fromNestedInspection(inspectInvocation(tokens.map((token) => token.value), depth + 1));
}

function inspectCmdCommand(
  original: readonly Token[],
  depth: number,
): ReturnType<typeof inspectScriptCommand> {
  const tokens = [...original];
  if (tokens[0]?.value.startsWith('@')) {
    const first = tokens[0];
    tokens[0] = { ...first, value: first.value.slice(1) };
  }
  const command = commandName(tokens[0]?.value ?? '');
  if (!command || command === 'rem' || command === '::') return scriptInspection();
  if (command === 'call') return scriptIssue('opaque', 'cmd CALL reparses dynamic command text');
  if (command === 'for' || command === 'if') {
    return scriptIssue('opaque', `cmd ${command.toUpperCase()} constructs require dynamic reparsing`);
  }
  if (command === 'start') return scriptIssue('opaque', 'cmd START target parsing is ambiguous');
  return fromNestedInspection(inspectInvocation(tokens.map((token) => token.value), depth + 1));
}

function inspectDirect(argv: readonly string[]): {
  readonly hard: DangerousInvocation | null;
  readonly background: DangerousInvocation | null;
} {
  const command = commandName(argv[0] ?? '');
  const denied = HARD_DENIED_COMMANDS.get(command);
  if (denied) {
    const danger = { command, reason: denied };
    return { hard: danger, background: danger };
  }

  const line = argv.join(' ');
  if (/(?:^|[\\/:])(?:windows[\\/])?(?:system32|syswow64)(?:[\\/]|$)/i.test(line)) {
    const danger = {
      command: command || argv[0] || 'command',
      reason: 'accesses Windows administrative directories outside the jail',
    };
    return { hard: danger, background: danger };
  }

  const destructive = classifyBackgroundDirect(argv, command);
  return { hard: null, background: destructive };
}

function classifyBackgroundDirect(
  argv: readonly string[],
  command: string,
): DangerousInvocation | null {
  const args = argv.slice(1);
  if (command === 'rm' || command === 'rmdir' || command === 'rd') {
    const short = args.filter((arg) => /^-[^-]/.test(arg)).join('').toLowerCase();
    const recursive = short.includes('r') || args.some((arg) => /^--recursive(?:=|$)/i.test(arg));
    const force = short.includes('f') || args.some((arg) => /^--force(?:=|$)/i.test(arg));
    if (recursive && force) return { command, reason: 'recursive force deletion is blocked' };
  }
  if ((command === 'rd' || command === 'rmdir') && args.some((arg) => /^\/s$/i.test(arg))) {
    return { command, reason: 'recursive Windows deletion is blocked' };
  }
  if ((command === 'del' || command === 'erase') && args.some((arg) => /^\/(?:s|q)$/i.test(arg))) {
    return { command, reason: 'recursive Windows deletion is blocked' };
  }
  if (
    ['remove-item', 'remove_directory', 'shred'].includes(command) &&
    args.some((arg) => /^(?:-recurse|--recursive|\/s)$/i.test(arg))
  ) {
    return { command, reason: 'recursive destructive operations are blocked' };
  }

  const line = argv.join(' ');
  if (/(?:disable|stop|delete|remove).*(?:defender|firewall|antivirus|security)/i.test(line)) {
    return { command: command || 'command', reason: 'security control changes are blocked' };
  }
  return null;
}

function lexScript(script: string, envelope: Exclude<ShellEnvelope, 'direct'>): LexResult {
  if (envelope === 'powershell') return lexPowerShell(script);
  if (envelope === 'bash') return lexBash(script);
  return lexCmd(script);
}

function lexPowerShell(script: string): LexResult {
  const state = lexerState();
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < script.length; index += 1) {
    const char = script[index] ?? '';
    const next = script[index + 1] ?? '';
    if (quote) {
      if (char === '`' && quote === '"' && next) {
        state.append(next);
        index += 1;
        continue;
      }
      if (char === quote) {
        if (quote === "'" && next === "'") {
          state.append("'");
          index += 1;
          continue;
        }
        quote = null;
        continue;
      }
      if (quote === '"' && char === '$') {
        state.dynamic();
        if (next === '(') state.executesDynamic();
      }
      state.append(char);
      continue;
    }

    if (char === '<' && next === '#') {
      state.finishToken();
      const end = script.indexOf('#>', index + 2);
      if (end < 0) return { commands: state.commands(), error: 'unterminated PowerShell block comment' };
      index = end + 1;
      continue;
    }
    if (char === '#') {
      state.finishToken();
      while (index + 1 < script.length && !/[\r\n]/.test(script[index + 1] ?? '')) index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      state.quoted();
      quote = char;
      continue;
    }
    if (char === '`' && next) {
      state.append(next);
      index += 1;
      continue;
    }
    if (char === '$') {
      state.dynamic();
      if (next === '(') state.executesDynamic();
      state.append(char);
      continue;
    }
    if (/\s/.test(char)) {
      state.finishToken();
      if (/\r|\n/.test(char)) state.finishCommand();
      continue;
    }
    if (char === '&') {
      state.finishToken();
      if (state.commandLength() === 0) state.addToken('&');
      else state.finishCommand();
      continue;
    }
    if (';|{}()='.includes(char)) {
      state.finishToken();
      state.finishCommand();
      continue;
    }
    if (char === ',') {
      state.finishToken();
      continue;
    }
    state.append(char);
  }

  if (quote) return { commands: state.commands(), error: 'unterminated PowerShell string literal' };
  state.finishToken();
  state.finishCommand();
  return { commands: state.commands(), error: null };
}

function lexBash(script: string): LexResult {
  const state = lexerState();
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < script.length; index += 1) {
    const char = script[index] ?? '';
    const next = script[index + 1] ?? '';
    if (quote) {
      if (char === '\\' && quote === '"' && next) {
        state.append(next);
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && (char === '$' || char === '`')) {
        state.dynamic();
        if (char === '`' || next === '(') state.executesDynamic();
      }
      state.append(char);
      continue;
    }

    if (char === "'" || char === '"') {
      state.quoted();
      quote = char;
      continue;
    }
    if (char === '\\' && next) {
      state.append(next);
      index += 1;
      continue;
    }
    if (char === '#' && state.atTokenBoundary()) {
      while (index + 1 < script.length && !/[\r\n]/.test(script[index + 1] ?? '')) index += 1;
      continue;
    }
    if (char === '$' || char === '`') {
      state.dynamic();
      if (char === '`' || next === '(') state.executesDynamic();
      state.append(char);
      continue;
    }
    if ((char === '<' || char === '>') && next === '(') {
      state.dynamic();
      state.executesDynamic();
      state.append(char);
      continue;
    }
    if (/\s/.test(char)) {
      state.finishToken();
      if (/\r|\n/.test(char)) state.finishCommand();
      continue;
    }
    if (';|&{}()'.includes(char)) {
      state.finishToken();
      state.finishCommand();
      continue;
    }
    state.append(char);
  }

  if (quote) return { commands: state.commands(), error: 'unterminated shell string literal' };
  state.finishToken();
  state.finishCommand();
  return { commands: state.commands(), error: null };
}

function lexCmd(script: string): LexResult {
  const state = lexerState();
  let quoted = false;

  for (let index = 0; index < script.length; index += 1) {
    const char = script[index] ?? '';
    const next = script[index + 1] ?? '';
    if (char === '^' && next) {
      state.append(next);
      index += 1;
      continue;
    }
    if (char === '"') {
      state.quoted();
      quoted = !quoted;
      continue;
    }
    if (char === '%' || char === '!') {
      state.dynamic();
      state.append(char);
      continue;
    }
    if (!quoted && char === ':' && next === ':' && state.atTokenBoundary()) {
      while (index + 1 < script.length && !/[\r\n]/.test(script[index + 1] ?? '')) index += 1;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      state.finishToken();
      if (/\r|\n/.test(char)) state.finishCommand();
      continue;
    }
    if (!quoted && '&|()'.includes(char)) {
      state.finishToken();
      state.finishCommand();
      continue;
    }
    state.append(char);
  }

  if (quoted) return { commands: state.commands(), error: 'unterminated cmd string literal' };
  state.finishToken();
  state.finishCommand();
  return { commands: state.commands(), error: null };
}

function lexerState(): {
  append(value: string): void;
  quoted(): void;
  dynamic(): void;
  executesDynamic(): void;
  finishToken(): void;
  addToken(value: string): void;
  finishCommand(): void;
  commandLength(): number;
  atTokenBoundary(): boolean;
  commands(): readonly (readonly Token[])[];
} {
  const completed: Token[][] = [];
  let command: Token[] = [];
  let value = '';
  let wasQuoted = false;
  let wasDynamic = false;
  let ranDynamic = false;

  const finishToken = (): void => {
    if (!value && !wasQuoted) return;
    command.push({ value, quoted: wasQuoted, dynamic: wasDynamic, executesDynamic: ranDynamic });
    value = '';
    wasQuoted = false;
    wasDynamic = false;
    ranDynamic = false;
  };
  const finishCommand = (): void => {
    finishToken();
    if (command.length > 0) completed.push(command);
    command = [];
  };

  return {
    append(part) { value += part; },
    quoted() { wasQuoted = true; },
    dynamic() { wasDynamic = true; },
    executesDynamic() { ranDynamic = true; },
    finishToken,
    addToken(part) {
      command.push({ value: part, quoted: false, dynamic: false, executesDynamic: false });
    },
    finishCommand,
    commandLength() { return command.length + (value || wasQuoted ? 1 : 0); },
    atTokenBoundary() { return value.length === 0 && !wasQuoted; },
    commands() { return completed; },
  };
}

const POWERSHELL_KEYWORDS = new Set([
  'begin', 'break', 'catch', 'class', 'continue', 'data', 'do', 'dynamicparam',
  'else', 'elseif', 'end', 'enum', 'exit', 'filter', 'finally', 'for', 'foreach',
  'from', 'function', 'if', 'in', 'param', 'process', 'return', 'switch', 'throw',
  'trap', 'try', 'until', 'using', 'while', 'workflow',
]);

const START_PROCESS_VALUE_OPTIONS = [
  'argumentlist',
  'credential',
  'redirectstandarderror',
  'redirectstandardinput',
  'redirectstandardoutput',
  'verb',
  'windowstyle',
  'workingdirectory',
];

function isPowerShellOption(candidate: string, full: string): boolean {
  // PowerShell accepts abbreviated native switches. A single e/f/c is enough
  // to become security-sensitive, so ambiguous abbreviations fail closed.
  return candidate.length > 0 && full.startsWith(candidate);
}

function isPrefix(candidate: string, full: string): boolean {
  return candidate.length > 0 && full.startsWith(candidate);
}

function isInterpreter(value: string): boolean {
  const command = commandName(value);
  return POWERSHELL_NAMES.has(command) || BASH_NAMES.has(command) || CMD_NAMES.has(command);
}

function isScriptFile(value: string): boolean {
  return /\.(?:ps1|psm1|psd1|bat|cmd|sh|bash)$/i.test(value);
}

function commandName(value: string): string {
  const bare = value.trim().replace(/^['"]|['"]$/g, '').split(/[\\/]/).at(-1) ?? '';
  return bare.replace(/\.(?:exe|com|cmd|bat|ps1)$/i, '').toLowerCase();
}

function analysis(
  state: ShellInvocationState,
  envelope: ShellEnvelope,
  executable: string,
  script: string | null,
  reason: string | null,
): ShellInvocationAnalysis {
  return {
    state,
    kind: state,
    envelope,
    executable,
    script,
    reason,
    malformed: state === 'malformed' ? reason : null,
  };
}

function issueAnalysis(
  base: ShellInvocationAnalysis,
  state: 'opaque' | 'malformed',
  reason: string,
): ShellInvocationAnalysis {
  return analysis(state, base.envelope, base.executable, base.script, reason);
}

function unsafeEnvelope(value: ShellInvocationAnalysis): DangerousInvocation {
  return {
    command: commandName(value.executable) || value.envelope,
    reason: `${value.state} ${value.envelope} envelope: ${value.reason ?? 'static inspection failed'}`,
  };
}

function scriptInspection(
  hard: DangerousInvocation | null = null,
  background: DangerousInvocation | null = hard,
): ReturnType<typeof inspectScriptCommand> {
  return { issue: null, hard, background };
}

function scriptIssue(
  state: 'opaque' | 'malformed',
  reason: string,
): ReturnType<typeof inspectScriptCommand> {
  return { issue: { state, reason }, hard: null, background: null };
}

function fromNestedInspection(value: Inspection): ReturnType<typeof inspectScriptCommand> {
  if (value.analysis.state === 'opaque' || value.analysis.state === 'malformed') {
    return scriptIssue(value.analysis.state, value.analysis.reason ?? 'nested envelope is not inspectable');
  }
  return scriptInspection(value.hard, value.background);
}
