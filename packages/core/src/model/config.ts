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

import { createHash } from 'node:crypto';

import { PlifError } from '../errors.js';
import { globalConfigPath, loadGlobalConfig, saveGlobalConfig } from '../config/global.js';
import type { StorePaths } from '../store/paths.js';

export interface ModelConfig {
  /** Model id as the endpoint knows it, e.g. "gpt-4o-mini", "llama3.1:8b". */
  readonly model: string;
  /** OpenAI-compatible base URL, including `/v1` where the server expects it. */
  readonly baseURL: string;
  readonly apiKey: string;
  /** Explicit credential requirement; also true for ordinary paid remotes. */
  readonly needKey?: boolean;
  readonly temperature: number;
  readonly maxTokens: number | undefined;
  /** Declared model capacity, when the custom catalogue knows it. */
  readonly contextWindow: number | undefined;
  /** Seconds before a request is abandoned. */
  readonly timeoutMs: number;
  readonly effort?: Effort;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'ultracode' | 'plif';

/** Ordered UI levels. Higher entries are deliberately opt-in by provider. */
export const EFFORT_LEVELS: readonly Effort[] = Object.freeze([
  'low', 'medium', 'high', 'xhigh', 'ultra', 'ultracode', 'max', 'plif',
]);

/**
 * Return the levels that make sense for this endpoint/model combination.
 * Plif is always available: it negotiates the strongest wire level the
 * provider accepts. Ultra is reserved for the GPT Sol 5.6 family, while
 * UltraCode is reserved for Claude/Anthropic models.
 */
export function supportedEfforts(baseURL: string, model: string): readonly Effort[] {
  const endpoint = baseURL.toLowerCase();
  const modelId = model.toLowerCase();
  const base: Effort[] = ['low', 'medium', 'high', 'xhigh'];
  if (endpoint.includes('anthropic.com') || endpoint.includes('claude') || modelId.includes('claude')) {
    return [...base, 'ultracode', 'max', 'plif'];
  }
  if ((endpoint.includes('openai.com') || endpoint.includes('chatgpt')) &&
      /(?:gpt[-_ ]?sol|gpt[-_ ]?5\.6|sol[-_ ]?5\.6)/i.test(modelId) &&
      !modelId.includes('claude')) {
    return [...base, 'ultra', 'max', 'plif'];
  }
  return [...base, 'max', 'plif'];
}

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
    nvidia: {
      baseURL: 'https://integrate.api.nvidia.com/v1',
      keyEnv: 'NIM_API_KEY',
      note: 'NVIDIA NIM — hosted open models',
    },
    // Anthropic is the one preset here that is not OpenAI-shaped on the wire.
    // The base URL is still recorded because everything that *displays* a
    // provider reads it, and the adapter is chosen from the host.
    anthropic: {
      baseURL: 'https://api.anthropic.com/v1',
      keyEnv: 'ANTHROPIC_API_KEY',
      note: 'Anthropic — Claude, via the official SDK',
    },
    google: {
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      keyEnv: 'GEMINI_API_KEY',
      note: 'Google Gemini',
    },
    xai: {
      baseURL: 'https://api.x.ai/v1',
      keyEnv: 'XAI_API_KEY',
      note: 'xAI Grok',
    },
    mistral: {
      baseURL: 'https://api.mistral.ai/v1',
      keyEnv: 'MISTRAL_API_KEY',
      note: 'Mistral AI',
    },
    cerebras: {
      baseURL: 'https://api.cerebras.ai/v1',
      keyEnv: 'CEREBRAS_API_KEY',
      note: 'Cerebras — very fast inference',
    },
    fireworks: {
      baseURL: 'https://api.fireworks.ai/inference/v1',
      keyEnv: 'FIREWORKS_API_KEY',
      note: 'Fireworks AI',
    },
    zai: {
      baseURL: 'https://api.z.ai/api/paas/v4',
      keyEnv: 'ZAI_API_KEY',
      note: 'Z.AI — GLM family',
    },
    moonshot: {
      baseURL: 'https://api.moonshot.ai/v1',
      keyEnv: 'MOONSHOT_API_KEY',
      note: 'Moonshot AI — Kimi',
    },
    perplexity: {
      baseURL: 'https://api.perplexity.ai',
      keyEnv: 'PERPLEXITY_API_KEY',
      note: 'Perplexity — search-grounded models',
    },
    hyperbolic: {
      baseURL: 'https://api.hyperbolic.xyz/v1',
      keyEnv: 'HYPERBOLIC_API_KEY',
      note: 'Hyperbolic — hosted open models',
    },
    sambanova: {
      baseURL: 'https://api.sambanova.ai/v1',
      keyEnv: 'SAMBANOVA_API_KEY',
      note: 'SambaNova Cloud',
    },
  });

