import {
  PRESETS,
  type CustomProvider,
  type ModelCapability,
  type ModelCost,
  type StoredConfig,
} from './config.js';
import type { ModelPricing, ModelProtocol, ModelRankingHints, ProviderModel, StreamSemantics } from './provider.js';

/** A model exposed by the provider catalog. */
export interface ModelCatalogModel {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly badges: readonly string[];
  /** Search aliases supplied by the catalog or a live provider. */
  readonly aliases?: readonly string[];
  /** Present only when the developer explicitly declared the capability. */
  readonly modalities?: readonly ModelCapability[];
  /** Present only when the source declares a trustworthy limit. */
  readonly contextWindow?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: boolean;
  readonly tools?: boolean;
  readonly cost?: ModelCost;
  readonly pricing?: ModelPricing;
  /** Explicit ranking signals; absence means the model is scored conservatively. */
  readonly ranking?: ModelRankingHints;
  readonly provider?: string;
  readonly product?: string;
  readonly tier?: string;
  readonly protocol?: ModelProtocol;
  readonly streamSemantics?: StreamSemantics;
  /** Static/config metadata is distinct from facts returned by a provider. */
  readonly metadataSource?: 'provider' | 'registry' | 'config';
}

/**
 * Where a provider came from.
 *
 * The picker keeps these apart because they answer different questions. A
 * `user` provider is something the developer wrote down in their own config and
 * is responsible for; a `builtin` one is a shortcut Plif ships. Mixing them in
 * one list makes it impossible to tell which entries you can fix by editing a
 * file and which you cannot.
 */
export type ModelCatalogOrigin = 'user' | 'builtin';

/** A provider category exposed by the provider catalog. */
export interface ModelCatalogProvider {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly origin: ModelCatalogOrigin;
  readonly preset: string;
  readonly endpoint: string;
  /** Authentication owned by a local provider bridge, not an API key. */
  readonly auth?: 'codex';
  /** Curated ids, most used first. Used for ranking and when listing fails. */
  readonly models: readonly ModelCatalogModel[];
  /** True when the endpoint serves models to callers with no credential. */
  readonly anonymous?: boolean;
  readonly product?: string;
  readonly tier?: string;
  readonly defaultCost?: ModelCost;
}

/** The selection persisted when a catalog model is chosen. */
export interface ModelSelection {
  readonly preset: string;
  readonly model: string;
  readonly protocol?: ModelProtocol;
  readonly streamSemantics?: StreamSemantics;
  /** Explicit choice for Codex's optional fast service tier. */
  readonly codexFast?: boolean;
}

export type ProviderAccess = 'free' | 'configured' | 'local';

export interface AvailableCatalogModel {
  readonly provider: ModelCatalogProvider;
  readonly model: ModelCatalogModel;
  readonly access: ProviderAccess;
}

export type ModelTier = 'S' | 'A' | 'B' | 'C' | 'D';

export interface ModelScore {
  readonly quality: number;
  readonly reasoning: number;
  readonly coding: number;
  readonly context: number;
  readonly speed: number;
  readonly cost: number;
  readonly popularity: number;
  readonly finalScore: number;
  readonly tier: ModelTier;
  readonly known: boolean;
}

export type ModelBrowserFilter =
  | 'strength'
  | 'context'
  | 'alphabetical'
  | 'speed'
  | 'reasoning'
  | 'tools'
  | 'vision'
  | 'coding'
  | 'long-context'
  | `tier:${ModelTier}`
  | `provider:${string}`;

const model = (
  id: string,
  label: string,
  description: string,
  badges: readonly string[] = [],
  modalities?: readonly ModelCapability[],
  metadata: Pick<ModelCatalogModel, 'aliases' | 'contextWindow' | 'maxInputTokens' | 'maxOutputTokens' | 'reasoning' | 'tools' | 'cost' | 'pricing' | 'ranking' | 'provider' | 'product' | 'tier' | 'protocol' | 'streamSemantics' | 'metadataSource'> = {},
): ModelCatalogModel => Object.freeze({
  id,
  label,
  description,
  badges: Object.freeze([...badges]),
  ...(modalities ? { modalities: Object.freeze([...modalities]) } : {}),
  ...metadata,
});

