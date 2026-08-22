/**
 * Choosing the adapter for a resolved configuration.
 *
 * Everything Plif talks to speaks the OpenAI wire format except Anthropic, so
 * this is one branch rather than a registry. It exists so that the branch lives
 * in exactly one place: a call site that constructs `OpenAIProvider` directly
 * is a call site that silently sends Claude a payload it cannot read.
 */

import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider, type OpenAIProviderOptions } from './openai.js';
import type { ModelConfig } from './config.js';
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

export function createModelProvider(
  config: ModelConfig,
  options: OpenAIProviderOptions = {},
): ModelProvider {
  if (config.protocol === 'anthropic-messages' || isAnthropicEndpoint(config.baseURL)) {
    return new AnthropicProvider(config);
  }
  return new OpenAIProvider(config, options);
}
