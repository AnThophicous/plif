/**
 * Resolving which model to talk to, and with what credentials.
 *
 * Precedence, highest first: explicit argument, environment, config file,
 * built-in default. Environment beats the file so that a shell can override a
 * saved default for one run without editing anything — which is what CI and
 * `PLIF_MODEL=... plif prompt ...` both need.
 *
 * ## On secrets
 *
 * The API key is the one field that must never be printed. `describe()` exists
 * so that every place wanting to *show* the configuration gets a redacted view
 * by construction, rather than each call site remembering to redact. A key that
 * leaks into a log or a transcript is a key that has to be rotated.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';
import { globalConfigPath, loadGlobalConfig, saveGlobalConfig } from '../config/global.js';
import type { StorePaths } from '../store/paths.js';

export interface ModelConfig {
  /** Model id as the endpoint knows it, e.g. "gpt-4o-mini", "llama3.1:8b". */
  readonly model: string;
  /** OpenAI-compatible base URL, including `/v1` where the server expects it. */
  readonly baseURL: string;
  readonly apiKey: string;
  readonly temperature: number;
  readonly maxTokens: number | undefined;
  /** Seconds before a request is abandoned. */
  readonly timeoutMs: number;
  readonly effort?: Effort;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Endpoints known to speak the OpenAI wire format.
 *
 * Not an exhaustive registry — just enough that the common local setups work
 * with one flag instead of a URL nobody remembers. Anything missing still works
 * via `--base-url`; that is the whole benefit of a standard wire format.
 */
export const PRESETS: Readonly<Record<string, { baseURL: string; keyEnv: string; note: string }>> =
  Object.freeze({
    openai: {
      baseURL: 'https://api.openai.com/v1',
      keyEnv: 'OPENAI_API_KEY',
      note: 'OpenAI',
    },
    ollama: {
      // Local models need no key, but the SDK insists on a non-empty string.
      baseURL: 'http://127.0.0.1:11434/v1',
      keyEnv: 'OLLAMA_API_KEY',
      note: 'Ollama, running locally',
    },
    lmstudio: {
      baseURL: 'http://127.0.0.1:1234/v1',
      keyEnv: 'LMSTUDIO_API_KEY',
      note: 'LM Studio, running locally',
    },
    // OpenCode Zen. Its free tier costs nothing per token, which makes it the
    // most useful preset here for trying things out. The `go` endpoint is the
    // paid sibling with much larger context.
    opencode: {
      baseURL: 'https://opencode.ai/zen/v1',
      keyEnv: 'OPENCODE_API_KEY',
      note: 'OpenCode Zen — has free models',
    },
    'opencode-go': {
      baseURL: 'https://opencode.ai/zen/go/v1',
      keyEnv: 'OPENCODE_API_KEY',
      note: 'OpenCode Go — paid, 1M context',
    },
    openrouter: {
      baseURL: 'https://openrouter.ai/api/v1',
      keyEnv: 'OPENROUTER_API_KEY',
      note: 'OpenRouter',
    },
    groq: {
      baseURL: 'https://api.groq.com/openai/v1',
      keyEnv: 'GROQ_API_KEY',
      note: 'Groq',
    },
    deepseek: {
      baseURL: 'https://api.deepseek.com/v1',
      keyEnv: 'DEEPSEEK_API_KEY',
      note: 'DeepSeek',
    },
    together: {
      baseURL: 'https://api.together.xyz/v1',
      keyEnv: 'TOGETHER_API_KEY',
      note: 'Together AI',
    },
  });

export type PresetName = keyof typeof PRESETS;

export interface ModelRef {
  readonly preset: string | undefined;
  readonly model: string;
}

/**
 * Read `"opencode/deepseek-v4-flash-free"` as provider plus model.
 *
 * The single-string form is what OpenCode uses and what people already have in
 * their fingers, and it is the only form in which one value fully identifies a
 * model — which is what makes `"model": "..."` in a config file, or a model id
 * typed at a subagent, unambiguous.
 *
 * Split on the *first* slash only, and only when the head names a preset we
 * know. Plenty of real model ids contain slashes —
 * `meta-llama/Llama-3.3-70B-Instruct-Turbo` is one string, not a provider and a
 * model — so an unrecognised head means the whole thing is the id.
 */