/**
 * IDs currently advertised by the official OpenCode Go model endpoint. The
 * endpoint intentionally exposes only identity fields, so this helper records
 * only facts PLIF can establish without guessing context or capabilities.
 */
const openCodeGoModel = (
  id: string,
  label: string,
  protocol: ModelProtocol = 'openai-chat',
): ModelCatalogModel => model(id, label, 'Listed by the official OpenCode Go model endpoint', ['paid'], undefined, {
  cost: 'paid',
  provider: 'opencode-go',
  product: 'OpenCode',
  tier: 'Go',
  protocol,
  metadataSource: 'registry',
});

/** A picker badge based on declarations, never guesses made from a model id. */
export function modelVisionBadge(
  candidate: ModelCatalogModel,
  hasVisionHelper: boolean,
): 'vision' | 'vision helper' | 'text only' | null {
  if (candidate.modalities?.includes('image')) return 'vision';
  if (!candidate.modalities?.includes('text')) return null;
  return hasVisionHelper ? 'vision helper' : 'text only';
}

const provider = (
  id: string,
  label: string,
  description: string,
  models: readonly ModelCatalogModel[],
  extra: { anonymous?: boolean; product?: string; tier?: string; defaultCost?: ModelCost; auth?: 'codex' } = {},
): ModelCatalogProvider =>
  Object.freeze({
    id,
    label,
    description,
    origin: 'builtin' as const,
    preset: id,
    endpoint: PRESETS[id as keyof typeof PRESETS]?.baseURL ?? '',
    models: Object.freeze([...models]),
    ...(extra.anonymous ? { anonymous: true } : {}),
    ...(extra.product ? { product: extra.product } : {}),
    ...(extra.tier ? { tier: extra.tier } : {}),
    ...(extra.defaultCost ? { defaultCost: extra.defaultCost } : {}),
    ...(extra.auth ? { auth: extra.auth } : {}),
  });

/**
 * The providers Plif knows how to reach.
 *
 * Order within each provider is the ranking the picker shows: most-reached-for
 * model first. That ordering is also what ranks the *live* list — the ids an
 * endpoint advertises are matched against these, so the models people actually
 * use surface above the long tail of dated snapshots and retired variants.
 *
 * The lists are static metadata, not a live registry. Providers rename and
 * retire models constantly, so availability is resolved separately from this
 * catalogue; the discovery layer may refresh configured endpoints in the
 * background without treating this list as live availability.
 */
