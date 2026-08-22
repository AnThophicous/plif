import { providerOffer, type ModelConfig } from './config.js';
import type { ModelListResult, ModelProtocol, ProviderModel, StreamSemantics } from './provider.js';

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
  const rawCost = knownCost(raw['cost']);
  const rawProtocol = knownProtocol(raw['protocol']);
  const rawSemantics = knownSemantics(raw['streamSemantics'] ?? raw['stream_semantics']);
  const name = (options.nameKeys ?? ['name', 'display_name'])
    .map((key) => raw[key])
    .find((value): value is string => typeof value === 'string');
  return {
    id,
    ...(name ? { name } : {}),
    ...(typeof raw['context_window'] === 'number' ? { contextWindow: raw['context_window'] } : {}),
    ...(typeof raw['reasoning'] === 'boolean' ? { reasoning: raw['reasoning'] } : {}),
    ...(typeof raw['tools'] === 'boolean' ? { tools: raw['tools'] } : {}),
    ...(Array.isArray(raw['modalities'])
      ? { modalities: raw['modalities'].filter((value): value is 'text' | 'image' => value === 'text' || value === 'image') }
      : {}),
    ...(rawProvider ?? config.providerId ? { provider: rawProvider ?? config.providerId } : {}),
    ...(rawProduct ?? offer?.product ? { product: rawProduct ?? offer?.product } : {}),
    ...(rawTier ?? offer?.tier ? { tier: rawTier ?? offer?.tier } : {}),
    // Go is an explicitly paid offer. Zen's provider-level free tier is not a
    // blanket authorization for every live id; Zen rows remain unknown unless
    // the endpoint or curated registry says `free`.
    ...(rawCost ?? (config.providerId === 'opencode-go' ? 'paid' : undefined)
      ? { cost: rawCost ?? 'paid' }
      : {}),
    ...(rawProtocol ?? config.protocol ? { protocol: rawProtocol ?? config.protocol } : {}),
    ...(rawSemantics ?? config.streamSemantics
      ? { streamSemantics: rawSemantics ?? config.streamSemantics }
      : {}),
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
