import { PlifError } from '../errors.js';
import type {
  CustomProvider,
  CustomProviderModel,
  ModelCapability,
  ModelCost,
  StoredConfig,
} from './config.js';
import type {
  ModelPricing,
  ModelProtocol,
  ModelRankingHints,
  StreamSemantics,
} from './provider.js';

/** Wire adapters that a declarative custom provider may select. */
export const CUSTOM_PROVIDER_PROTOCOLS = Object.freeze([
  'openai-chat',
  'anthropic-messages',
] as const);

export type CustomProviderProtocol = typeof CUSTOM_PROVIDER_PROTOCOLS[number];

/** Authentication policy for a custom HTTP provider. */
export const CUSTOM_PROVIDER_AUTHS = Object.freeze([
  'api-key',
  'none',
  'openai-oauth',
] as const);

export type CustomProviderAuth = typeof CUSTOM_PROVIDER_AUTHS[number];

export interface CustomModelCapabilities {
  readonly modalities?: readonly ModelCapability[];
  readonly reasoning?: boolean;
  readonly tools?: boolean;
}

/** The normalized model shape exposed to configuration and picker consumers. */
export interface CustomModelDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly aliases?: readonly string[];
  readonly contextWindow?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly modalities?: readonly ModelCapability[];
  readonly reasoning?: boolean;
  readonly tools?: boolean;
  readonly cost?: ModelCost;
  readonly pricing?: ModelPricing;
  readonly ranking?: ModelRankingHints;
  readonly protocol?: ModelProtocol;
  readonly streamSemantics?: StreamSemantics;
  readonly needKey?: boolean;
}

/**
 * A model entry accepted by the declarative API. `id` is optional here only
 * because map-shaped manifests already carry it in the map key.
 */
export type CustomModelDefinitionInput = Omit<CustomModelDefinition, 'id' | 'label' | 'description'> & {
  readonly id?: string;
  readonly label?: string;
  readonly name?: string;
  readonly description?: string;
  readonly contextLength?: number;
  readonly capabilities?: CustomModelCapabilities;
  readonly NeedKey?: boolean;
  readonly [key: string]: unknown;
};

export type CustomModelCollectionInput =
  | readonly CustomModelDefinitionInput[]
  | Readonly<Record<string, CustomModelDefinitionInput>>;

/** The canonical provider shape returned by normalization. */
export interface CustomProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly baseURL: string;
  readonly protocol: CustomProviderProtocol;
  readonly auth: CustomProviderAuth;
  readonly needKey: boolean;
  readonly defaultModel?: string;
  readonly models: readonly CustomModelDefinition[];
  readonly sdk: 'openai';
  readonly npm?: string;
}

/**
 * Friendly input for a provider. Both the new flat shape and the existing
 * OpenCode-compatible `name`/`options`/model-map shape are accepted.
 */
export interface CustomProviderDefinitionInput {
  readonly id: string;
  readonly label?: string;
  readonly name?: string;
  readonly description?: string;
  readonly baseURL?: string;
  readonly protocol?: CustomProviderProtocol;
  readonly auth?: CustomProviderAuth;
  readonly authMode?: 'codex' | 'openai-oauth';
  readonly needKey?: boolean;
  readonly NeedKey?: boolean;
  readonly defaultModel?: string;
  readonly default_model?: string;
  /** `model` is accepted as a small compatibility alias for defaultModel. */
  readonly model?: string;
  readonly models?: CustomModelCollectionInput;
  readonly sdk?: 'openai';
  readonly npm?: string;
  readonly options?: Readonly<{
    readonly baseURL?: string;
    readonly apiKey?: string;
    readonly needKey?: boolean;
    readonly NeedKey?: boolean;
    readonly protocol?: CustomProviderProtocol;
    readonly auth?: CustomProviderAuth;
    readonly authMode?: 'codex' | 'openai-oauth';
    readonly defaultModel?: string;
    readonly [key: string]: unknown;
  }>;
  readonly [key: string]: unknown;
}

export type NormalizedCustomModelDefinition = CustomModelDefinition;
export type NormalizedCustomProviderDefinition = CustomProviderDefinition;

export interface ProviderDefinitionValidationSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ProviderDefinitionValidationFailure {
  readonly ok: false;
  readonly error: ProviderDefinitionError;
}

export type ProviderDefinitionValidation<T> =
  | ProviderDefinitionValidationSuccess<T>
  | ProviderDefinitionValidationFailure;

/**
 * A safe, actionable configuration error. Detail deliberately contains only
 * the offending field and a redacted representation of its value; provider
 * options may contain credentials and must never be copied into diagnostics.
 */
export class ProviderDefinitionError extends PlifError {
  readonly path: string;
  readonly received: string;
  readonly allowed: string;
  readonly example: string;

  constructor(
    path: string,
    value: unknown,
    allowed: string,
    example: string,
    reason = 'has an invalid value',
  ) {
    const received = displayValue(path, value);
    super(
      'INVALID_ARGUMENT',
      `Invalid provider definition at ${path}: ${reason}. Received ${received}. ` +
        `Allowed: ${allowed}. Example: ${example}.`,
      {
        detail: {
          field: path,
          received,
          allowed,
          example,
        },
        hint: `Fix ${path} and try again.`,
      },
    );
    this.name = 'ProviderDefinitionError';
    this.path = path;
    this.received = received;
    this.allowed = allowed;
    this.example = example;
  }
}

interface NormalizedModelResult {
  readonly value: CustomModelDefinition;
  /** Only fields explicitly supplied by the caller, for non-destructive merge. */
  readonly patch: CustomProviderModel;
  readonly explicit: ReadonlySet<string>;
}