export function parseModelRef(ref: string, providers?: Readonly<Record<string, CustomProvider>>): ModelRef {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return { preset: undefined, model: trimmed };

  const head = trimmed.slice(0, slash);
  if (!(head in PRESETS) && !(head in (providers ?? {}))) return { preset: undefined, model: trimmed };
  return { preset: head, model: trimmed.slice(slash + 1) };
}

/** The inverse, for writing a ref back out. */
export function formatModelRef(preset: string | undefined, model: string): string {
  return preset ? `${preset}/${model}` : model;
}

/** What lives in `<root>/config.json`. Every field optional. */
export interface StoredConfig {
  readonly model?: string;
  readonly small_model?: string;
  readonly baseURL?: string;
  readonly preset?: string;
  readonly apiKey?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly effort?: Effort;
  readonly autoApprove?: boolean;
  readonly mcpServers?: unknown;
  readonly providers?: unknown;
  readonly provider?: unknown;
  readonly models?: unknown;
  readonly context?: unknown;
  /** A provider-qualified model explicitly chosen for future vision requests. */
  readonly visionModel?: string;
  readonly theme?: string;
  readonly [key: string]: unknown;
}

export interface CustomProviderModel {
  readonly name?: string;
  readonly contextWindow?: number;
  /** Explicit capability declaration; an endpoint model id is not evidence. */
  readonly modalities?: readonly ModelCapability[];
  /** Price is displayed before a vision subagent is allowed to start. */
  readonly cost?: ModelCost;
  readonly [key: string]: unknown;
}

export type ModelCapability = 'text' | 'image';
export type ModelCost = 'free' | 'paid' | 'unknown';

export interface CustomProvider {
  /** Plif custom providers all use the OpenAI-compatible adapter. */
  readonly sdk?: 'openai';
  readonly npm?: string;
  readonly name?: string;
  readonly options?: {
    readonly baseURL?: string;
    readonly apiKey?: string;
    readonly [key: string]: unknown;
  };
  readonly models?: Readonly<Record<string, CustomProviderModel>>;
}

export interface VisionCandidate {
  readonly provider: string;
  readonly model: string;
  readonly label: string;
  readonly baseURL: string;
  readonly cost: ModelCost;
  readonly recommended: boolean;
}

/**
 * Models an endpoint happens to list are deliberately absent here. A model is
 * safe to offer for image inspection only when its configuration declares it.
 */
export function visionCandidates(config: StoredConfig): readonly VisionCandidate[] {
  const providers = {
    ...asCustomProviders(config.providers),
    ...asCustomProviders(config.provider),
  };
  return Object.entries(providers).flatMap(([provider, entry]) =>
    Object.entries(entry.models ?? {}).flatMap(([model, metadata]) => {
      if (!metadata.modalities?.includes('image')) return [];
      return [{
        provider,
        model,
        label: metadata.name ?? model,
        baseURL: entry.options?.baseURL ?? '',
        cost: metadata.cost ?? 'unknown',
        recommended: metadata.cost === 'free',
      }];
    }),
  );
}

export interface ResolveOptions {
  /** Overrides from the command line. Highest precedence. */
  readonly model?: string;
  readonly baseURL?: string;
  readonly preset?: string;
  readonly apiKey?: string;
  /** Injected in tests so resolution can be checked without touching the real env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const DEFAULTS = {
  preset: 'opencode',
  model: 'deepseek-v4-flash-free',
  temperature: 0.2,
  timeoutMs: 120_000,
} as const;

export async function loadStoredConfig(paths: StorePaths): Promise<StoredConfig> {
  void paths;
  return (await loadGlobalConfig()) as StoredConfig;
  /* legacy project-local config path retained below for source compatibility */
  const file = path.join(paths.root, 'config.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    // A UTF-8 BOM is invisible and makes JSON.parse fail on the first character.
    // Windows tooling writes one by default — PowerShell's Set-Content does —
    // so a config file that looks perfect is rejected with a message about
    // position 0 that helps nobody.
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) as StoredConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new PlifError('INVALID_ARGUMENT', 'config.json could not be parsed', {
      cause: error,
      detail: { file },
      hint: 'Fix the JSON, or delete the file to fall back to environment variables.',
    });
  }
}

