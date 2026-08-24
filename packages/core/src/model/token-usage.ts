export type TokenUsageSource = 'reported' | 'derived' | 'estimated' | 'unknown';

export interface CanonicalTokenUsage {
  readonly inputNewTokens?: number;
  readonly inputCachedTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalPromptTokens?: number;
  readonly totalTokens?: number;
  readonly requestCount?: number;
  readonly source: TokenUsageSource;
}

export interface NormalizedTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly tokenUsage: CanonicalTokenUsage;
}

function count(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function nested(raw: unknown, ...keys: string[]): unknown {
  let value: unknown = raw;
  for (const key of keys) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function firstCount(raw: unknown, paths: readonly (readonly string[])[]): number | undefined {
  for (const path of paths) {
    const value = count(nested(raw, ...path));
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalized(
  promptTokens: number,
  completionTokens: number,
  tokenUsage: Omit<CanonicalTokenUsage, 'source'>,
  source: TokenUsageSource,
): NormalizedTokenUsage {
  return {
    promptTokens,
    completionTokens,
    tokenUsage: { ...tokenUsage, source },
  };
}

/** Normalize OpenAI-compatible, DeepSeek, and gateway usage payloads. */
export function normalizeOpenAIUsage(raw: unknown): NormalizedTokenUsage | undefined {
  const prompt = firstCount(raw, [['prompt_tokens']]);
  const completion = firstCount(raw, [['completion_tokens']]);
  const cacheRead = firstCount(raw, [
    ['prompt_tokens_details', 'cached_tokens'],
    ['prompt_cache_hit_tokens'],
    ['cache_read_input_tokens'],
  ]);
  const cacheMiss = firstCount(raw, [
    ['prompt_cache_miss_tokens'],
    ['prompt_tokens_details', 'uncached_tokens'],
  ]);
  const reasoning = firstCount(raw, [
    ['completion_tokens_details', 'reasoning_tokens'],
    ['reasoning_tokens'],
  ]);
  const derivedPrompt = prompt ?? (cacheRead !== undefined && cacheMiss !== undefined
    ? cacheRead + cacheMiss
    : undefined);
  if (derivedPrompt === undefined && completion === undefined) return undefined;
  const totalPrompt = derivedPrompt;
  const inputNew = totalPrompt === undefined
    ? undefined
    : cacheMiss ?? (cacheRead !== undefined ? Math.max(0, totalPrompt - cacheRead) : totalPrompt);
  const source: TokenUsageSource = cacheRead !== undefined || cacheMiss !== undefined ? 'derived' : 'reported';
  return normalized(
    totalPrompt ?? 0,
    completion ?? 0,
    {
      ...(inputNew === undefined ? {} : { inputNewTokens: inputNew }),
      ...(cacheRead === undefined ? {} : { inputCachedTokens: cacheRead }),
      outputTokens: completion,
      ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
      ...(derivedPrompt === undefined ? {} : { totalPromptTokens: derivedPrompt }),
      ...(derivedPrompt === undefined || completion === undefined
        ? {}
        : { totalTokens: derivedPrompt + completion }),
      requestCount: 1,
    },
    source,
  );
}

/** Normalize Anthropic's separate input/cache-creation/cache-read fields. */
export function normalizeAnthropicUsage(raw: unknown): NormalizedTokenUsage | undefined {
  const input = firstCount(raw, [['input_tokens']]);
  const cacheRead = firstCount(raw, [['cache_read_input_tokens']]);
  const cacheWrite = firstCount(raw, [['cache_creation_input_tokens']]);
  const completion = firstCount(raw, [['output_tokens']]);
  if (input === undefined && completion === undefined && cacheRead === undefined && cacheWrite === undefined) return undefined;
  const hasPrompt = input !== undefined || cacheRead !== undefined || cacheWrite !== undefined;
  const totalPrompt = hasPrompt ? (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined;
  return normalized(
    totalPrompt ?? 0,
    completion ?? 0,
    {
      ...(input === undefined ? {} : { inputNewTokens: input }),
      ...(cacheRead === undefined ? {} : { inputCachedTokens: cacheRead }),
      ...(cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite }),
      outputTokens: completion,
      ...(totalPrompt === undefined ? {} : { totalPromptTokens: totalPrompt }),
      ...(totalPrompt === undefined || completion === undefined ? {} : { totalTokens: totalPrompt + completion }),
      requestCount: 1,
    },
    'reported',
  );
}

export function canonicalFromLegacyUsage(
  promptTokens: number,
  completionTokens: number,
  source: TokenUsageSource = 'reported',
): CanonicalTokenUsage {
  const prompt = count(promptTokens) ?? 0;
  const completion = count(completionTokens) ?? 0;
  return {
    inputNewTokens: prompt,
    outputTokens: completion,
    totalPromptTokens: prompt,
    totalTokens: prompt + completion,
    requestCount: 1,
    source,
  };
}

function addKnown(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined || right === undefined) return undefined;
  return left + right;
}

function mergedSource(left: TokenUsageSource | undefined, right: TokenUsageSource): TokenUsageSource {
  if (!left) return right;
  if (left === 'unknown' || right === 'unknown') return 'unknown';
  if (left === 'estimated' || right === 'estimated') return 'estimated';
  if (left === 'derived' || right === 'derived') return 'derived';
  return 'reported';
}

export function mergeTokenUsage(
  left: CanonicalTokenUsage | undefined,
  right: CanonicalTokenUsage,
): CanonicalTokenUsage {
  if (!left) return right;
  return {
    inputNewTokens: addKnown(left.inputNewTokens, right.inputNewTokens),
    inputCachedTokens: addKnown(left.inputCachedTokens, right.inputCachedTokens),
    cacheWriteTokens: addKnown(left.cacheWriteTokens, right.cacheWriteTokens),
    outputTokens: addKnown(left.outputTokens, right.outputTokens),
    reasoningTokens: addKnown(left.reasoningTokens, right.reasoningTokens),
    totalPromptTokens: addKnown(left.totalPromptTokens, right.totalPromptTokens),
    totalTokens: addKnown(left.totalTokens, right.totalTokens),
    requestCount: addKnown(left.requestCount, right.requestCount),
    source: mergedSource(left.source, right.source),
  };
}

export function estimatedTokenUsage(promptTokens: number, completionTokens = 0): CanonicalTokenUsage {
  return canonicalFromLegacyUsage(promptTokens, completionTokens, 'estimated');
}
