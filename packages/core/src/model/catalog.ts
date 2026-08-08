import { PRESETS } from './config.js';

/** A model exposed by the local provider catalog. */
export interface ModelCatalogModel {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly badges: readonly string[];
}

/** A provider category exposed by the local provider catalog. */
export interface ModelCatalogProvider {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly preset: string;
  readonly endpoint: string;
  readonly models: readonly ModelCatalogModel[];
}

/** The selection persisted when a catalog model is chosen. */
export interface ModelSelection {
  readonly preset: string;
  readonly model: string;
}

export const MODEL_CATALOG_DEFAULT = Object.freeze({
  provider: 'opencode',
  model: 'deepseek-v4-flash-free',
} as const);

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
): ModelCatalogProvider =>
  Object.freeze({
    id,
    label,
    description,
    preset: id,
    endpoint: PRESETS[id as keyof typeof PRESETS]?.baseURL ?? '',
    models: Object.freeze([...models]),
  });

/** Local and deterministic so the picker works before network setup. */
export const MODEL_CATALOG: readonly ModelCatalogProvider[] = Object.freeze([
  // Every model listed here was confirmed to answer with no Authorization
  // header at all. `north-mini-code-free` carries the suffix but 401s
  // anonymously, so it is deliberately absent: an option that cannot be picked
  // successfully is worse in a picker than one that is missing from it.
  provider('opencode', 'OpenCode Zen', 'Free models — no API key needed', [
    model('deepseek-v4-flash-free', 'DeepSeek V4 Flash', 'Fast coding model', [
      'default',
      'no key',
    ]),
    model('longcat-2.0-free', 'LongCat 2.0', 'Long-context coding model', ['no key']),
    model('nemotron-3-ultra-free', 'Nemotron 3 Ultra', 'Large reasoning model', ['no key']),
    model('ling-3.0-tiny-free', 'Ling 3.0 Tiny', 'Smallest and quickest', ['no key']),
    model('mimo-v2.5-free', 'MiMo v2.5', 'Compact coding model', ['no key']),
    model('laguna-s-2.1-free', 'Laguna S 2.1', 'Compact general model', ['no key']),
    model('deepseek-v4-flash', 'DeepSeek V4 Flash (paid)', 'Paid tier of the default model', [
      'key needed',
    ]),
    model('claude-sonnet-5', 'Claude Sonnet 5', 'Paid, strong at long refactors', ['key needed']),
    model('gpt-5.4', 'GPT-5.4', 'Paid general-purpose model', ['key needed']),
  ]),
  provider('openrouter', 'OpenRouter', 'Many models through one endpoint', [
    model('openai/gpt-4o-mini', 'GPT-4o mini', 'Compact general-purpose model'),
  ]),
  provider('openai', 'OpenAI', 'OpenAI hosted models', [
    model('gpt-4o-mini', 'GPT-4o mini', 'Compact general-purpose model'),
  ]),
  provider('ollama', 'Ollama', 'Local models on your machine', [
    model('llama3.1', 'Llama 3.1', 'Local general-purpose model'),
  ]),
  provider('lmstudio', 'LM Studio', 'Local OpenAI-compatible server', [
    model('local-model', 'Local model', 'The model currently loaded in LM Studio'),
  ]),
  provider('groq', 'Groq', 'Fast hosted inference', [
    model('llama-3.3-70b-versatile', 'Llama 3.3 70B', 'Fast hosted model'),
  ]),
  provider('deepseek', 'DeepSeek', 'DeepSeek hosted models', [
    model('deepseek-chat', 'DeepSeek Chat', 'General-purpose chat model'),
  ]),
  provider('together', 'Together AI', 'Hosted open models', [
    model('meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B Turbo', 'Hosted open model'),
  ]),
]);

export function findCatalogModel(
  providerId: string,
  modelId: string,
): ModelCatalogModel | undefined {
  return MODEL_CATALOG.find((item) => item.id === providerId)?.models.find(
    (item) => item.id === modelId,
  );
}

export function catalogSelection(providerId: string, modelId: string): ModelSelection | null {
  const item = MODEL_CATALOG.find((entry) => entry.id === providerId);
  if (!item || !item.models.some((candidate) => candidate.id === modelId)) return null;
  return { preset: item.preset, model: modelId };
}