export async function saveStoredConfig(
  paths: StorePaths,
  config: StoredConfig,
): Promise<void> {
  void paths;
  await saveGlobalConfig(config, globalConfigPath());
  return;
  /* legacy project-local config path retained below for source compatibility */
  const file = path.join(paths.root, 'config.json');
  await fs.mkdir(paths.root, { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(config, null, 2), 'utf8');
  await fs.rename(temp, file);
  // Best effort on POSIX; a no-op on Windows, where the store already sits in
  // the user profile and inherits its ACL.
  await fs.chmod(file, 0o600).catch(() => undefined);
}

/**
 * Merge the layers into a usable configuration.
 *
 * Throws only when there is genuinely nothing to talk to. A missing key is
 * *not* fatal for a local endpoint — Ollama and LM Studio accept any string —
 * so the check is on the URL, and the key gets a placeholder rather than an
 * error the user cannot act on.
 */
export function resolveConfig(
  stored: StoredConfig,
  options: ResolveOptions = {},
): ModelConfig {
  const env = options.env ?? process.env;

  // A ref carries its own provider, so it overrides the separate `preset` —
  // otherwise `"model": "groq/llama-3.3-70b-versatile"` next to a stale
  // `"preset": "openai"` would send a Groq model id to OpenAI and 404.
  const customProviders = {
    ...asCustomProviders(stored.providers),
    ...asCustomProviders(stored.provider),
  };
  const ref = parseModelRef(
    options.model ?? env['PLIF_MODEL'] ?? stored.model ?? DEFAULTS.model,
    customProviders,
  );

  const presetName =
    ref.preset ?? options.preset ?? env['PLIF_PRESET'] ?? stored.preset ?? DEFAULTS.preset;
  const preset = presetName ? PRESETS[presetName] : undefined;
  const custom = presetName ? customProviders[presetName] : undefined;
  if (presetName && !preset && !custom) {
    throw new PlifError('INVALID_ARGUMENT', `unknown preset "${presetName}"`, {
      detail: { known: Object.keys(PRESETS) },
      hint: `Try one of: ${Object.keys(PRESETS).join(', ')} — or pass --base-url directly.`,
    });
  }

  const baseURL =
    options.baseURL ??
    env['PLIF_BASE_URL'] ??
    env['OPENAI_BASE_URL'] ??
    stored.baseURL ??
    preset?.baseURL ??
    custom?.options?.baseURL ??
    PRESETS['openai']!.baseURL;

  const model = ref.model;

  // Try the preset's own key variable before the generic one, so switching
  // preset picks up the right credential without renaming anything.
  const apiKey =
    options.apiKey ??
    (preset ? env[preset.keyEnv] : undefined) ??
    env['PLIF_API_KEY'] ??
    // The generic variable is the right fallback for an endpoint that needs a
    // credential, and exactly the wrong one for an endpoint that does not: an
    // OpenAI key sent to Zen's free tier is not ignored, it is *rejected*. A
    // developer who happens to have OPENAI_API_KEY exported would otherwise
    // find the free models broken for a reason nothing on screen explains.
    (keyOptional(baseURL, model) ? undefined : env['OPENAI_API_KEY']) ??
    custom?.options?.apiKey ??
    stored.apiKey ??
    // Local servers ignore the value but the SDK refuses an empty one.
    (isLocal(baseURL) ? 'local' : '');

  return {
    model,
    baseURL,
    apiKey,
    temperature: numberFrom(env['PLIF_TEMPERATURE']) ?? stored.temperature ?? DEFAULTS.temperature,
    maxTokens: numberFrom(env['PLIF_MAX_TOKENS']) ?? stored.maxTokens,
    timeoutMs: numberFrom(env['PLIF_TIMEOUT_MS']) ?? stored.timeoutMs ?? DEFAULTS.timeoutMs,
    effort: stored.effort,
  };
}

function asCustomProviders(value: unknown): Record<string, CustomProvider> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry && typeof entry === 'object'),
  ) as Record<string, CustomProvider>;
}