export type PresetName = keyof typeof PRESETS;

/**
 * Stable names for the encrypted credential store. Built-ins retain their
 * documented environment variable; custom providers get a namespaced key so
 * two endpoints cannot accidentally share a credential.
 */
export function credentialVariableForProvider(provider: string, stored?: StoredConfig): string {
  const custom = stored !== undefined && provider in customProvidersOf(stored);
  const builtin = custom ? undefined : PRESETS[provider];
  if (builtin) return builtin.keyEnv;
  const identity = provider.trim();
  if (!identity) return 'PLIF_API_KEY';
  const normalized = identity.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'CUSTOM';
  // Windows treats environment-variable names case-insensitively, and a
  // punctuation-only normalisation maps foo-bar, foo_bar and FOO_BAR onto the
  // same name. Keep the readable stem, then bind it to the exact provider id.
  const fingerprint = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 16).toUpperCase();
  return `PLIF_PROVIDER_${normalized}_${fingerprint}_API_KEY`;
}

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

/** What lives in the canonical personal `~/.plif/config.toml`. Every field optional. */
export interface StoredConfig {
  readonly model?: string;
  readonly small_model?: string;
  readonly baseURL?: string;
  readonly preset?: string;
  readonly apiKey?: string;
  /**
   * One credential per provider, keyed by preset name.
   *
   * The root `apiKey` cannot answer "which provider is this for", so switching
   * provider used to hand the new endpoint the previous one's key. These are
   * unambiguous, and keeping them means a developer who has paid for three
   * providers can move between them without re-pasting anything.
   */
  readonly providerKeys?: Readonly<Record<string, string>>;
  /** Accept both spellings so TOML written by people and agents is friendly. */
  readonly needKey?: boolean;
  readonly NeedKey?: boolean;
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
  readonly needKey?: boolean;
  readonly NeedKey?: boolean;
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
    readonly needKey?: boolean;
    readonly NeedKey?: boolean;
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
export function visionCandidates(
  config: StoredConfig,
  options: Pick<ResolveOptions, 'env'> = {},
): readonly VisionCandidate[] {
  const providers = customProvidersOf(config);
  return Object.entries(providers).flatMap(([provider, entry]) =>
    Object.entries(entry.models ?? {}).flatMap(([model, metadata]) => {
      if (!metadata.modalities?.includes('image')) return [];
      // Keep this display catalogue on the exact same precedence path as a
      // request. In particular, env overrides and built-in/custom provider
      // collisions must not make the picker promise a different endpoint from
      // the one the model client will use.
      const resolved = resolveConfig(config, {
        model: formatModelRef(provider, model),
        ...(options.env ? { env: options.env } : {}),
      });
      return [{
        provider,
        model,
        label: metadata.name ?? model,
        baseURL: resolved.baseURL,
        cost: metadata.cost ?? 'unknown',
        recommended: metadata.cost === 'free',
      }];
    }),
  );
}

/**
 * Return true only when the active custom model explicitly declares image
 * input. A model id or provider name is not evidence of vision support.
 *
 * Text-only models keep the attachment available to `inspect_image`, but must
 * not receive an OpenAI `image_url` part directly: OpenCode and other gateways
 * reject that request before the model can use the configured vision helper.
 */
export function modelSupportsImages(
  stored: StoredConfig,
  options: Pick<ResolveOptions, 'model' | 'preset' | 'env'> = {},
): boolean {
  const providers = customProvidersOf(stored);
  const provider = providerIdForConfig(stored, options);
  if (!provider) return false;
  const env = options.env ?? process.env;
  const ref = parseModelRef(options.model ?? env['PLIF_MODEL'] ?? stored.model ?? '', providers);
  return providers[provider]?.models?.[ref.model]?.modalities?.includes('image') === true;
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

/** Which provider id will be used for a resolved model. */
export function providerIdForConfig(
  stored: StoredConfig,
  options: Pick<ResolveOptions, 'model' | 'preset' | 'env'> = {},
): string | undefined {
  const env = options.env ?? process.env;
  const customProviders = customProvidersOf(stored);
  const ref = parseModelRef(
    options.model ?? env['PLIF_MODEL'] ?? stored.model ?? '',
    customProviders,
  );
  return ref.preset ?? options.preset ?? env['PLIF_PRESET'] ?? stored.preset;
}

/**
 * There is deliberately no default model or provider.
 *
 * Plif ships unconfigured: the first run opens the picker instead of quietly
 * talking to somebody else's endpoint on the developer's behalf. A built-in
 * default is a decision made for the user about where their code goes, and it
 * is the one decision a coding agent has no business making silently.
 */
const DEFAULTS = {
  temperature: 0.2,
  timeoutMs: 120_000,
} as const;

export async function loadStoredConfig(paths: StorePaths): Promise<StoredConfig> {
  void paths;
  return (await loadGlobalConfig()) as StoredConfig;
}

export async function saveStoredConfig(
  paths: StorePaths,
  config: StoredConfig,
  options: { readonly preserveProviderKeys?: boolean } = {},
): Promise<void> {
  void paths;
  await saveGlobalConfig(config, globalConfigPath(), options);
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
  const customProviders = customProvidersOf(stored);
  const ref = parseModelRef(
    options.model ?? env['PLIF_MODEL'] ?? stored.model ?? '',
    customProviders,
  );

  const presetName = ref.preset ?? options.preset ?? env['PLIF_PRESET'] ?? stored.preset;
  const custom = presetName ? customProviders[presetName] : undefined;
  const customCollision = custom !== undefined && presetName !== undefined && presetName in PRESETS;
  // A user-defined provider is an explicit override, even when its id is the
  // same as a built-in preset. Never let the built-in endpoint or environment
  // variable win merely because the ids happen to collide.
  const preset = custom ? undefined : (presetName ? PRESETS[presetName] : undefined);
  if (presetName && !preset && !custom) {
    throw new PlifError('INVALID_ARGUMENT', `unknown preset "${presetName}"`, {
      detail: { known: Object.keys(PRESETS) },
      hint: `Try one of: ${Object.keys(PRESETS).join(', ')} — or pass --base-url directly.`,
    });
  }

  /**
   * Do the loose top-level fields still describe the provider being resolved?
   *
   * `baseURL`, `apiKey` and `needKey` sit at the root of the config with no
   * provider attached, so they belong to whichever provider was last written
   * there — `stored.preset`. Once a different provider is asked for, those
   * fields describe somebody else's endpoint, and applying them anyway is how
   * choosing a hosted model in the picker ends up posting it to a local server
   * that has never heard of it.
   */
  const storedRef = parseModelRef(stored.model ?? '', customProviders);
  const rootFieldOwner = storedRef.preset ?? stored.preset;
  const rootFieldsApply = !presetName || !rootFieldOwner || rootFieldOwner === presetName;

  const baseURL =
    options.baseURL ??
    env['PLIF_BASE_URL'] ??
    // A custom provider owns its colliding id, so its explicit endpoint beats
    // the generic OpenAI compatibility override as well as the preset table.
    custom?.options?.baseURL ??
    env['OPENAI_BASE_URL'] ??
    // A named provider knows its own endpoint, and that beats a leftover root
    // `baseURL` even when the two belong together — the preset table is the
    // more current of the two.
    preset?.baseURL ??
    (rootFieldsApply ? stored.baseURL : undefined) ??
    PRESETS['openai']!.baseURL;

  const model = ref.model;
  const modelMetadata = custom?.models?.[model];
  const configuredNeedKey = firstBoolean(
    ...(rootFieldsApply ? [stored.NeedKey, stored.needKey] : []),
    custom?.options?.NeedKey,
    custom?.options?.needKey,
    modelMetadata?.NeedKey,
    modelMetadata?.needKey,
  );
  const needKey = configuredNeedKey ?? !keyOptional(baseURL, model);

  // Try the preset's own key variable before the generic one, so switching
  // preset picks up the right credential without renaming anything. Everything
  // that names a provider comes before everything that does not, for the same
  // reason `rootFieldsApply` exists: a credential with no provider attached is
  // a guess, and guessing wrong means posting somebody's key to a host it was
  // never issued for.
  const apiKey =
    options.apiKey ??
    (preset ? env[preset.keyEnv] : undefined) ??
    (custom && presetName ? env[credentialVariableForProvider(presetName, stored)] : undefined) ??
    custom?.options?.apiKey ??
    (presetName && !customCollision ? asStringRecord(stored.providerKeys)[presetName] : undefined) ??
    env['PLIF_API_KEY'] ??
    // The generic variable is the right fallback for an endpoint that needs a
    // credential, and exactly the wrong one for an endpoint that does not: an
    // OpenAI key sent to Zen's free tier is not ignored, it is *rejected*. A
    // developer who happens to have OPENAI_API_KEY exported would otherwise
    // find the free models broken for a reason nothing on screen explains.
    (keyOptional(baseURL, model) || custom ? undefined : env['OPENAI_API_KEY']) ??
    (rootFieldsApply && !customCollision ? stored.apiKey : undefined) ??
    // Local servers ignore the value but the SDK refuses an empty one.
    (isLocal(baseURL) && !needKey ? 'local' : '');

  return {
    model,
    baseURL,
    apiKey,
    needKey,
    temperature: numberFrom(env['PLIF_TEMPERATURE']) ?? stored.temperature ?? DEFAULTS.temperature,
    maxTokens: numberFrom(env['PLIF_MAX_TOKENS']) ?? stored.maxTokens,
    contextWindow: modelMetadata?.contextWindow,
    timeoutMs: numberFrom(env['PLIF_TIMEOUT_MS']) ?? stored.timeoutMs ?? DEFAULTS.timeoutMs,
    effort: stored.effort,
  };
}

/**
 * Rewrite the stored config so it describes the provider just chosen.
 *
 * Switching provider used to only rewrite `preset` and `model`, leaving the
 * root `baseURL`, `apiKey` and `NeedKey` from the previous provider in place —
 * and those win over a preset's own values in half the fields, so a model
 * picked in the TUI kept going to whatever endpoint was configured before it.
 *
 * Nothing is thrown away: a root key is filed under the provider it belonged
 * to on the way out, so switching away and back does not cost a re-paste.
 */
export function adoptProvider(
  stored: StoredConfig,
  selection: { readonly preset: string; readonly model: string },
  apiKey?: string,
  options: { readonly persistCredential?: boolean } = {},
): StoredConfig {
  const next: Record<string, unknown> = { ...stored };
  const persistCredential = options.persistCredential ?? true;
  const providerKeys = { ...asStringRecord(stored.providerKeys) };

  const rootKey = typeof stored.apiKey === 'string' ? stored.apiKey : '';
  const rootKeyOwner = providerIdForConfig(stored, { env: {} });
  if (persistCredential) {
    if (rootKey && rootKeyOwner && !providerKeys[rootKeyOwner]) {
      providerKeys[rootKeyOwner] = rootKey;
    }
    if (apiKey && selection.preset) providerKeys[selection.preset] = apiKey;
  } else {
    // Secure callers have already moved any legacy values into CredentialBroker.
    // Do not let an API key sneak back into the object that is about to be
    // written just because an older config still had root/provider fields.
    delete next['apiKey'];
    delete next['providerKeys'];
  }

  next['preset'] = selection.preset;
  next['model'] = selection.model;
  if (persistCredential && Object.keys(providerKeys).length > 0) next['providerKeys'] = providerKeys;

  // Only a real change of provider invalidates the root fields. Re-picking a
  // model from the same provider must not discard a hand-written base URL.
  if (rootKeyOwner && rootKeyOwner !== selection.preset) {
    delete next['baseURL'];
    delete next['needKey'];
    delete next['NeedKey'];
  }
  // Safe to drop only once it has an owner; an unattributable key stays put.
  if (persistCredential && rootKey && rootKeyOwner) delete next['apiKey'];
  return next as StoredConfig;
}

/**
 * Collect credentials still embedded in a legacy config. The first value for
 * a provider follows resolveConfig's precedence: providerKeys, root ownership,
 * then custom-provider options.
 */
export function storedProviderCredentials(
  stored: StoredConfig,
  fallbackProvider?: string,
): Readonly<Record<string, string>> {
  const found: Record<string, string> = {};
  const add = (provider: string | undefined, value: unknown): void => {
    if (provider === undefined || found[provider] || typeof value !== 'string' || !value.trim()) return;
    found[provider] = value.trim();
  };

  const customProviders = customProvidersOf(stored);
  // A credential nested in the effective provider entry is the only value
  // that is unambiguously tied to a custom endpoint. The `provider` alias wins
  // over `providers`, exactly as it does during request resolution.
  for (const [provider, entry] of Object.entries(customProviders)) {
    add(provider, entry.options?.apiKey);
  }
  for (const [provider, value] of Object.entries(asStringRecord(stored.providerKeys))) {
    if (provider in customProviders && provider in PRESETS) continue;
    add(provider, value);
  }
  const rootOwner = providerIdForConfig(stored, { env: {} }) ?? fallbackProvider;
  if (rootOwner === undefined || !(rootOwner in customProviders && rootOwner in PRESETS)) {
    add(rootOwner, stored.apiKey);
  }
  return found;
}

/** Remove all credential-bearing legacy fields after they are in the broker. */
export function stripStoredCredentials(stored: StoredConfig, fallbackProvider?: string): StoredConfig {
  const next: Record<string, unknown> = { ...stored };
  delete next['providerKeys'];
  void fallbackProvider;
  delete next['apiKey'];

  for (const field of ['providers', 'provider'] as const) {
    const providers = asCustomProviders(stored[field]);
    if (Object.keys(providers).length === 0) continue;
    next[field] = Object.fromEntries(Object.entries(providers).map(([provider, entry]) => {
      const options = entry.options;
      if (!options || typeof options.apiKey !== 'string') return [provider, entry];
      const cleanOptions: Record<string, unknown> = { ...options };
      delete cleanOptions['apiKey'];
      return [provider, { ...entry, options: cleanOptions }];
    }));
  }
  return next as StoredConfig;
}

export interface ProviderCredentialVault {
  stored(variable: string): Promise<string | undefined>;
  remember(variable: string, value: string): Promise<void>;
}

export interface ProviderCredentialMigration {
  readonly config: StoredConfig;
  readonly migrated: boolean;
  readonly variables: readonly string[];
}

/**
 * Move every attributable legacy model credential into the encrypted vault.
 *
 * All vault writes finish before the returned config drops plaintext. If a
 * write fails this function throws and the caller must leave the source config
 * untouched; a later run can safely resume because existing vault entries are
 * never overwritten by stale plaintext.
 */
export async function migrateProviderCredentials(
  stored: StoredConfig,
  vault: ProviderCredentialVault,
  fallbackProvider = '',
): Promise<ProviderCredentialMigration> {
  const credentials = storedProviderCredentials(stored, fallbackProvider);
  const variables: string[] = [];
  const remember = async (variable: string, value: string): Promise<void> => {
    variables.push(variable);
    if (value === 'local') return;
    const existing = await vault.stored(variable);
    if (existing && existing !== 'local') return;
    await vault.remember(variable, value);
  };
  for (const [provider, value] of Object.entries(credentials)) {
    await remember(credentialVariableForProvider(provider, stored), value);
  }

  // A legacy providerKeys/root credential named like a built-in is ambiguous
  // when a custom provider shadows that id. Preserve it under the built-in's
  // vault name, never the custom endpoint's namespace. The custom endpoint may
  // use only its own nested credential or hashed provider variable.
  const customProviders = customProvidersOf(stored);
  for (const [provider, value] of Object.entries(asStringRecord(stored.providerKeys))) {
    if (provider in customProviders && provider in PRESETS) {
      await remember(PRESETS[provider]!.keyEnv, value.trim());
    }
  }
  const rootOwner = providerIdForConfig(stored, { env: {} }) ?? fallbackProvider;
  if (
    typeof stored.apiKey === 'string' && stored.apiKey.trim() &&
    rootOwner in customProviders && rootOwner in PRESETS
  ) {
    await remember(PRESETS[rootOwner]!.keyEnv, stored.apiKey.trim());
  }

  if (!hasPlaintextModelCredentials(stored)) {
    return { config: stored, migrated: false, variables };
  }
  return {
    config: stripStoredCredentials(stored, fallbackProvider),
    migrated: true,
    variables: [...new Set(variables)],
  };
}

function hasPlaintextModelCredentials(stored: StoredConfig): boolean {
  if (Object.prototype.hasOwnProperty.call(stored, 'apiKey')) return true;
  if (Object.prototype.hasOwnProperty.call(stored, 'providerKeys')) return true;
  for (const field of ['providers', 'provider'] as const) {
    for (const entry of Object.values(asCustomProviders(stored[field]))) {
      if (entry.options && Object.prototype.hasOwnProperty.call(entry.options, 'apiKey')) return true;
    }
  }
  return false;
}

export function forgetProviderKey(stored: StoredConfig, preset: string): StoredConfig {
  const providerKeys = { ...asStringRecord(stored.providerKeys) };
  delete providerKeys[preset];
  const next: Record<string, unknown> = { ...stored, providerKeys };
  if (Object.keys(providerKeys).length === 0) delete next['providerKeys'];
  if (providerIdForConfig(stored, { env: {} }) === preset && typeof stored.apiKey === 'string') {
    delete next['apiKey'];
  }
  for (const field of ['providers', 'provider'] as const) {
    const providers = asCustomProviders(stored[field]);
    if (!(preset in providers)) continue;
    const entry = providers[preset]!;
    if (!entry.options || typeof entry.options.apiKey !== 'string') continue;
    const options: Record<string, unknown> = { ...entry.options };
    delete options['apiKey'];
    next[field] = { ...providers, [preset]: { ...entry, options } };
  }
  return next as StoredConfig;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry === 'string' && entry),
  ) as Record<string, string>;
}

