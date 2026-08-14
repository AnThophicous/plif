import { PRESETS, type CustomProvider, type StoredConfig } from './config.js';

/** A model exposed by the provider catalog. */
export interface ModelCatalogModel {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly badges: readonly string[];
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
  /** Curated ids, most used first. Used for ranking and when listing fails. */
  readonly models: readonly ModelCatalogModel[];
  /** True when the endpoint serves models to callers with no credential. */
  readonly anonymous?: boolean;
}

/** The selection persisted when a catalog model is chosen. */
export interface ModelSelection {
  readonly preset: string;
  readonly model: string;
}

const model = (
  id: string,
  label: string,
  description: string,
  badges: readonly string[] = [],
): ModelCatalogModel => Object.freeze({ id, label, description, badges: Object.freeze([...badges]) });

const provider = (
  id: string,
  label: string,
  description: string,
  models: readonly ModelCatalogModel[],
  extra: { anonymous?: boolean } = {},
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
  });

/**
 * The providers Plif knows how to reach.
 *
 * Order within each provider is the ranking the picker shows: most-reached-for
 * model first. That ordering is also what ranks the *live* list — the ids an
 * endpoint advertises are matched against these, so the models people actually
 * use surface above the long tail of dated snapshots and retired variants.
 *
 * The lists are a starting point, not a registry. Providers rename and retire
 * models constantly, so nothing here is load-bearing: `/model` asks the
 * endpoint what it really serves, and falls back to this only when it cannot.
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
    { anonymous: true },
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
      model(modelId, metadata.name ?? modelId, entry.name ?? id, ['yours']),
    ),
  }));
}

/**
 * Sort live model ids by how much they are actually reached for.
 *
 * Curated order wins, because that is the ranking a human made deliberately.
 * Free models come next: they are the ones somebody browsing a provider they
 * have not paid for can actually run. Everything else is alphabetical, which is
 * arbitrary but at least stable — a list that reorders between openings is
 * worse than one ordered by a rule nobody loves.
 */
export function rankModelIds(providerId: string, ids: readonly string[]): string[] {
  const curated = new Map(
    (findCatalogProvider(providerId)?.models ?? []).map((item, index) => [item.id, index]),
  );
  const rank = (id: string): number => {
    const known = curated.get(id);
    if (known !== undefined) return known;
    return isFreeId(id) ? 10_000 : 20_000;
  };
  return [...ids].sort((left, right) => {
    const delta = rank(left) - rank(right);
    return delta !== 0 ? delta : left.localeCompare(right);
  });
}

function isFreeId(id: string): boolean {
  return id.endsWith('-free') || id.endsWith(':free');
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