interface NormalizedProviderResult {
  readonly value: CustomProviderDefinition;
  readonly modelResults: readonly NormalizedModelResult[];
  readonly explicit: ReadonlySet<string>;
}

interface RecordValue {
  readonly [key: string]: unknown;
}

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_PROVIDER_ID_LENGTH = 64;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_LABEL_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 2_000;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function own(source: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function recordOrEmpty(value: unknown, path: string): RecordValue {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    fail(path, value, 'an object/table', '{ "options": { "baseURL": "https://api.example.test/v1" } }');
  }
  return value;
}

function fail(
  path: string,
  value: unknown,
  allowed: string,
  example: string,
  reason?: string,
): never {
  throw new ProviderDefinitionError(path, value, allowed, example, reason);
}

function text(
  value: unknown,
  path: string,
  allowed: string,
  example: string,
  options: { readonly maxLength?: number; readonly trim?: boolean } = {},
): string {
  if (typeof value !== 'string') fail(path, value, allowed, example);
  const normalized = options.trim === false ? value : value.trim();
  if (!normalized) fail(path, value, allowed, example, 'must not be empty');
  if (options.maxLength !== undefined && normalized.length > options.maxLength) {
    fail(path, value, `a string of at most ${options.maxLength} characters`, example, 'is too long');
  }
  if (/^[\u0000-\u001f\u007f]/.test(normalized) || /[\u0000-\u001f\u007f]/.test(normalized)) {
    fail(path, value, 'a printable string without control characters', example);
  }
  return normalized;
}

function optionalText(
  source: RecordValue,
  key: string,
  path: string,
  allowed: string,
  example: string,
  maxLength: number,
): string | undefined {
  if (!own(source, key) || source[key] === undefined) return undefined;
  return text(source[key], path, allowed, example, { maxLength });
}

function aliasText(
  source: RecordValue,
  first: string,
  second: string,
  path: string,
  fallback: string,
  allowed: string,
  example: string,
  maxLength: number,
): { readonly value: string; readonly explicit: boolean } {
  const firstValue = optionalText(source, first, `${path}.${first}`, allowed, example, maxLength);
  const secondValue = optionalText(source, second, `${path}.${second}`, allowed, example, maxLength);
  if (firstValue !== undefined && secondValue !== undefined && firstValue !== secondValue) {
    fail(
      `${path}.${first}`,
      firstValue,
      `${first} and ${second} must contain the same value when both are present`,
      `{ "${first}": "${fallback}" }`,
      `${first} and ${second} conflict`,
    );
  }
  return { value: firstValue ?? secondValue ?? fallback, explicit: firstValue !== undefined || secondValue !== undefined };
}

function normalizeProviderId(value: unknown, path: string): string {
  const id = text(value, path, 'an identifier matching [A-Za-z0-9][A-Za-z0-9._-]*', '{ "id": "my-provider" }', {
    maxLength: MAX_PROVIDER_ID_LENGTH,
  });
  if (!PROVIDER_ID_PATTERN.test(id) || id === '.' || id === '..') {
    fail(
      path,
      value,
      'letters, numbers, dots, underscores, and hyphens; it must start with a letter or number',
      '{ "id": "my-provider" }',
      'contains characters that are unsafe in config keys and provider namespaces',
    );
  }
  return id;
}

function normalizeModelId(value: unknown, path: string): string {
  const id = text(
    value,
    path,
    'a printable model id up to 256 characters; vendor/model slashes are allowed',
    '{ "id": "llama-3.1-8b" }',
    { maxLength: MAX_MODEL_ID_LENGTH, trim: false },
  );
  if (id.trim() !== id || /[\\\u0000-\u001f\u007f\s]/.test(id) || id.startsWith('/') || id.endsWith('/') || id.includes('//')) {
    fail(
      path,
      value,
      'a non-empty id without whitespace, backslashes, control characters, or absolute/path-traversal segments',
      '{ "id": "vendor/llama-3.1-8b" }',
      'is not safe as a model namespace',
    );
  }
  const segments = id.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)) {
    fail(
      path,
      value,
      'vendor/model segments that are not . or ..',
      '{ "id": "vendor/llama-3.1-8b" }',
      'contains a path-traversal segment',
    );
  }
  return id;
}

function normalizeBaseURL(value: unknown, path: string, required: boolean): string {
  if (value === undefined || value === null || value === '') {
    if (!required) return '';
    fail(
      path,
      value,
      'an absolute http:// or https:// URL',
      '{ "baseURL": "https://api.example.test/v1" }',
      'is required',
    );
  }
  if (typeof value !== 'string') {
    fail(path, value, 'an absolute http:// or https:// URL', '{ "baseURL": "https://api.example.test/v1" }');
  }
  const raw = value.trim();
  if (!raw) {
    if (!required) return '';
    fail(path, value, 'an absolute http:// or https:// URL', '{ "baseURL": "https://api.example.test/v1" }', 'is required');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(path, value, 'an absolute http:// or https:// URL', '{ "baseURL": "https://api.example.test/v1" }');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(path, value, 'an absolute http:// or https:// URL', '{ "baseURL": "https://api.example.test/v1" }');
  }
  if (!url.hostname || /[\u0000-\u001f\u007f]/.test(raw)) {
    fail(path, value, 'an absolute http:// or https:// URL with a host', '{ "baseURL": "https://api.example.test/v1" }');
  }
  if (url.username || url.password) {
    fail(
      path,
      value,
      'an endpoint URL without embedded credentials',
      '{ "baseURL": "https://api.example.test/v1" }',
      'URL credentials must be stored through the encrypted credential flow',
    );
  }
  for (const key of url.searchParams.keys()) {
    if (/(key|secret|token|password|credential|auth)/i.test(key)) {
      fail(
        path,
        value,
        'an endpoint URL without credential-like query parameters',
        '{ "baseURL": "https://api.example.test/v1" }',
        'put provider credentials in the encrypted credential flow instead',
      );
    }
  }
  // Keep query parameters for compatibility with gateways, but canonicalize
  // the harmless trailing slash. Error rendering redacts sensitive params.
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '') || `${url.protocol}//${url.host}`;
}

