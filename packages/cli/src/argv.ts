/**
 * The command line.
 *
 * The shape is `plif [command] [args...] [flags]`, where omitting the command
 * opens the interactive session — because that is what someone typing `plif`
 * with no arguments almost always wants, and making them type `plif chat` to
 * get it is a tax on the common case.
 *
 * Parsing is done here, entirely, and returns a discriminated union. The rest
 * of the CLI branches on `kind` and never re-reads `process.argv`, so there is
 * exactly one place where "what did the user ask for" is decided.
 */

import path from 'node:path';

export interface GlobalFlags {
  /** Override the store location. Defaults to `~/.plif`. */
  readonly root: string | undefined;
  /** Use the strict policy: untrusted tier, nothing pre-approved. */
  readonly strict: boolean;
  /** Machine-readable output, for scripts and CI. */
  readonly json: boolean;
  /** The workspace whose sessions we are talking about. Defaults to cwd. */
  readonly workspace: string;
  /** Model id override, beating the environment and the stored config. */
  readonly model: string | undefined;
  /** OpenAI-compatible endpoint override. */
  readonly baseURL: string | undefined;
  /** Named endpoint preset: openai, ollama, lmstudio, openrouter, groq… */
  readonly preset: string | undefined;
  /** Persist this key with `model set`. Otherwise the key stays in the env. */
  readonly apiKey: string | undefined;
  /**
   * Let the agent write through to the real workspace.
   *
   * Off by default: a one-shot question should never be able to edit the
   * project as a side effect of being asked.
   */
  readonly write: boolean;
  /**
   * Approve automatically in non-interactive runs.
   *
   * Without it, anything the policy escalates is denied — because there is
   * nobody to ask, and silently waiting five minutes for a timeout is worse
   * than a clear refusal.
   */
  readonly yes: boolean;
}

export type Invocation =
  /** `plif` — open the interactive session. */
  | { readonly kind: 'interactive'; readonly flags: GlobalFlags; readonly resume: string | null }
  /** `plif prompt "..."` — one turn, print the answer, exit. */
  | { readonly kind: 'prompt'; readonly flags: GlobalFlags; readonly text: string }
  /** `plif continue [id]` — reopen a specific session, or the most recent one. */
  | { readonly kind: 'continue'; readonly flags: GlobalFlags; readonly id: string | null }
  /** `plif resume <id>` — reopen a specific session. */
  | { readonly kind: 'resume'; readonly flags: GlobalFlags; readonly id: string }
  /** `plif sessions` — list this folder's conversations. */
  | { readonly kind: 'sessions'; readonly flags: GlobalFlags; readonly all: boolean }
  /** `plif sandbox` — report what the sandbox enforces, then exit. */
  | { readonly kind: 'sandbox'; readonly flags: GlobalFlags }
  /** `plif model [show|list|check|set]` — inspect or pin the model config. */
  | {
      readonly kind: 'model';
      readonly flags: GlobalFlags;
      readonly action: ModelAction;
    }
  | { readonly kind: 'skills'; readonly flags: GlobalFlags }
  | { readonly kind: 'mcp'; readonly flags: GlobalFlags }
  | { readonly kind: 'help'; readonly topic: string | null }
  | { readonly kind: 'version' }
  | { readonly kind: 'error'; readonly message: string; readonly hint?: string };

const COMMANDS = [
  'prompt',
  'continue',
  'resume',
  'sessions',
  'sandbox',
  'model',
  'skills',
  'mcp',
  'help',
  'version',
] as const;

const MODEL_ACTIONS = ['show', 'list', 'check', 'set'] as const;
export type ModelAction = (typeof MODEL_ACTIONS)[number];

function isModelAction(value: string): value is ModelAction {
  return (MODEL_ACTIONS as readonly string[]).includes(value);
}

type CommandName = (typeof COMMANDS)[number];

function isCommand(value: string): value is CommandName {
  return (COMMANDS as readonly string[]).includes(value);
}

/**
 * Split argv into flags and positionals.
 *
 * Supports `--key value`, `--key=value`, bare `--flag`, and the `--` terminator
 * after which everything is positional. It does not support clustered short
 * flags (`-abc`), because this surface has no short flags worth clustering and
 * supporting it invites ambiguity with negative numbers in prompts.
 */
function partition(argv: readonly string[]): {
  positional: string[];
  flags: Map<string, string | true>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  let terminated = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;

    if (terminated) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      terminated = true;
      continue;
    }
    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }

    const bare = token.replace(/^--?/, '');
    const equals = bare.indexOf('=');
    if (equals !== -1) {
      flags.set(bare.slice(0, equals), bare.slice(equals + 1));
      continue;
    }

    const next = argv[index + 1];
    // A flag takes a value only if the next token is not itself a flag. This is
    // what lets `plif sessions --all` and `plif --root /tmp` both work without
    // a per-flag arity table.
    if (VALUED_FLAGS.has(bare) && next !== undefined && !next.startsWith('-')) {
      flags.set(bare, next);
      index += 1;
    } else {
      flags.set(bare, true);
    }
  }

  return { positional, flags };
}

/** Read a flag only when it carried a value, not when it was passed bare. */
function stringFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

/** Flags that consume the following token. Everything else is boolean. */
const VALUED_FLAGS = new Set(['root', 'workspace', 'C', 'model', 'base-url', 'preset', 'api-key']);

