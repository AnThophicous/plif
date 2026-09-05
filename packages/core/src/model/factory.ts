/**
 * Choosing the adapter for a resolved configuration.
 *
 * Everything Plif talks to speaks the OpenAI wire format except Anthropic, so
 * this is one branch rather than a registry. It exists so that the branch lives
 * in exactly one place: a call site that constructs `OpenAIProvider` directly
 * is a call site that silently sends Claude a payload it cannot read.
 */

import { PlifError } from '../errors.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider, type OpenAIProviderOptions } from './openai.js';
import { usesChatGptOAuth, type ModelConfig } from './config.js';
import type { ModelProvider } from './provider.js';

/** True when this endpoint needs the Anthropic SDK rather than the OpenAI one. */
export function isAnthropicEndpoint(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname;
    return host === 'api.anthropic.com' || host.endsWith('.anthropic.com');
  } catch {
    return false;
  }
}

/**
 * Refuse to build a provider that is guaranteed to be rejected.
 *
 * The credential store is asynchronous and `resolveConfig` is not, so a stored
 * key only reaches a provider when the caller remembers to look it up and pass
 * it in as `options.apiKey`. A caller that forgets gets `apiKey: ""` back with
 * no complaint, and the mistake surfaces one network round trip later as a 401
 * — indistinguishable, from the outside, from a key the endpoint genuinely
 * rejected. That confusion is expensive: recovery reads it as a bad key and
 * deletes the good credential, which fixes nothing and loses the key.
 *
 * So the check happens here instead, where every construction path converges.
 * The condition is exactly the one `validate()` already encodes for keys, and
 * it deliberately does not repeat that function's other checks: discovery
 * builds providers with no model set in order to *list* models, and rejecting
 * those would break the picker.
 */
function assertCredentialPresent(config: ModelConfig): void {
  if (usesChatGptOAuth(config)) return;
  if (config.apiKey || config.needKey !== true) return;
  throw new PlifError(
    'MODEL_NOT_CONFIGURED',
    `no credential reached the provider for "${config.model || 'this model'}"`,
    {
      detail: { endpoint: config.baseURL, ...(config.providerId ? { providerId: config.providerId } : {}) },
      hint:
        'This endpoint requires a key and none was supplied. Look the credential up with ' +
        'CredentialBroker and pass it as resolveConfig({ apiKey }), or run `plif model` to see what is loaded.',
    },
  );
}

export function createModelProvider(
  config: ModelConfig,
  options: OpenAIProviderOptions = {},
): ModelProvider {
  assertCredentialPresent(config);
  if (config.protocol === 'anthropic-messages' || isAnthropicEndpoint(config.baseURL)) {
    return new AnthropicProvider(config);
  }
  return new OpenAIProvider(config, options);
}