function finitePositiveInteger(value: unknown, path: string, example: string): number {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number) || number <= 0) {
    fail(path, value, 'a positive safe integer measured in tokens', example);
  }
  return number;
}

function aliasedPositiveInteger(
  source: RecordValue,
  keys: readonly string[],
  path: string,
  example: string,
): { readonly value: number | undefined; readonly explicit: boolean } {
  const values: { readonly key: string; readonly value: number }[] = [];
  for (const key of keys) {
    if (!own(source, key) || source[key] === undefined) continue;
    values.push({ key, value: finitePositiveInteger(source[key], `${path}.${key}`, example) });
  }
  if (values.length === 0) return { value: undefined, explicit: false };
  const first = values[0]!;
  if (values.some((entry) => entry.value !== first.value)) {
    fail(
      `${path}.${first.key}`,
      first.value,
      `all aliases (${keys.join(', ')}) must describe the same capacity`,
      example,
      'capacity aliases conflict',
    );
  }
  return { value: first.value, explicit: true };
}

function booleanAlias(
  entries: readonly { readonly key: string; readonly value: unknown }[],
  path: string,
  example: string,
): { readonly value: boolean | undefined; readonly explicit: boolean } {
  const values: { readonly key: string; readonly value: boolean }[] = [];
  for (const entry of entries) {
    if (entry.value === undefined) continue;
    if (typeof entry.value !== 'boolean') fail(`${path}.${entry.key}`, entry.value, 'true or false', example);
    values.push({ key: entry.key, value: entry.value });
  }
  if (values.length === 0) return { value: undefined, explicit: false };
  const first = values[0]!;
  if (values.some((entry) => entry.value !== first.value)) {
    fail(`${path}.${first.key}`, first.value, 'all NeedKey/needKey aliases must agree', example, 'boolean aliases conflict');
  }
  return { value: first.value, explicit: true };
}

function normalizeModalities(value: unknown, path: string, example: string): readonly ModelCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, value, '["text"], ["text", "image"], or another non-empty list of supported modalities', example);
  }
  const result: ModelCapability[] = [];
  for (const [index, item] of value.entries()) {
    if (item !== 'text' && item !== 'image') {
      fail(`${path}[${index}]`, item, '"text" or "image"', example);
    }
    if (result.includes(item)) {
      fail(`${path}[${index}]`, item, 'each modality only once', example, 'contains a duplicate modality');
    }
    result.push(item);
  }
  return Object.freeze(result);
}

function equalStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeAliases(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail(path, value, 'an array of non-empty strings', '{ "aliases": ["fast-model"] }');
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    const alias = text(item, `${path}[${index}]`, 'a printable non-empty string', '{ "aliases": ["fast-model"] }', { maxLength: MAX_MODEL_ID_LENGTH });
    if (result.includes(alias)) fail(`${path}[${index}]`, alias, 'unique aliases', '{ "aliases": ["fast-model"] }', 'contains a duplicate alias');
    result.push(alias);
  }
  return Object.freeze(result);
}

function normalizeCost(value: unknown, path: string): ModelCost {
  if (value === 'free' || value === 'paid' || value === 'unknown') return value;
  fail(path, value, '"free", "paid", or "unknown"', '{ "cost": "paid" }');
}

function normalizeProtocol(value: unknown, path: string): CustomProviderProtocol {
  if (value === undefined) return 'openai-chat';
  if (value === 'openai-chat' || value === 'anthropic-messages') return value;
  fail(path, value, '"openai-chat" or "anthropic-messages"', '{ "protocol": "openai-chat" }');
}

function normalizeAuth(value: unknown, path: string): CustomProviderAuth | undefined {
  if (value === undefined) return undefined;
  if (value === 'api-key' || value === 'none' || value === 'openai-oauth') return value;
  // A config written while Codex was still a provider keeps loading, on the
  // OpenAI OAuth route that replaced it. Failing here instead would turn a
  // removed provider into a broken startup for a file the user never touched.
  if (value === 'codex') return 'openai-oauth';
  fail(path, value, '"api-key", "none", or "openai-oauth"', '{ "auth": "api-key" }');
}

function normalizePricing(value: unknown, path: string): ModelPricing {
  if (!isRecord(value)) fail(path, value, 'a pricing object with non-negative finite numbers', '{ "pricing": { "inputPerMillion": 1 } }');
  const result: Record<string, unknown> = {};
  for (const key of ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion']) {
    if (!own(value, key) || value[key] === undefined) continue;
    const number = typeof value[key] === 'number' ? value[key] : Number(value[key]);
    if (!Number.isFinite(number) || number < 0) {
      fail(`${path}.${key}`, value[key], 'a finite number greater than or equal to 0', '{ "inputPerMillion": 1 }');
    }
    result[key] = number;
  }
  if (own(value, 'currency') && value['currency'] !== undefined) {
    result['currency'] = text(value['currency'], `${path}.currency`, 'a short currency code', '{ "currency": "USD" }', { maxLength: 12 });
  }
  if (Object.keys(result).length === 0) fail(path, value, 'at least one price field', '{ "pricing": { "inputPerMillion": 1 } }');
  return Object.freeze(result as ModelPricing);
}

