/**
 * Model provider construction from the stored plif config.
 *
 * Mirrors the CLI's buildProvider() minus CLI-flag overrides, since an ACP
 * session always uses whatever `plif model set` persisted. SECURE EDITION:
 * unchanged from the original PR apart from never logging credential values.
 */

import path from 'node:path';
import {
  CredentialBroker,
  ProviderCapabilityCache,
  createModelProvider,
  credentialVariableForProvider,
  loadStoredConfig,
  platformSecretStore,
  providerIdForConfig,
  resolveConfig,
  validateModelConfig,
  type Engine,
  type ModelConfig,
  type ModelProvider,
  type StoredConfig,
} from '@plif/core';

export interface ProviderBundle {
  provider: ModelProvider;
  stored: StoredConfig;
  credentials: CredentialBroker;
  capabilityCache: ProviderCapabilityCache;
  promptConfig: ModelConfig;
}

export async function buildProviderFromStoredConfig(engine: Engine, storedOverride?: StoredConfig): Promise<ProviderBundle> {
  const capabilityCache = new ProviderCapabilityCache({
    file: path.join(engine.paths.root, 'model-capabilities.json'),
  });
  const credentials = new CredentialBroker({ store: platformSecretStore() });
  let stored = storedOverride ?? await loadStoredConfig(engine.paths);

  // A clean install should be usable immediately: fall back to the built-in
  // anonymous OpenCode route when nothing is configured at all. Explicit
  // choices are never redirected. (Same policy as the CLI.)
  const providerId = providerIdForConfig(stored, {});
  const hasExplicitRoute = Boolean(
    stored.model ||
      stored.preset ||
      providerId ||
      stored.baseURL ||
      process.env['PLIF_MODEL'] ||
      process.env['PLIF_PRESET'] ||
      process.env['PLIF_BASE_URL'],
  );
  if (!hasExplicitRoute) {
    const fallback = { preset: 'opencode' as const, model: 'deepseek-v4-flash-free' };
    const fallbackConfig = resolveConfig(stored, fallback);
    if (validateModelConfig(fallbackConfig).ok) {
      const next = { ...stored, ...fallback };
      stored = next;
    }
  }

  const effectiveProvider = providerIdForConfig(stored, {});
  const credentialVariable = credentialVariableForProvider(effectiveProvider ?? '', stored);
  const storedKey = await credentials.lookup(credentialVariable);

  const config = resolveConfig(stored, {
    ...(storedKey ? { apiKey: storedKey } : {}),
  });
  const check = validateModelConfig(config);
  if (!check.ok) {
    throw new Error(
      `plif has no usable model configured: ${check.problem ?? 'unknown problem'}. ` +
        `${check.hint ? `Hint: ${check.hint}. ` : ''}` +
        `Run "plif model set <model>" in a terminal, then try again.`,
    );
  }

  const provider = createModelProvider(config, { capabilityCache, bus: engine.bus });
  return { provider, stored, credentials, capabilityCache, promptConfig: config };
}