function asCustomProviders(value: unknown): Record<string, CustomProvider> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry && typeof entry === 'object'),
  ) as Record<string, CustomProvider>;
}

/** The canonical custom-provider map; OpenCode's singular alias wins. */
export function customProvidersOf(stored: StoredConfig): Record<string, CustomProvider> {
  return {
    ...asCustomProviders(stored.providers),
    ...asCustomProviders(stored.provider),
  };
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
  // Model before URL: an unconfigured Plif has a plausible-looking base URL and
  // no model, and "no model" is the problem the developer can actually act on.
  if (!config.model) {
    return {
      ok: false,
      problem: 'no model chosen yet',
      hint: 'Run /model to pick a provider and model, or set PLIF_MODEL.',
    };
  }
  try {
    new URL(config.baseURL);
  } catch {
    return {
      ok: false,
      problem: `"${config.baseURL}" is not a valid URL`,
      hint: 'Set PLIF_BASE_URL, or pick a preset with --preset.',
    };
  }
  if (!config.apiKey && (config.needKey ?? !keyOptional(config.baseURL, config.model))) {
    return {
      ok: false,
      problem: 'no API key for a remote endpoint',
      hint: `Use /models to enter it in Plif, or set ${
        Object.values(PRESETS).find((p) => config.baseURL.startsWith(p.baseURL))?.keyEnv ??
        'OPENAI_API_KEY'
      } in your personal config/environment.`,
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
      config.apiKey || (config.needKey ?? !keyOptional(config.baseURL, config.model))
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

function firstBoolean(...values: readonly unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === 'boolean');
}