function normalizeRanking(value: unknown, path: string): ModelRankingHints {
  if (!isRecord(value)) fail(path, value, 'an object with optional scores from 0 to 100', '{ "ranking": { "coding": 80 } }');
  const result: Record<string, number> = {};
  for (const key of ['quality', 'reasoning', 'coding', 'context', 'speed', 'cost', 'popularity']) {
    if (!own(value, key) || value[key] === undefined) continue;
    const number = typeof value[key] === 'number' ? value[key] : Number(value[key]);
    if (!Number.isFinite(number) || number < 0 || number > 100) {
      fail(`${path}.${key}`, value[key], 'a finite score between 0 and 100', '{ "coding": 80 }');
    }
    result[key] = number;
  }
  if (Object.keys(result).length === 0) fail(path, value, 'at least one score from 0 to 100', '{ "ranking": { "coding": 80 } }');
  return Object.freeze(result as ModelRankingHints);
}

function normalizeModelInput(input: unknown, mapId: string | undefined, path: string): NormalizedModelResult {
  if (!isRecord(input)) fail(path, input, 'a model definition object', '{ "id": "llama-3.1-8b", "label": "Llama 3.1 8B" }');
  const explicit = new Set<string>();
  const source = input;
  const rawId = mapId ?? source['id'];
  if (mapId !== undefined && source['id'] !== undefined && source['id'] !== mapId) {
    fail(`${path}.id`, source['id'], `the map key "${mapId}"`, `{ "id": "${mapId}" }`, 'does not match the model map key');
  }
  const id = normalizeModelId(rawId, `${path}.id`);

  const label = aliasText(
    source,
    'label',
    'name',
    path,
    id,
    'a human-readable non-empty label',
    `{ "id": "${id}", "label": "Readable model name" }`,
    MAX_LABEL_LENGTH,
  );
  if (label.explicit) explicit.add('label');
  const description = own(source, 'description') && source['description'] === ''
    ? ''
    : optionalText(source, 'description', `${path}.description`, 'a printable description', '{ "description": "Fast local model" }', MAX_DESCRIPTION_LENGTH);
  if (description !== undefined) explicit.add('description');

  const aliases = own(source, 'aliases') && source['aliases'] !== undefined
    ? normalizeAliases(source['aliases'], `${path}.aliases`)
    : undefined;
  if (aliases !== undefined) explicit.add('aliases');

  const contextWindow = aliasedPositiveInteger(source, ['contextWindow', 'context_window', 'contextLength', 'context_length', 'maxContextTokens', 'max_context_tokens'], `${path}.contextWindow`, '{ "contextWindow": 32768 }');
  const maxInputTokens = aliasedPositiveInteger(source, ['maxInputTokens', 'max_input_tokens', 'inputTokenLimit', 'input_token_limit'], `${path}.maxInputTokens`, '{ "maxInputTokens": 30000 }');
  const maxOutputTokens = aliasedPositiveInteger(source, ['maxOutputTokens', 'max_output_tokens', 'outputTokenLimit', 'output_token_limit'], `${path}.maxOutputTokens`, '{ "maxOutputTokens": 4096 }');
  if (contextWindow.value !== undefined) explicit.add('contextWindow');
  if (maxInputTokens.value !== undefined) explicit.add('maxInputTokens');
  if (maxOutputTokens.value !== undefined) explicit.add('maxOutputTokens');
  if (contextWindow.value !== undefined && maxInputTokens.value !== undefined && maxInputTokens.value > contextWindow.value) {
    fail(`${path}.maxInputTokens`, maxInputTokens.value, `a value no greater than contextWindow (${contextWindow.value})`, '{ "contextWindow": 32768, "maxInputTokens": 30000 }', 'exceeds the declared context window');
  }
  if (contextWindow.value !== undefined && maxOutputTokens.value !== undefined && maxOutputTokens.value > contextWindow.value) {
    fail(`${path}.maxOutputTokens`, maxOutputTokens.value, `a value no greater than contextWindow (${contextWindow.value})`, '{ "contextWindow": 32768, "maxOutputTokens": 4096 }', 'exceeds the declared context window');
  }

  const capabilitySource = source['capabilities'] === undefined
    ? undefined
    : recordOrEmpty(source['capabilities'], `${path}.capabilities`);
  const directModalities = own(source, 'modalities') && source['modalities'] !== undefined
    ? normalizeModalities(source['modalities'], `${path}.modalities`, '{ "modalities": ["text", "image"] }')
    : undefined;
  const capabilityModalities = capabilitySource && own(capabilitySource, 'modalities') && capabilitySource['modalities'] !== undefined
    ? normalizeModalities(capabilitySource['modalities'], `${path}.capabilities.modalities`, '{ "capabilities": { "modalities": ["text"] } }')
    : undefined;
  if (directModalities && capabilityModalities && !equalStringArrays(directModalities, capabilityModalities)) {
    fail(`${path}.modalities`, directModalities, 'modalities and capabilities.modalities must match when both are present', '{ "modalities": ["text"] }', 'capability aliases conflict');
  }
  const modalities = directModalities ?? capabilityModalities;
  if (modalities !== undefined) explicit.add('modalities');

  const reasoning = booleanAlias([
    { key: 'reasoning', value: source['reasoning'] },
    { key: 'capabilities.reasoning', value: capabilitySource?.['reasoning'] },
  ], path, '{ "reasoning": true }');
  const tools = booleanAlias([
    { key: 'tools', value: source['tools'] },
    { key: 'capabilities.tools', value: capabilitySource?.['tools'] },
  ], path, '{ "tools": true }');
  if (reasoning.explicit) explicit.add('reasoning');
  if (tools.explicit) explicit.add('tools');

  const cost = source['cost'] === undefined ? undefined : normalizeCost(source['cost'], `${path}.cost`);
  const pricing = source['pricing'] === undefined ? undefined : normalizePricing(source['pricing'], `${path}.pricing`);
  const ranking = source['ranking'] === undefined ? undefined : normalizeRanking(source['ranking'], `${path}.ranking`);
  const protocol = source['protocol'] === undefined ? undefined : normalizeProtocol(source['protocol'], `${path}.protocol`);
  const streamSemantics = source['streamSemantics'] === undefined && source['stream_semantics'] === undefined
    ? undefined
    : (source['streamSemantics'] ?? source['stream_semantics']);
  if (streamSemantics !== undefined && streamSemantics !== 'delta' && streamSemantics !== 'snapshot') {
    fail(`${path}.streamSemantics`, streamSemantics, '"delta" or "snapshot"', '{ "streamSemantics": "delta" }');
  }
  const needKey = booleanAlias([
    { key: 'needKey', value: source['needKey'] },
    { key: 'NeedKey', value: source['NeedKey'] },
  ], path, '{ "needKey": false }');
  if (needKey.explicit) explicit.add('needKey');
  if (cost !== undefined) explicit.add('cost');
  if (pricing !== undefined) explicit.add('pricing');
  if (ranking !== undefined) explicit.add('ranking');
  if (protocol !== undefined) explicit.add('protocol');
  if (streamSemantics !== undefined) explicit.add('streamSemantics');

  const value: CustomModelDefinition = Object.freeze({
    id,
    label: label.value,
    description: description ?? '',
    ...(aliases === undefined ? {} : { aliases }),
    ...(contextWindow.value === undefined ? {} : { contextWindow: contextWindow.value }),
    ...(maxInputTokens.value === undefined ? {} : { maxInputTokens: maxInputTokens.value }),
    ...(maxOutputTokens.value === undefined ? {} : { maxOutputTokens: maxOutputTokens.value }),
    ...(modalities === undefined ? {} : { modalities }),
    ...(reasoning.value === undefined ? {} : { reasoning: reasoning.value }),
    ...(tools.value === undefined ? {} : { tools: tools.value }),
    ...(cost === undefined ? {} : { cost }),
    ...(pricing === undefined ? {} : { pricing }),
    ...(ranking === undefined ? {} : { ranking }),
    ...(protocol === undefined ? {} : { protocol }),
    ...(streamSemantics === undefined ? {} : { streamSemantics: streamSemantics as StreamSemantics }),
    ...(needKey.value === undefined ? {} : { needKey: needKey.value }),
  });

  const patch: Record<string, unknown> = {};
  if (label.explicit) patch['name'] = label.value;
  if (description !== undefined) patch['description'] = description;
  if (aliases !== undefined) patch['aliases'] = aliases;
  if (contextWindow.value !== undefined) patch['contextWindow'] = contextWindow.value;
  if (maxInputTokens.value !== undefined) patch['maxInputTokens'] = maxInputTokens.value;
  if (maxOutputTokens.value !== undefined) patch['maxOutputTokens'] = maxOutputTokens.value;
  if (modalities !== undefined) patch['modalities'] = modalities;
  if (reasoning.value !== undefined) patch['reasoning'] = reasoning.value;
  if (tools.value !== undefined) patch['tools'] = tools.value;
  if (cost !== undefined) patch['cost'] = cost;
  if (pricing !== undefined) patch['pricing'] = pricing;
  if (ranking !== undefined) patch['ranking'] = ranking;
  if (protocol !== undefined) patch['protocol'] = protocol;
  if (streamSemantics !== undefined) patch['streamSemantics'] = streamSemantics;
  if (needKey.value !== undefined) patch['needKey'] = needKey.value;

  return { value, patch: patch as CustomProviderModel, explicit };
}