export function parseArgv(argv: readonly string[], cwd: string): Invocation {
  const { positional, flags } = partition(argv);

  const workspaceFlag = flags.get('workspace') ?? flags.get('C');
  const flagSet: GlobalFlags = {
    root: typeof flags.get('root') === 'string' ? (flags.get('root') as string) : undefined,
    strict: flags.get('strict') === true,
    json: flags.get('json') === true,
    workspace: typeof workspaceFlag === 'string' ? path.resolve(cwd, workspaceFlag) : cwd,
    model: stringFlag(flags, 'model'),
    baseURL: stringFlag(flags, 'base-url'),
    preset: stringFlag(flags, 'preset'),
    apiKey: stringFlag(flags, 'api-key'),
    write: flags.get('write') === true,
    yes: flags.get('yes') === true || flags.get('y') === true,
  };

  if (flags.get('version') === true || flags.get('v') === true) return { kind: 'version' };
  if (flags.get('help') === true || flags.get('h') === true) {
    return { kind: 'help', topic: positional[0] ?? null };
  }

  const [first, ...rest] = positional;

  if (first === undefined) {
    return { kind: 'interactive', flags: flagSet, resume: null };
  }

  if (!isCommand(first)) {
    // A bare word that is not a command is almost always a prompt someone
    // forgot to quote or to prefix. Say so, rather than a generic parse error.
    return {
      kind: 'error',
      message: `unknown command "${first}"`,
      hint: `Did you mean: plif prompt "${positional.join(' ')}"`,
    };
  }

  switch (first) {
    case 'prompt': {
      const text = rest.join(' ').trim();
      if (!text) {
        return {
          kind: 'error',
          message: 'plif prompt needs something to say',
          hint: 'plif prompt "why is the build slow?"',
        };
      }
      return { kind: 'prompt', flags: flagSet, text };
    }

    case 'continue':
      return { kind: 'continue', flags: flagSet, id: rest[0] ?? null };

    case 'resume': {
      const id = rest[0];
      if (!id) {
        return {
          kind: 'error',
          message: 'plif resume needs a session id',
          hint: 'Run `plif sessions` to see the ids for this folder.',
        };
      }
      return { kind: 'resume', flags: flagSet, id };
    }

    case 'sessions':
      return { kind: 'sessions', flags: flagSet, all: flags.get('all') === true };

    case 'sandbox':
      return { kind: 'sandbox', flags: flagSet };

    case 'skills':
      return { kind: 'skills', flags: flagSet };

    case 'mcp':
      return { kind: 'mcp', flags: flagSet };

    case 'model': {
      // Bare `plif model` shows the resolved configuration, which is what
      // someone typing it almost always wants to know.
      const action = rest[0] ?? 'show';
      if (!isModelAction(action)) {
        return {
          kind: 'error',
          message: `unknown model action "${action}"`,
          hint: `Use one of: ${MODEL_ACTIONS.join(', ')}`,
        };
      }
      return { kind: 'model', flags: flagSet, action };
    }

    case 'help':
      return { kind: 'help', topic: rest[0] ?? null };

    case 'version':
      return { kind: 'version' };
  }
}

export const USAGE = `
plif — container-native AI agent core

  plif                          Open an interactive session in this folder
  plif prompt "<text>"          Ask one question, print the answer, exit
  plif continue [id]            Reopen a specific session, or the latest one
  plif resume <id>              Reopen a specific session
  plif sessions [--all]         List conversations recorded for this folder
  plif sandbox                  Report what the sandbox actually enforces
  plif skills                   List skills available in this folder
  plif mcp                      Connect to configured MCP servers and report
  plif model [show|list|check|set]
                                Inspect, test or pin the model configuration
  plif help [topic]             Show this, or detail on a topic
  plif version

Flags
  --root <dir>                  Store location (default: ~/.plif)
  --workspace <dir>, -C <dir>   Act as if run from another folder
  --model <id>                  Model id for this run
  --base-url <url>              OpenAI-compatible endpoint for this run
  --preset <name>               opencode | openai | ollama | lmstudio |
                                openrouter | groq | deepseek | together
  --write                       Let the agent modify the real workspace
  --yes, -y                     Auto-approve in non-interactive runs
                                (without it, escalated actions are denied)
  --api-key <key>               Persist a key with "model set" in the encrypted
                                credential store; otherwise keep it in the env
  --strict                      Untrusted trust tier; refuses weak isolation
  --json                        Machine-readable output

Sessions are scoped to the folder you were in when you started talking. Run
plif in ~/Projetos/Callback, have a conversation, come back tomorrow, and
\`plif continue\` puts you back in it. Pass an id or id prefix to reopen a
specific session instead. A different project has its own history.
`;

export const HELP_TOPICS: Readonly<Record<string, string>> = {
  sessions: `
plif sessions — conversations, scoped to a folder

A session is everything you said and everything the agent did, recorded as it
happened. It belongs to the directory you were in when you started, so the
history you get is the history of *this* project.

  plif sessions          List this folder's sessions, newest first
  plif sessions --all    List every folder that has sessions
  plif continue [id]     Reopen a specific one, or the latest one here
  plif resume <id>       Reopen a specific one (id prefixes work)

The store itself is global (~/.plif) so that image layers deduplicate across
projects. Only the conversations are scoped.
`,
  sandbox: `
plif sandbox — what is actually enforced

Isolation is reported, never assumed. This prints the real capabilities of the
backend on this machine, and every gap it has.

Trust tiers each demand a minimum, and the runtime refuses to start below it:

  trusted        any backend
  semi-trusted   job-level confinement (Windows Job Object, Linux cgroup)
  untrusted      kernel namespaces or a microVM

--strict selects the untrusted tier, so it will refuse to run on a machine that
cannot confine properly. That refusal is the feature.
`,
};
