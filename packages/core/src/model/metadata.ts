import { discoveredModelCost, providerOffer, type ModelConfig } from './config.js';
import type { ModelListResult, ModelPricing, ModelProtocol, ProviderModel, StreamSemantics } from './provider.js';

type RawModel = Record<string, unknown>;

function knownProtocol(value: unknown): ModelProtocol | undefined {
  return value === 'openai-chat' || value === 'anthropic-messages' ? value : undefined;
}

function knownSemantics(value: unknown): StreamSemantics | undefined {
  return value === 'delta' || value === 'snapshot' ? value : undefined;
}

function knownCost(value: unknown): ProviderModel['cost'] | undefined {
  return value === 'free' || value === 'paid' || value === 'unknown' ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function firstNumber(source: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = finiteNumber(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Normalize common provider price shapes without guessing a price. */
function explicitPricing(raw: RawModel): ModelPricing | undefined {
  const value = raw['pricing'] ?? raw['price'] ?? raw['costs'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const perMillion = (keys: readonly string[], tokenKeys: readonly string[]): number | undefined => {
    const direct = firstNumber(source, keys);
    if (direct !== undefined) return direct;
    const perToken = firstNumber(source, tokenKeys);
    return perToken === undefined ? undefined : perToken * 1_000_000;
  };
  const inputPerMillion = perMillion(
    ['inputPerMillion', 'input_per_million', 'promptPerMillion', 'prompt_per_million'],
    ['input', 'prompt', 'inputPerToken', 'promptPerToken'],
  );
  const outputPerMillion = perMillion(
    ['outputPerMillion', 'output_per_million', 'completionPerMillion', 'completion_per_million'],
    ['output', 'completion', 'outputPerToken', 'completionPerToken'],
  );
  const cacheReadPerMillion = perMillion(
    ['cacheReadPerMillion', 'cache_read_per_million'],
    ['cacheRead', 'cache_read', 'cacheReadPerToken'],
  );
  const cacheWritePerMillion = perMillion(
    ['cacheWritePerMillion', 'cache_write_per_million'],
    ['cacheWrite', 'cache_write', 'cacheWritePerToken'],
  );
  if ([inputPerMillion, outputPerMillion, cacheReadPerMillion, cacheWritePerMillion].every((item) => item === undefined)) return undefined;
  return {
    ...(inputPerMillion === undefined ? {} : { inputPerMillion }),
    ...(outputPerMillion === undefined ? {} : { outputPerMillion }),
    ...(cacheReadPerMillion === undefined ? {} : { cacheReadPerMillion }),
    ...(cacheWritePerMillion === undefined ? {} : { cacheWritePerMillion }),
    currency: typeof source['currency'] === 'string' ? source['currency'] : 'USD',
  };
}

function knownRanking(raw: unknown): ProviderModel['ranking'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const values = raw as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const key of ['quality', 'reasoning', 'coding', 'context', 'speed', 'cost', 'popularity']) {
    const value = values[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.max(0, Math.min(100, value));
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function positiveInteger(raw: RawModel, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = finiteNumber(raw[key]);
    if (value !== undefined && Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

function booleanField(raw: RawModel, keys: readonly string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof raw[key] === 'boolean') return raw[key] as boolean;
  }
  return undefined;
}

function explicitModalities(raw: RawModel): ProviderModel['modalities'] | undefined {
  const candidates: unknown[] = [raw['modalities'], raw['input_modalities']];
  const architecture = raw['architecture'];
  if (architecture && typeof architecture === 'object' && !Array.isArray(architecture)) {
    candidates.push((architecture as Record<string, unknown>)['input_modalities']);
  }
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const modalities = candidate.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image');
    if (modalities.length > 0) return modalities;
  }
  return undefined;
}

function explicitCapabilities(raw: RawModel): { reasoning?: boolean; tools?: boolean } {
  const capabilities = raw['capabilities'];
  const source = capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
    ? capabilities as Record<string, unknown>
    : raw;
  const supported = Array.isArray(raw['supported_parameters'])
    ? raw['supported_parameters'].filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase())
    : [];
  return {
    ...(booleanField(source, ['reasoning', 'supports_reasoning', 'thinking', 'supports_thinking']) === undefined
      ? (supported.some((value) => ['reasoning', 'reasoning_effort', 'include_reasoning', 'thinking'].includes(value)) ? { reasoning: true } : {})
      : { reasoning: booleanField(source, ['reasoning', 'supports_reasoning', 'thinking', 'supports_thinking']) }),
    ...(booleanField(source, ['tools', 'tool_calling', 'supports_tools']) === undefined
      ? (supported.some((value) => ['tools', 'tool_choice', 'functions', 'function_calling'].includes(value)) ? { tools: true } : {})
      : { tools: booleanField(source, ['tools', 'tool_calling', 'supports_tools']) }),
  };
}

/** Normalize raw model metadata without inferring provenance from the id. */
export function normalizeProviderModel(
  raw: RawModel,
  config: ModelConfig,
  options: { readonly nameKeys?: readonly string[] } = {},
): ProviderModel | undefined {
  const id = typeof raw['id'] === 'string' ? raw['id'] : '';
  if (!id) return undefined;
  const offer = providerOffer(config.providerId);
  const rawProvider = typeof raw['provider'] === 'string' ? raw['provider'] : undefined;
  const rawProduct = typeof raw['product'] === 'string' ? raw['product'] : undefined;
  const rawTier = typeof raw['tier'] === 'string' ? raw['tier'] : undefined;
  const pricing = explicitPricing(raw);
  const rawCost = knownCost(raw['cost']) ?? (pricing ? 'paid' : undefined);
  const cost = discoveredModelCost(config.providerId, id, rawCost);
  const rawProtocol = knownProtocol(raw['protocol']);
  const rawSemantics = knownSemantics(raw['streamSemantics'] ?? raw['stream_semantics']);
  const ranking = knownRanking(raw['ranking']);
  const capabilities = explicitCapabilities(raw);
  const contextWindow = positiveInteger(raw, ['context_window', 'contextWindow', 'context_length', 'max_context_tokens', 'max_context_length']);
  const maxInputTokens = positiveInteger(raw, ['max_input_tokens', 'maxInputTokens', 'input_token_limit']);
  const maxOutputTokens = positiveInteger(raw, ['max_output_tokens', 'maxOutputTokens', 'output_token_limit']);
  const modalities = explicitModalities(raw);
  const hasProviderMetadata = contextWindow !== undefined || maxInputTokens !== undefined || maxOutputTokens !== undefined ||
    capabilities.reasoning !== undefined || capabilities.tools !== undefined || modalities !== undefined ||
    rawCost !== undefined || pricing !== undefined || ranking !== undefined || rawProtocol !== undefined || rawSemantics !== undefined;
  const name = (options.nameKeys ?? ['name', 'display_name'])
    .map((key) => raw[key])
    .find((value): value is string => typeof value === 'string');
  return {
    id,
    ...(name ? { name } : {}),
    ...(Array.isArray(raw['aliases'])
      ? { aliases: raw['aliases'].filter((value): value is string => typeof value === 'string').slice(0, 20) }
      : {}),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxInputTokens === undefined ? {} : { maxInputTokens }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(capabilities.reasoning === undefined ? {} : { reasoning: capabilities.reasoning }),
    ...(capabilities.tools === undefined ? {} : { tools: capabilities.tools }),
    ...(modalities === undefined ? {} : { modalities }),
    ...(rawProvider ?? config.providerId ? { provider: rawProvider ?? config.providerId } : {}),
    ...(rawProduct ?? offer?.product ? { product: rawProduct ?? offer?.product } : {}),
    ...(rawTier ?? offer?.tier ? { tier: rawTier ?? offer?.tier } : {}),
    ...(cost
      ? { cost }
      : {}),
    ...(pricing ? { pricing } : {}),
    ...(ranking ? { ranking } : {}),
    ...(rawProtocol ?? config.protocol ? { protocol: rawProtocol ?? config.protocol } : {}),
    ...(rawSemantics ?? config.streamSemantics
      ? { streamSemantics: rawSemantics ?? config.streamSemantics }
      : {}),
    ...(hasProviderMetadata ? { metadataSource: 'provider' as const } : {}),
  };
}

export function modelListSource(config: ModelConfig) {
  const offer = providerOffer(config.providerId);
  return {
    ...(config.providerId ? { provider: config.providerId } : {}),
    ...(offer?.product ? { product: offer.product } : {}),
    ...(offer?.tier ? { tier: offer.tier } : {}),
    endpoint: config.baseURL,
  };
}

export function modelListResult(
  config: ModelConfig,
  models: readonly ProviderModel[],
): ModelListResult {
  return { supported: true, models, source: modelListSource(config) };
}