function normalizeModelCollection(
  value: unknown,
  path: string,
): readonly NormalizedModelResult[] {
  if (value === undefined) return [];
  const results: NormalizedModelResult[] = [];
  const seen = new Map<string, number>();
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const result = normalizeModelInput(entry, undefined, `${path}[${index}]`);
      const previous = seen.get(result.value.id);
      if (previous !== undefined) {
        fail(`${path}[${index}].id`, result.value.id, 'a unique model id within this provider', `{ "id": "${result.value.id}" }`, `duplicates ${path}[${previous}].id`);
      }
      seen.set(result.value.id, index);
      results.push(result);
    }
    return Object.freeze(results);
  }
  if (!isRecord(value)) fail(path, value, 'an array or map of model definitions', '{ "models": { "llama-3.1-8b": {} } }');
  for (const [id, entry] of Object.entries(value)) {
    const result = normalizeModelInput(entry, id, `${path}[${JSON.stringify(id)}]`);
    const previous = seen.get(result.value.id);
    if (previous !== undefined) {
      fail(`${path}[${JSON.stringify(id)}]`, result.value.id, 'unique model ids within this provider', '{ "models": { "llama-3.1-8b": {} } }', `duplicates the model at map entry ${previous}`);
    }
    seen.set(result.value.id, id.length);
    results.push(result);
  }
  return Object.freeze(results);
}

function pickAliasedValue(
  entries: readonly { readonly key: string; readonly value: unknown }[],
  path: string,
  allowed: string,
  example: string,
): { readonly value: unknown; readonly explicit: boolean } {
  const present = entries.filter((entry) => entry.value !== undefined);
  if (present.length === 0) return { value: undefined, explicit: false };
  const first = present[0]!;
  if (present.some((entry) => entry.value !== first.value)) {
    fail(`${path}.${first.key}`, first.value, allowed, example, 'configuration aliases conflict');
  }
  return { value: first.value, explicit: true };
}