export const MODEL_CATALOG: readonly ModelCatalogProvider[] = Object.freeze([
  provider('anthropic', 'Claude (Anthropic)', 'Claude models, via the official SDK', [
    model('claude-opus-5', 'Claude Opus 5', 'Strongest at long agentic coding'),
    model('claude-sonnet-5', 'Claude Sonnet 5', 'Near-Opus quality, lower cost'),
    model('claude-haiku-4-5', 'Claude Haiku 4.5', 'Fastest and cheapest'),
    model('claude-opus-4-8', 'Claude Opus 4.8', 'Previous Opus generation'),
    model('claude-fable-5', 'Claude Fable 5', 'Most capable, highest cost'),
  ]),
  provider('openai', 'OpenAI (ChatGPT)', 'The models behind ChatGPT', [
    model('gpt-4o', 'GPT-4o', 'General-purpose flagship'),
    model('gpt-4o-mini', 'GPT-4o mini', 'Compact and cheap'),
    model('gpt-4.1', 'GPT-4.1', 'Long-context coding model'),
    model('gpt-4.1-mini', 'GPT-4.1 mini', 'Compact long-context model'),
    model('o3', 'o3', 'Reasoning model'),
    model('o4-mini', 'o4-mini', 'Compact reasoning model'),
  ]),
  provider('openrouter', 'OpenRouter', 'Hundreds of models behind one key', [
    model('deepseek/deepseek-chat-v3:free', 'DeepSeek V3', 'Popular free coding model', ['free']),
    model('z-ai/glm-4.6', 'GLM 4.6', 'Strong open coding model'),
    model('anthropic/claude-sonnet-5', 'Claude Sonnet 5', 'Anthropic through OpenRouter'),
    model('openai/gpt-4o', 'GPT-4o', 'OpenAI through OpenRouter'),
    model('google/gemini-2.0-flash-exp:free', 'Gemini 2.0 Flash', 'Fast and free', ['free']),
    model('meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B', 'Open weights, free tier', ['free']),
    model('qwen/qwen-2.5-coder-32b-instruct:free', 'Qwen 2.5 Coder 32B', 'Free coding model', ['free']),
  ]),
  provider('google', 'Google Gemini', 'Gemini through the OpenAI-compatible endpoint', [
    model('gemini-2.5-pro', 'Gemini 2.5 Pro', 'Flagship reasoning model'),
    model('gemini-2.5-flash', 'Gemini 2.5 Flash', 'Fast and inexpensive'),
    model('gemini-2.0-flash', 'Gemini 2.0 Flash', 'Previous fast generation'),
  ]),
  provider('codex', 'OpenAI Codex (ChatGPT)', 'Use your ChatGPT account through the PLIF sign-in window', [
    model('codex-default', 'Codex default', 'Uses the model selected by your ChatGPT/Codex account', ['ChatGPT login'], ['text', 'image'], {
      reasoning: true,
      tools: true,
      provider: 'codex',
      product: 'OpenAI',
      tier: 'Codex / ChatGPT',
      protocol: 'openai-chat',
      metadataSource: 'registry',
    }),
  ], { product: 'OpenAI', tier: 'Codex / ChatGPT', defaultCost: 'unknown', auth: 'codex' }),
  provider('xai', 'xAI', 'Grok models', [
    model('grok-4', 'Grok 4', 'Flagship model'),
    model('grok-code-fast-1', 'Grok Code Fast', 'Tuned for coding turnaround'),
    model('grok-3-mini', 'Grok 3 mini', 'Compact and cheap'),
  ]),
  provider('groq', 'Groq', 'Open models at very high tokens per second', [
    model('llama-3.3-70b-versatile', 'Llama 3.3 70B', 'The default general model'),
    model('openai/gpt-oss-120b', 'GPT-OSS 120B', 'Open-weights reasoning model'),
    model('moonshotai/kimi-k2-instruct', 'Kimi K2', 'Large open coding model'),
    model('qwen/qwen3-32b', 'Qwen 3 32B', 'Compact and quick'),
  ]),
  provider('nvidia', 'NVIDIA NIM', 'A large hosted catalogue on one key', [
    model('z-ai/glm-5.2', 'GLM 5.2', 'Flagship agentic coding and reasoning model'),
    model('zai/glm-4.6', 'GLM 4.6', 'Strong open coding model'),
    model('deepseek-ai/deepseek-r1', 'DeepSeek R1', 'Open reasoning model'),
    model('openai/gpt-oss-120b', 'GPT-OSS 120B', 'Open-weights reasoning model'),
    model('qwen/qwen3-coder-480b-a35b-instruct', 'Qwen 3 Coder 480B', 'Large coding model'),
    model('moonshotai/kimi-k2-instruct', 'Kimi K2', 'Large open coding model'),
    model('nvidia/llama-3.3-nemotron-super-49b-v1', 'Nemotron Super 49B', 'NVIDIA reasoning model'),
    model('meta/llama-3.3-70b-instruct', 'Llama 3.3 70B', 'Open general model'),
  ]),
  provider('deepseek', 'DeepSeek', 'DeepSeek first-party endpoint', [
    model('deepseek-chat', 'DeepSeek Chat', 'General-purpose coding model'),
    model('deepseek-reasoner', 'DeepSeek Reasoner', 'Thinking mode'),
  ]),
  provider('zai', 'Z.AI', 'The GLM family, first-party', [
    model('glm-4.6', 'GLM 4.6', 'Flagship coding model'),
    model('glm-4.5-air', 'GLM 4.5 Air', 'Compact and cheap'),
    model('glm-4.5', 'GLM 4.5', 'Previous flagship'),
  ]),
  provider('moonshot', 'Moonshot (Kimi)', 'Kimi models, first-party', [
    model('kimi-k2-0905-preview', 'Kimi K2', 'Large agentic coding model'),
    model('moonshot-v1-128k', 'Moonshot v1 128k', 'Long-context general model'),
  ]),
  provider('mistral', 'Mistral AI', 'Mistral first-party endpoint', [
    model('mistral-large-latest', 'Mistral Large', 'Flagship model'),
    model('codestral-latest', 'Codestral', 'Tuned for code'),
    model('mistral-small-latest', 'Mistral Small', 'Compact and cheap'),
  ]),
  provider('cerebras', 'Cerebras', 'Open models at extreme speed', [
    model('qwen-3-coder-480b', 'Qwen 3 Coder 480B', 'Large coding model'),
    model('gpt-oss-120b', 'GPT-OSS 120B', 'Open reasoning model'),
    model('llama-3.3-70b', 'Llama 3.3 70B', 'Open general model'),
  ]),
  provider('fireworks', 'Fireworks AI', 'Hosted open models', [
    model('accounts/fireworks/models/deepseek-v3', 'DeepSeek V3', 'Open coding model'),
    model('accounts/fireworks/models/kimi-k2-instruct', 'Kimi K2', 'Large open coding model'),
    model('accounts/fireworks/models/qwen3-coder-480b-a35b-instruct', 'Qwen 3 Coder 480B', 'Large coding model'),
  ]),
  provider('together', 'Together AI', 'Hosted open models', [
    model('deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 'Open coding model'),
    model('meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B Turbo', 'Open general model'),
    model('Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen 2.5 Coder 32B', 'Compact coding model'),
  ]),
  provider('sambanova', 'SambaNova', 'Open models with a free tier', [
    model('Meta-Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 'Open general model'),
    model('DeepSeek-V3-0324', 'DeepSeek V3', 'Open coding model'),
    model('Qwen3-32B', 'Qwen 3 32B', 'Compact and quick'),
  ]),
  provider('hyperbolic', 'Hyperbolic', 'Hosted open models', [
    model('deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 'Open coding model'),
    model('meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 'Open general model'),
    model('Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen 2.5 Coder 32B', 'Compact coding model'),
  ]),
  provider('perplexity', 'Perplexity', 'Search-grounded models', [
    model('sonar-pro', 'Sonar Pro', 'Search-grounded flagship'),
    model('sonar', 'Sonar', 'Search-grounded and cheap'),
    model('sonar-reasoning-pro', 'Sonar Reasoning Pro', 'Search plus thinking'),
  ]),
  provider('nexapi', 'NexAPI', 'OpenAI-compatible hosted model gateway', [], {
    product: 'NexAPI',
    tier: 'Hosted',
    defaultCost: 'unknown',
  }),
  // Every model listed here was confirmed to answer with no Authorization
  // header at all. `north-mini-code-free` carries the suffix but 401s
  // anonymously, so it is deliberately absent: an option that cannot be picked
  // successfully is worse in a picker than one that is missing from it.
  provider(
    'opencode',
    'OpenCode Zen',
    'Free models — no API key needed',
    [
      model('deepseek-v4-flash-free', 'DeepSeek V4 Flash', 'Fast coding model', ['no key']),
      model('longcat-2.0-free', 'LongCat 2.0', 'Long-context coding model', ['no key']),
      model('nemotron-3-ultra-free', 'Nemotron 3 Ultra', 'Large reasoning model', ['no key']),
      model('ling-3.0-tiny-free', 'Ling 3.0 Tiny', 'Smallest and quickest', ['no key']),
      model('mimo-v2.5-free', 'MiMo v2.5', 'Compact coding model', ['no key']),
      model('laguna-s-2.1-free', 'Laguna S 2.1', 'Compact general model', ['no key']),
      model('claude-sonnet-5', 'Claude Sonnet 5', 'Paid, strong at long refactors', ['key needed']),
      model('gpt-5.4', 'GPT-5.4', 'Paid general-purpose model', ['key needed']),
    ],
    { anonymous: true, product: 'OpenCode', tier: 'Zen', defaultCost: 'free' },
  ),
  provider(
    'opencode-go',
    'OpenCode Go',
    'Paid OpenCode models — API key required',
    [
      model('ox-alpha-free', 'Ox Alpha Free', 'Stealth model · free for a limited time · zero-retention provider', ['free'], undefined, {
        cost: 'free',
        provider: 'opencode-go',
        product: 'OpenCode',
        tier: 'Go',
        protocol: 'openai-chat',
        metadataSource: 'registry',
      }),
      model('qwen3.8-max', 'Qwen3.8 Max', 'Long-context coding and reasoning model', ['paid'], undefined, {
        cost: 'paid',
        provider: 'opencode-go',
        product: 'OpenCode',
        tier: 'Go',
        protocol: 'anthropic-messages',
        metadataSource: 'registry',
      }),
      model('deepseek-v4-flash', 'DeepSeek V4 Flash', 'Fast paid coding model', ['paid'], undefined, {
        cost: 'paid',
        provider: 'opencode-go',
        product: 'OpenCode',
        tier: 'Go',
        protocol: 'openai-chat',
        metadataSource: 'registry',
      }),
      openCodeGoModel('minimax-m3', 'MiniMax M3', 'anthropic-messages'),
      openCodeGoModel('minimax-m2.7', 'MiniMax M2.7', 'anthropic-messages'),
      openCodeGoModel('minimax-m2.5', 'MiniMax M2.5', 'anthropic-messages'),
      openCodeGoModel('kimi-k3', 'Kimi K3'),
      openCodeGoModel('kimi-k2.7-code', 'Kimi K2.7 Code'),
      openCodeGoModel('kimi-k2.6', 'Kimi K2.6'),
      openCodeGoModel('kimi-k2.5', 'Kimi K2.5'),
      openCodeGoModel('glm-5.3', 'GLM 5.3'),
      openCodeGoModel('glm-5.2', 'GLM 5.2'),
      openCodeGoModel('glm-5.1', 'GLM 5.1'),
      openCodeGoModel('glm-5', 'GLM 5'),
      openCodeGoModel('deepseek-v4-pro', 'DeepSeek V4 Pro'),
      model('deepseek-v4-flash-vision-exp', 'DeepSeek V4 Flash Vision Experimental', 'OpenCode Go vision model', ['paid'], ['text', 'image'], {
        cost: 'paid', provider: 'opencode-go', product: 'OpenCode', tier: 'Go', metadataSource: 'registry',
      }),
      openCodeGoModel('qwen3.7-max', 'Qwen3.7 Max', 'anthropic-messages'),
      openCodeGoModel('qwen3.7-plus', 'Qwen3.7 Plus', 'anthropic-messages'),
      openCodeGoModel('qwen3.6-plus', 'Qwen3.6 Plus', 'anthropic-messages'),
      openCodeGoModel('qwen3.5-plus', 'Qwen3.5 Plus', 'anthropic-messages'),
      openCodeGoModel('mimo-v2-pro', 'MiMo V2 Pro'),
      openCodeGoModel('mimo-v2-omni', 'MiMo V2 Omni'),
      openCodeGoModel('mimo-v2.5-pro', 'MiMo V2.5 Pro'),
      openCodeGoModel('mimo-v2.5', 'MiMo V2.5'),
      openCodeGoModel('hy3', 'HY3'),
      openCodeGoModel('hy3-preview', 'HY3 Preview'),
      openCodeGoModel('gpt-5.6-luna', 'GPT 5.6 Luna'),
      openCodeGoModel('grok-4.5', 'Grok 4.5'),
      openCodeGoModel('muse-spark-1.2-contributor', 'Muse Spark 1.2 Contributor'),
    ],
    { product: 'OpenCode', tier: 'Go', defaultCost: 'paid' },
  ),
  provider('ollama', 'Ollama', 'Models running on this machine', []),
  provider('lmstudio', 'LM Studio', 'Local OpenAI-compatible server', []),
]);

export function findCatalogProvider(providerId: string): ModelCatalogProvider | undefined {
  return MODEL_CATALOG.find((item) => item.id === providerId);
}

export function findCatalogModel(
  providerId: string,
  modelId: string,
): ModelCatalogModel | undefined {
  return findCatalogProvider(providerId)?.models.find((item) => item.id === modelId);
}

/**
 * The one gate from provider access to selectable models. Callers decide which
 * providers are available from credentials/runtime state; this function is the
 * only place that turns that state into model rows. Free access intentionally
 * admits only models explicitly marked `no key`.
 */
export function selectAvailableModels(
  providers: readonly ModelCatalogProvider[],
  access: ReadonlyMap<string, ProviderAccess>,
): readonly AvailableCatalogModel[] {
  return providers.flatMap((entryProvider) => {
    const state = access.get(entryProvider.id);
    if (!state) return [];
    const models = state === 'free'
      ? entryProvider.models.filter((entry) => entry.badges.includes('no key'))
      : entryProvider.models;
    return models.map((entry) => ({ provider: entryProvider, model: entry, access: state }));
  });
}

/** Resolve a bare model id only when its catalog mapping is unambiguous. */
export function providerForModel(
  modelId: string,
  providers: readonly ModelCatalogProvider[] = MODEL_CATALOG,
): string | undefined {
  const matches = providers.filter((entryProvider) => entryProvider.models.some((entry) => entry.id === modelId));
  if (matches.length === 1) return matches[0]!.id;
  const anonymous = matches.find((entryProvider) => entryProvider.anonymous);
  return anonymous?.id;
}

/**
 * The providers the developer declared in their own configuration.
 *
 * Read from both `providers` and `provider` because the config schema accepts
 * either spelling, and somebody who wrote one should not find their endpoint
 * missing from the picker because they guessed the other.
 */
export function userCatalog(config: StoredConfig): readonly ModelCatalogProvider[] {
  const declared: Record<string, CustomProvider> = {
    ...asProviders(config.providers),
    ...asProviders(config.provider),
  };
  return Object.entries(declared).map(([id, entry]) => ({
    id,
    label: entry.name ?? id,
    description: entry.options?.baseURL ?? 'custom provider',
    origin: 'user' as const,
    preset: id,
    endpoint: entry.options?.baseURL ?? '',
    models: Object.entries(entry.models ?? {}).map(([modelId, metadata]) =>
      model(modelId, metadata.name ?? modelId, entry.name ?? id, ['yours'], metadata.modalities, {
        ...(metadata.aliases === undefined ? {} : { aliases: metadata.aliases }),
        ...(metadata.contextWindow === undefined ? {} : { contextWindow: metadata.contextWindow }),
        ...(metadata.maxInputTokens === undefined ? {} : { maxInputTokens: metadata.maxInputTokens }),
        ...(metadata.maxOutputTokens === undefined ? {} : { maxOutputTokens: metadata.maxOutputTokens }),
        ...(metadata.reasoning === undefined ? {} : { reasoning: metadata.reasoning }),
        ...(metadata.tools === undefined ? {} : { tools: metadata.tools }),
        ...(metadata.cost === undefined ? {} : { cost: metadata.cost }),
        ...(metadata.pricing === undefined ? {} : { pricing: metadata.pricing }),
        ...(metadata.ranking === undefined ? {} : { ranking: metadata.ranking }),
        ...(metadata.protocol === undefined ? {} : { protocol: metadata.protocol }),
        ...(metadata.streamSemantics === undefined ? {} : { streamSemantics: metadata.streamSemantics }),
        metadataSource: 'config' as const,
      }),
    ),
    ...((entry.options?.needKey === false || entry.options?.NeedKey === false) ? { anonymous: true } : {}),
  }));
}

/**
 * Rank normalized provider data using explicit metadata, known families and
 * conservative defaults. The id-only wrapper below remains for callers that
 * have not migrated to the richer discovery rows yet.
 */
const KNOWN_MODEL_HINTS: readonly { readonly pattern: RegExp; readonly hints: ModelRankingHints }[] = [
  { pattern: /claude[-_\s]+(?:opus|fable)/i, hints: { quality: 97, reasoning: 96, coding: 95, popularity: 95, speed: 52 } },
  { pattern: /claude[-_\s]+sonnet/i, hints: { quality: 90, reasoning: 88, coding: 93, popularity: 94, speed: 65 } },
  { pattern: /gpt[-\s]?(?:5|4\.1|4o)|^o[34](?:[-\s]|$)/i, hints: { quality: 92, reasoning: 90, coding: 92, popularity: 96, speed: 68 } },
  { pattern: /gemini[-_\s]+(?:ultra|2\.5[-_\s]+pro|pro)/i, hints: { quality: 93, reasoning: 92, coding: 88, popularity: 91, speed: 64 } },
  { pattern: /deepseek[-_\s]+(?:r1|reasoner)/i, hints: { quality: 88, reasoning: 97, coding: 91, popularity: 90, speed: 48 } },
  { pattern: /qwen(?:\s|[-_])?(?:max|coder|3\.8)/i, hints: { quality: 86, reasoning: 86, coding: 94, popularity: 84, speed: 58 } },
  { pattern: /llama[-_\s]+3\.3[-_\s]+70b|llama[-_\s]?70b/i, hints: { quality: 78, reasoning: 70, coding: 82, popularity: 88, speed: 72 } },
  { pattern: /nemotron[-_\s]+(?:ultra|super)/i, hints: { quality: 84, reasoning: 86, coding: 83, popularity: 72, speed: 61 } },
  { pattern: /mistral[-_\s]+large|codestral/i, hints: { quality: 80, reasoning: 74, coding: 88, popularity: 78, speed: 69 } },
];

function clampScore(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value!)) : fallback;
}

function modelText(model: Pick<ModelCatalogModel, 'id' | 'label' | 'description' | 'aliases'> | ProviderModel): string {
  return [model.id, 'label' in model ? model.label : model.name, 'description' in model ? model.description : undefined, ...(model.aliases ?? [])]
    .filter(Boolean).join(' ');
}

function knownHints(model: Pick<ModelCatalogModel, 'id' | 'label' | 'description' | 'aliases'> | ProviderModel): ModelRankingHints | undefined {
  const text = modelText(model);
  return KNOWN_MODEL_HINTS.find(({ pattern }) => pattern.test(text))?.hints;
}

function contextScore(tokens: number | undefined): number {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return 25;
  return Math.max(20, Math.min(100, Math.round(20 + Math.log10(tokens / 8_000) * 38)));
}

function capabilityScore(value: boolean | undefined, known: number, unknown: number): number {
  return value === undefined ? unknown : value ? known : 8;
}

/** Score a model once in the provider/model layer, never during React render. */
export function scoreModel(
  model: Pick<ModelCatalogModel, 'id' | 'label' | 'description' | 'aliases' | 'contextWindow' | 'reasoning' | 'tools' | 'modalities' | 'cost' | 'ranking'> | ProviderModel,
): ModelScore {
  const explicit = model.ranking;
  const recognized = knownHints(model);
  const text = modelText(model).toLowerCase();
  const quality = clampScore(explicit?.quality ?? recognized?.quality, explicit || recognized ? 42 : 18);
  const reasoning = clampScore(explicit?.reasoning ?? recognized?.reasoning, capabilityScore(model.reasoning, 96, /reason|think|r1/.test(text) ? 62 : 25));
  const coding = clampScore(explicit?.coding ?? recognized?.coding, /code|coder|coding|codestral/.test(text) ? 72 : 42);
  const context = clampScore(explicit?.context, contextScore(model.contextWindow));
  const speed = clampScore(explicit?.speed ?? recognized?.speed, /mini|flash|haiku|small|tiny|fast/.test(text) ? 78 : 48);
  const cost = clampScore(explicit?.cost, model.cost === 'free' ? 72 : model.cost === 'paid' ? 42 : 35);
  const popularity = clampScore(explicit?.popularity ?? recognized?.popularity, recognized ? 62 : 25);
  const capabilityBonus = (model.tools === true ? 3 : 0) + (model.modalities?.includes('image') ? 3 : 0);
  const finalScore = Math.round(
    quality * 0.30 + reasoning * 0.18 + coding * 0.17 + context * 0.13 +
    speed * 0.07 + cost * 0.04 + popularity * 0.11 + capabilityBonus,
  );
  const tier: ModelTier = finalScore >= 82 ? 'S' : finalScore >= 68 ? 'A' : finalScore >= 52 ? 'B' : finalScore >= 35 ? 'C' : 'D';
  return { quality, reasoning, coding, context, speed, cost, popularity, finalScore, tier, known: Boolean(explicit || recognized) };
}

function rankEntries<T>(entries: readonly T[], score: (entry: T) => ModelScore, id: (entry: T) => string = () => ''): T[] {
  return entries.map((entry, index) => ({ entry, index, score: score(entry) })).sort((left, right) => {
    const delta = right.score.finalScore - left.score.finalScore;
    if (delta !== 0) return delta;
    const tierDelta = left.score.tier.localeCompare(right.score.tier);
    if (tierDelta !== 0) return tierDelta;
    return left.index - right.index || id(left.entry).localeCompare(id(right.entry));
  }).map(({ entry }) => entry);
}

export function rankProviderModels(providerId: string, models: readonly ProviderModel[]): ProviderModel[] {
  const curated = new Map((findCatalogProvider(providerId)?.models ?? []).map((model) => [model.id, model]));
  return rankEntries(models, (model) => scoreModel({ ...(curated.get(model.id) ?? {}), ...model, id: model.id, label: model.name ?? curated.get(model.id)?.label ?? model.id, description: curated.get(model.id)?.description ?? '' }), (model) => model.id);
}

export function rankAvailableModels(items: readonly AvailableCatalogModel[]): AvailableCatalogModel[] {
  return rankEntries(items, (item) => scoreModel(item.model), (item) => `${item.provider.id}:${item.model.id}`);
}

export function filterAvailableModels(items: readonly AvailableCatalogModel[], filter: ModelBrowserFilter): AvailableCatalogModel[] {
  const filtered = filter.startsWith('provider:')
    ? items.filter((item) => item.provider.id === filter.slice('provider:'.length))
    : filter.startsWith('tier:')
      ? items.filter((item) => scoreModel(item.model).tier === filter.slice('tier:'.length))
      : filter === 'reasoning'
        ? items.filter((item) => item.model.reasoning === true)
        : filter === 'tools'
          ? items.filter((item) => item.model.tools === true)
          : filter === 'vision'
            ? items.filter((item) => item.model.modalities?.includes('image') === true)
            : filter === 'coding'
              ? items.filter((item) => scoreModel(item.model).coding >= 60)
              : filter === 'long-context'
                ? items.filter((item) => (item.model.contextWindow ?? 0) >= 128_000)
                : [...items];
  if (filter === 'alphabetical') return filtered.sort((a, b) => a.model.label.localeCompare(b.model.label) || a.provider.id.localeCompare(b.provider.id));
  if (filter === 'context') return filtered.sort((a, b) => (b.model.contextWindow ?? 0) - (a.model.contextWindow ?? 0));
  if (filter === 'speed') return filtered.sort((a, b) => scoreModel(b.model).speed - scoreModel(a.model).speed);
  return rankAvailableModels(filtered);
}

/** Backwards-compatible id API used by discovery and older integrations. */
export function rankModelIds(providerId: string, ids: readonly string[]): string[] {
  const curated = new Map((findCatalogProvider(providerId)?.models ?? []).map((item) => [item.id, item]));
  const ranked = rankProviderModels(providerId, ids.map((id) => ({
    id,
    ...(curated.get(id) ? { name: curated.get(id)!.label } : {}),
    ...(curated.get(id)?.contextWindow === undefined ? {} : { contextWindow: curated.get(id)!.contextWindow }),
    ...(curated.get(id)?.reasoning === undefined ? {} : { reasoning: curated.get(id)!.reasoning }),
    ...(curated.get(id)?.tools === undefined ? {} : { tools: curated.get(id)!.tools }),
    ...(curated.get(id)?.modalities === undefined ? {} : { modalities: curated.get(id)!.modalities }),
    ...(curated.get(id)?.cost === undefined ? {} : { cost: curated.get(id)!.cost }),
    ...(curated.get(id)?.ranking === undefined ? {} : { ranking: curated.get(id)!.ranking }),
  })));
  // Preserve the historical id-only contract for callers that do not have
  // normalized metadata yet. The live discovery path uses rankProviderModels,
  // so this compatibility rule cannot elevate an actually unknown model in
  // the smart picker from a `-free` suffix alone.
  return ranked.sort((left, right) => {
    const leftUnknown = !curated.has(left.id);
    const rightUnknown = !curated.has(right.id);
    if (leftUnknown && rightUnknown) {
      const leftFree = /(?:^|[-_])free(?:$|[-_])/i.test(left.id);
      const rightFree = /(?:^|[-_])free(?:$|[-_])/i.test(right.id);
      if (leftFree !== rightFree) return leftFree ? -1 : 1;
      return left.id.localeCompare(right.id);
    }
    return 0;
  }).map((model) => model.id);
}


/**
 * Turn a picked row into something the config can store.
 *
 * The group id *is* the preset id for every provider, built-in or the
 * developer's own, so no lookup against the curated list happens here. It used
 * to, and that quietly broke picking any model discovered from a live endpoint
 * — the id was real, it just was not in the hardcoded table, so Enter did
 * nothing and no message said why.
 */
export function catalogSelection(providerId: string, modelId: string): ModelSelection | null {
  if (!providerId || !modelId) return null;
  return { preset: providerId, model: modelId };
}

function asProviders(value: unknown): Record<string, CustomProvider> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry && typeof entry === 'object'),
  ) as Record<string, CustomProvider>;
}