/**
 * Hosts that serve some models to anonymous callers.
 *
 * Only OpenCode Zen so far. Its `-free` tier answers a request with no
 * `Authorization` header at all, and bills `"cost": "0"` for it.
 */
const ANONYMOUS_HOSTS: ReadonlySet<string> = new Set(['opencode.ai']);

/**
 * Does this model cost nothing and need no account?
 *
 * The suffix is the contract Zen publishes — `deepseek-v4-flash-free`,
 * `ling-3.0-flash-free` — and it is the only signal available before a request
 * is made. It is a naming convention rather than a guarantee, so nothing here
 * *depends* on it being right: at worst the endpoint answers 401 and the error
 * path says which key to set, which is where an unconfigured model ends up
 * anyway.
 */
export function isFreeModel(model: string): boolean {
  return model.endsWith('-free');
}

/**
 * Can this configuration run without a credential?
 *
 * True for loopback servers, and for a free model on a host that serves them
 * anonymously. Everything else needs a key, and saying so early is kinder than
 * a 401 three seconds into the first turn.
 */
export function keyOptional(baseURL: string, model: string): boolean {
  if (isLocal(baseURL)) return true;
  if (!isFreeModel(model)) return false;
  try {
    return ANONYMOUS_HOSTS.has(new URL(baseURL).hostname);
  } catch {
    return false;
  }
}

/** True for loopback endpoints, which never need a real credential. */
export function isLocal(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
  } catch {
    return false;
  }
}

/**
 * Is this configuration usable, and if not, what is missing?
 *
 * Separate from `resolveConfig` so the CLI can *show* a broken configuration
 * instead of throwing while trying to display it.
 */
export function validate(config: ModelConfig): { ok: boolean; problem?: string; hint?: string } {
  try {
    new URL(config.baseURL);
  } catch {
    return {
      ok: false,
      problem: `"${config.baseURL}" is not a valid URL`,
      hint: 'Set PLIF_BASE_URL, or pick a preset with --preset.',
    };
  }
  if (!config.model) {
    return { ok: false, problem: 'no model id', hint: 'Set PLIF_MODEL or run /model set <id>.' };
  }
  if (!config.apiKey && !keyOptional(config.baseURL, config.model)) {
    return {
      ok: false,
      problem: 'no API key for a remote endpoint',
      hint: `Set ${
        Object.values(PRESETS).find((p) => config.baseURL.startsWith(p.baseURL))?.keyEnv ??
        'OPENAI_API_KEY'
      }, or point --base-url at a local server.`,
    };
  }
  return { ok: true };
}

/**
 * A view safe to print, log, or put in a transcript.
 *
 * The key is reduced to its shape — enough to tell "the wrong key is loaded"
 * from "no key is loaded", which is the only diagnostic anyone needs from it.
 */
export function describe(config: ModelConfig): Record<string, string> {
  return {
    model: config.model,
    endpoint: config.baseURL,
    key:
      config.apiKey || !keyOptional(config.baseURL, config.model)
        ? redact(config.apiKey)
        : '(not required — free model)',
    temperature: String(config.temperature),
    maxTokens: config.maxTokens === undefined ? '(model default)' : String(config.maxTokens),
    effort: config.effort ?? '(default)',
  };
}

export function redact(key: string): string {
  if (!key) return '(none)';
  if (key === 'local') return '(not required — local endpoint)';
  if (key.length <= 8) return '(set)';
  return `${key.slice(0, 3)}…${key.slice(-4)} (${key.length} chars)`;
}

function numberFrom(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