function normalizeProviderInput(input: unknown, options: { readonly requireBaseURL: boolean }): NormalizedProviderResult {
  if (!isRecord(input)) fail('provider', input, 'a provider definition object', '{ "id": "local", "baseURL": "http://127.0.0.1:11434/v1" }');
  const source = input;
  const providerOptions = recordOrEmpty(source['options'], 'provider.options');
  const explicit = new Set<string>();
  const id = normalizeProviderId(source['id'], 'provider.id');

  const baseURL = pickAliasedValue([
    { key: 'baseURL', value: source['baseURL'] },
    { key: 'options.baseURL', value: providerOptions['baseURL'] },
  ], 'provider', 'baseURL or options.baseURL may be used, but they must agree', '{ "baseURL": "https://api.example.test/v1" }');
  if (baseURL.explicit) explicit.add('baseURL');
  const normalizedBaseURL = normalizeBaseURL(baseURL.value, baseURL.value === providerOptions['baseURL'] && source['baseURL'] === undefined ? 'provider.options.baseURL' : 'provider.baseURL', options.requireBaseURL);

  const label = aliasText(
    source,
    'label',
    'name',
    'provider',
    id,
    'a human-readable non-empty label',
    `{ "id": "${id}", "label": "My provider" }`,
    MAX_LABEL_LENGTH,
  );
  if (label.explicit) explicit.add('label');
  const description = optionalText(source, 'description', 'provider.description', 'a printable description', '{ "description": "My local gateway" }', MAX_DESCRIPTION_LENGTH);
  if (description !== undefined) explicit.add('description');

  const protocolInput = pickAliasedValue([
    { key: 'protocol', value: source['protocol'] },
    { key: 'options.protocol', value: providerOptions['protocol'] },
  ], 'provider', '"openai-chat" or "anthropic-messages"', '{ "protocol": "openai-chat" }');
  if (protocolInput.explicit) explicit.add('protocol');
  const protocol = normalizeProtocol(protocolInput.value, protocolInput.value === providerOptions['protocol'] && source['protocol'] === undefined ? 'provider.options.protocol' : 'provider.protocol');

  const authInput = pickAliasedValue([
    { key: 'auth', value: source['auth'] },
    { key: 'authMode', value: source['authMode'] },
    { key: 'options.auth', value: providerOptions['auth'] },
    { key: 'options.authMode', value: providerOptions['authMode'] },
  ], 'provider', '"api-key", "none", or "codex"', '{ "auth": "api-key" }');
  if (authInput.explicit) explicit.add('auth');
  const auth = normalizeAuth(authInput.value, 'provider.auth');

  const needKeyInput = booleanAlias([
    { key: 'needKey', value: source['needKey'] },
    { key: 'NeedKey', value: source['NeedKey'] },
    { key: 'options.needKey', value: providerOptions['needKey'] },
    { key: 'options.NeedKey', value: providerOptions['NeedKey'] },
  ], 'provider', '{ "needKey": false }');
  if (needKeyInput.explicit) explicit.add('needKey');
  const local = isLoopbackURL(normalizedBaseURL);
  // OAuth carries its own credential, so a provider on that route must not be
  // asked for an API key it has no place to put.
  const keyless = auth === 'none' || auth === 'openai-oauth';
  const needKey = keyless
    ? false
    : needKeyInput.value ?? !local;
  if (keyless && needKeyInput.value === true) {
    fail('provider.needKey', true, `false when provider.auth is "${auth}"`, '{ "auth": "none", "needKey": false }', 'contradicts the provider authentication mode');
  }
  const normalizedAuth = auth ?? (needKey ? 'api-key' : 'none');

  const defaultModelInput = pickAliasedValue([
    { key: 'defaultModel', value: source['defaultModel'] },
    { key: 'default_model', value: source['default_model'] },
    { key: 'model', value: source['model'] },
    { key: 'options.defaultModel', value: providerOptions['defaultModel'] },
  ], 'provider', 'one model id shared by defaultModel/default_model/model', '{ "defaultModel": "llama-3.1-8b" }');
  if (defaultModelInput.explicit) explicit.add('defaultModel');
  const defaultModel = defaultModelInput.value === undefined
    ? undefined
    : normalizeModelId(defaultModelInput.value, 'provider.defaultModel');

  const modelResults = normalizeModelCollection(source['models'], 'provider.models');
  const modelIds = new Set(modelResults.map((entry) => entry.value.id));
  if (defaultModel !== undefined && !modelIds.has(defaultModel)) {
    fail('provider.defaultModel', defaultModel, 'the id of one of provider.models', `{ "defaultModel": "${modelResults[0]?.value.id ?? 'llama-3.1-8b'}" }`, 'does not refer to a declared model');
  }
  if (normalizedAuth === 'none' && modelResults.some((entry) => entry.value.needKey === true)) {
    const model = modelResults.find((entry) => entry.value.needKey === true)!.value;
    fail(`provider.models[${JSON.stringify(model.id)}].needKey`, true, 'false when provider.auth is "none"', `{ "id": "${model.id}", "needKey": false }`, 'model authentication contradicts the provider authentication mode');
  }

  const sdk = source['sdk'] === undefined ? 'openai' : source['sdk'];
  if (sdk !== 'openai') fail('provider.sdk', sdk, '"openai" for an OpenAI-compatible provider', '{ "sdk": "openai" }');
  if (source['sdk'] !== undefined) explicit.add('sdk');
  const npm = source['npm'] === undefined ? undefined : text(source['npm'], 'provider.npm', 'a package name string', '{ "npm": "@ai-sdk/openai" }', { maxLength: 200 });
  if (npm !== undefined) explicit.add('npm');

  const value: CustomProviderDefinition = Object.freeze({
    id,
    label: label.value,
    description: description ?? (normalizedBaseURL ? 'Custom OpenAI-compatible provider' : 'Custom provider'),
    baseURL: normalizedBaseURL,
    protocol,
    auth: normalizedAuth,
    needKey,
    ...(defaultModel === undefined ? {} : { defaultModel }),
    models: Object.freeze(modelResults.map((entry) => entry.value)),
    sdk: 'openai',
    ...(npm === undefined ? {} : { npm }),
  });
  return { value, modelResults, explicit };
}

/** Normalize one declarative provider definition. Throws a redacted, field-level error. */
export function normalizeCustomProviderDefinition(input: CustomProviderDefinitionInput): CustomProviderDefinition {
  return normalizeProviderInput(input, { requireBaseURL: true }).value;
}

/** Normalize one model entry, whether it came from a map or a model picker. */
export function normalizeCustomModelDefinition(input: CustomModelDefinitionInput): CustomModelDefinition {
  return normalizeModelInput(input, undefined, 'model').value;
}

/** Normalize one legacy map entry without requiring a nested baseURL. */
export function normalizeStoredCustomProvider(id: string, input: unknown): CustomProviderDefinition {
  const providerId = normalizeProviderId(id, 'provider.id');
  const source = isRecord(input) ? { ...input, id: providerId } : { id: providerId };
  return normalizeProviderInput(source, { requireBaseURL: false }).value;
}

export function validateCustomModelDefinition(input: unknown): ProviderDefinitionValidation<CustomModelDefinition> {
  try {
    return { ok: true, value: normalizeModelInput(input, undefined, 'model').value };
  } catch (error) {
    if (error instanceof ProviderDefinitionError) return { ok: false, error };
    throw error;
  }
}

export function validateCustomProviderDefinition(input: unknown): ProviderDefinitionValidation<CustomProviderDefinition> {
  try {
    return { ok: true, value: normalizeCustomProviderDefinition(input as CustomProviderDefinitionInput) };
  } catch (error) {
    if (error instanceof ProviderDefinitionError) return { ok: false, error };
    throw error;
  }
}

function storedModelFromDefinition(model: CustomModelDefinition): CustomProviderModel {
  const result: Record<string, unknown> = {};
  // The map key is the id. Do not duplicate it in every persisted model row.
  if (model.label !== model.id) result['name'] = model.label;
  if (model.description) result['description'] = model.description;
  if (model.aliases !== undefined) result['aliases'] = model.aliases;
  if (model.contextWindow !== undefined) result['contextWindow'] = model.contextWindow;
  if (model.maxInputTokens !== undefined) result['maxInputTokens'] = model.maxInputTokens;
  if (model.maxOutputTokens !== undefined) result['maxOutputTokens'] = model.maxOutputTokens;
  if (model.modalities !== undefined) result['modalities'] = model.modalities;
  if (model.reasoning !== undefined) result['reasoning'] = model.reasoning;
  if (model.tools !== undefined) result['tools'] = model.tools;
  if (model.cost !== undefined) result['cost'] = model.cost;
  if (model.pricing !== undefined) result['pricing'] = model.pricing;
  if (model.ranking !== undefined) result['ranking'] = model.ranking;
  if (model.protocol !== undefined) result['protocol'] = model.protocol;
  if (model.streamSemantics !== undefined) result['streamSemantics'] = model.streamSemantics;
  if (model.needKey !== undefined) result['needKey'] = model.needKey;
  return result as CustomProviderModel;
}

/** Convert a normalized definition to the existing OpenCode-compatible map shape. */
export function customProviderDefinitionToStored(input: CustomProviderDefinitionInput): CustomProvider {
  const normalized = normalizeCustomProviderDefinition(input);
  const result: Record<string, unknown> = {
    sdk: normalized.sdk,
    name: normalized.label,
    description: normalized.description,
    protocol: normalized.protocol,
    auth: normalized.auth,
    options: {
      baseURL: normalized.baseURL,
      needKey: normalized.needKey,
    },
    models: Object.fromEntries(normalized.models.map((model) => [model.id, storedModelFromDefinition(model)])),
  };
  if (normalized.defaultModel !== undefined) result['defaultModel'] = normalized.defaultModel;
  if (normalized.npm !== undefined) result['npm'] = normalized.npm;
  return result as CustomProvider;
}

/**
 * Merge model definitions without replacing the provider's options or unknown
 * fields. A model with an existing id receives only fields explicitly supplied
 * by the incoming definition; omitted metadata can never erase saved metadata.
 */
export function mergeCustomProviderModels(
  existing: CustomProvider | undefined,
  incoming: CustomModelCollectionInput,
): CustomProvider {
  const results = normalizeModelCollection(incoming, 'models');
  const models: Record<string, CustomProviderModel> = {};
  if (existing?.models && isRecord(existing.models)) {
    for (const [id, value] of Object.entries(existing.models)) {
      models[id] = value as CustomProviderModel;
    }
  }
  for (const result of results) {
    const previous = models[result.value.id];
    models[result.value.id] = previous === undefined
      ? storedModelFromDefinition(result.value)
      : { ...previous, ...result.patch };
  }
  return {
    ...(existing ?? {}),
    models,
  };
}

function mergeRawProviderEntries(
  left: CustomProvider | undefined,
  right: CustomProvider | undefined,
): CustomProvider | undefined {
  if (!left && !right) return undefined;
  if (!left) return right;
  if (!right) return left;
  const leftOptions = isRecord(left.options) ? left.options : {};
  const rightOptions = isRecord(right.options) ? right.options : {};
  const leftModels = isRecord(left.models) ? left.models : {};
  const rightModels = isRecord(right.models) ? right.models : {};
  const models: Record<string, unknown> = { ...leftModels };
  for (const [id, value] of Object.entries(rightModels)) {
    const previous = models[id];
    models[id] = isRecord(previous) && isRecord(value)
      ? { ...previous, ...value }
      : value;
  }
  return {
    ...left,
    ...right,
    options: { ...leftOptions, ...rightOptions },
    models,
  } as CustomProvider;
}

/** Merge the legacy `providers` alias and canonical `provider` map safely. */
export function mergeCustomProviderAliases(
  providers: unknown,
  provider: unknown,
): Record<string, CustomProvider> {
  const result: Record<string, CustomProvider> = {};
  const add = (value: unknown): void => {
    if (!isRecord(value)) return;
    for (const [id, entry] of Object.entries(value)) {
      if (!isRecord(entry)) continue;
      result[id] = mergeRawProviderEntries(result[id], entry as CustomProvider)!;
    }
  };
  add(providers);
  add(provider);
  return result;
}

/**
 * Merge one complete provider into a stored config. The canonical output uses
 * the singular `provider` map and removes the duplicate `providers` alias only
 * after both maps have been unioned, so no saved model or option is lost.
 */
export function mergeCustomProviderConfig(
  stored: StoredConfig,
  input: CustomProviderDefinitionInput,
): StoredConfig {
  const normalized = normalizeProviderInput(input, { requireBaseURL: true });
  const current = mergeCustomProviderAliases(stored.providers, stored.provider);
  const merged = mergeCustomProviderDefinitionResult(current[normalized.value.id], normalized);
  const providers = { ...current, [normalized.value.id]: merged };
  const next: Record<string, unknown> = { ...stored, provider: providers };
  delete next['providers'];
  return next as StoredConfig;
}

/** Merge a complete definition into an existing provider entry. */
export function mergeCustomProviderDefinition(
  existing: CustomProvider | undefined,
  input: CustomProviderDefinitionInput,
): CustomProvider {
  const normalized = normalizeProviderInput(input, { requireBaseURL: true });
  return mergeCustomProviderDefinitionResult(existing, normalized);
}

function mergeCustomProviderDefinitionResult(
  existing: CustomProvider | undefined,
  normalized: NormalizedProviderResult,
): CustomProvider {
  const result: Record<string, unknown> = { ...(existing ?? {}) };
  const options: Record<string, unknown> = isRecord(existing?.options) ? { ...existing.options } : {};
  const isNew = existing === undefined;

  if (isNew || normalized.explicit.has('label')) {
    result['name'] = normalized.value.label;
    delete result['label'];
  }
  if (isNew || normalized.explicit.has('description')) result['description'] = normalized.value.description;
  if (isNew || normalized.explicit.has('sdk')) result['sdk'] = normalized.value.sdk;
  if (normalized.explicit.has('npm')) result['npm'] = normalized.value.npm;
  if (isNew || normalized.explicit.has('baseURL')) options['baseURL'] = normalized.value.baseURL;

  if (isNew || normalized.explicit.has('protocol')) {
    result['protocol'] = normalized.value.protocol;
    delete options['protocol'];
  }
  if (isNew || normalized.explicit.has('auth')) {
    result['auth'] = normalized.value.auth;
    delete result['authMode'];
    delete options['auth'];
    delete options['authMode'];
  }
  if (isNew || normalized.explicit.has('defaultModel')) {
    if (normalized.value.defaultModel === undefined) delete result['defaultModel'];
    else result['defaultModel'] = normalized.value.defaultModel;
    delete options['defaultModel'];
  }
  if (isNew || normalized.explicit.has('needKey')) {
    options['needKey'] = normalized.value.needKey;
    delete options['NeedKey'];
    delete result['needKey'];
    delete result['NeedKey'];
  }

  // New declarative fields are read from the normalized value. Unknown options
  // and, importantly, legacy credentials remain untouched on an existing entry.
  result['options'] = options;
  const existingModels = isRecord(existing?.models) ? existing?.models : undefined;
  const mergedModels: Record<string, CustomProviderModel> = {};
  if (existingModels) {
    for (const [id, value] of Object.entries(existingModels)) mergedModels[id] = value as CustomProviderModel;
  }
  for (const modelResult of normalized.modelResults) {
    const previous = mergedModels[modelResult.value.id];
    mergedModels[modelResult.value.id] = previous === undefined
      ? storedModelFromDefinition(modelResult.value)
      : { ...previous, ...modelResult.patch };
  }
  result['models'] = mergedModels;
  return result as CustomProvider;
}

function isLoopbackURL(value: string): boolean {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
  } catch {
    return false;
  }
}

function displayValue(path: string, value: unknown): string {
  const lowerPath = path.toLowerCase();
  if (/(key|secret|token|password|credential|authorization)/.test(lowerPath)) return '"[redacted]"';
  if (lowerPath.includes('url') && typeof value === 'string') {
    try {
      const url = new URL(value);
      url.username = '';
      url.password = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/(key|secret|token|password|credential|auth)/i.test(key)) url.searchParams.delete(key);
      }
      return JSON.stringify(url.toString());
    } catch {
      return '"[invalid URL]"';
    }
  }
  if (typeof value === 'string') {
    const bounded = value.length > 120 ? `${value.slice(0, 117)}...` : value;
    return JSON.stringify(bounded);
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return '"[unprintable]"';
  }
}
