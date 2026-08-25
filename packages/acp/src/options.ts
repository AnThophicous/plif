/**
 * Session options for the plif ACP adapter: permission modes and the model
 * picker. SECURE EDITION.
 *
 * Differences from the original PR:
 * - `applyModelChoice` now takes an explicit `persist` flag. Session-local
 *   switches never touch ~/.plif/config.toml; persisting is a local opt-in.
 * - Model enumeration never exposes credential values (same as before), and
 *   the picker lists only providers whose keys the local broker can resolve.
 */

import {
  MODEL_CATALOG,
  userCatalog,
  selectAvailableModels,
  rankAvailableModels,
  catalogSelection,
  credentialVariableForProvider,
  loadStoredConfig,
  resolveConfig,
  saveStoredConfig,
  validateModelConfig,
  providerIdForConfig,
  type CredentialBroker,
  type Engine,
  type ModelCatalogProvider,
  type StoredConfig,
  type ProviderAccess,
} from '@plif/core';

// ── Permission modes ───────────────────────────────────────────────────
export type PlifMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export const MODES: ReadonlyArray<{ id: PlifMode; name: string; description: string }> = [
  {
    id: 'default',
    name: 'Manual',
    description: 'Standard behavior: asks permission for sensitive operations',
  },
  {
    id: 'acceptEdits',
    name: 'Accept Edits',
    description: 'Auto-accepts file writes/deletes; still asks for everything else',
  },
  {
    id: 'bypassPermissions',
    name: 'Bypass Permissions',
    description: 'Auto-accepts everything — no permission prompts (requires local opt-in)',
  },
];

export function isKnownMode(id: string): id is PlifMode {
  return MODES.some((m) => m.id === id);
}

// ── Provider access ────────────────────────────────────────────────────
function isLocalEndpoint(endpoint: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|::1)(?::\d+)?(?:\/|$)/i.test(endpoint);
}

function catalogProviders(stored: StoredConfig): ModelCatalogProvider[] {
  const byId = new Map<string, ModelCatalogProvider>();
  for (const p of MODEL_CATALOG) byId.set(p.id, p);
  for (const p of userCatalog(stored)) byId.set(p.id, p); // user entries shadow builtins
  return [...byId.values()];
}

async function buildAccessMap(
  stored: StoredConfig,
  credentials: CredentialBroker,
  activeProvider: string | undefined,
): Promise<Map<string, ProviderAccess>> {
  const entries: Array<[string, ProviderAccess]> = [];
  for (const provider of catalogProviders(stored)) {
    if (provider.auth === 'codex') {
      if (provider.id === activeProvider) entries.push([provider.id, 'configured']);
      continue;
    }
    const variable = credentialVariableForProvider(provider.id, stored);
    const key = await credentials.lookup(variable);
    if (provider.anonymous) {
      entries.push([provider.id, key ? 'configured' : 'free']);
      continue;
    }
    if (isLocalEndpoint(provider.endpoint)) {
      entries.push([provider.id, 'local']);
      continue;
    }
    if (key) entries.push([provider.id, 'configured']);
  }
  return new Map(entries);
}

// ── Model picker ───────────────────────────────────────────────────────
export interface ModelPickerGroup {
  group: string;
  name: string;
  options: Array<{ value: string; name: string; description?: string }>;
}

export interface ModelPickerState {
  options: ModelPickerGroup[];
  currentValue: string;
}

function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}m`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

export async function buildModelPicker(
  stored: StoredConfig,
  credentials: CredentialBroker,
): Promise<ModelPickerState> {
  const providers = catalogProviders(stored);
  const activeProvider = providerIdForConfig(stored, {}) ?? undefined;
  const access = await buildAccessMap(stored, credentials, activeProvider);
  const ranked = rankAvailableModels(selectAvailableModels(providers, access)).slice(0, 60);

  const groups = new Map<string, ModelPickerGroup>();
  for (const item of ranked) {
    const value = `${item.provider.id}::${item.model.id}`;
    const ctx = formatTokens(item.model.contextWindow ?? 0);
    const description = [item.provider.label, ctx ? `${ctx} ctx` : null]
      .filter(Boolean)
      .join(' · ');
    let group = groups.get(item.provider.id);
    if (!group) {
      group = { group: item.provider.id, name: item.provider.label, options: [] };
      groups.set(item.provider.id, group);
    }
    group.options.push({ value, name: item.model.label || item.model.id, description });
  }

  const currentProvider = providerIdForConfig(stored, {}) ?? '';
  const currentValue = stored.model ? `${currentProvider}::${stored.model}` : '';
  const present = [...groups.values()].some((g) =>
    g.options.some((o) => o.value === currentValue),
  );
  if (currentValue && !present) {
    groups.set('_current', {
      group: '_current',
      name: 'Current',
      options: [{ value: currentValue, name: stored.model ?? currentValue }],
    });
  }
  return { options: [...groups.values()], currentValue };
}

/**
 * Apply a model choice. When `persist` is false the switch is session-local
 * only: the returned config is used to rebuild the picker but is never
 * written to disk. When true, it persists exactly like `plif model set`
 * (only reachable through the local security policy).
 */
export async function applyModelChoice(
  engine: Engine,
  stored: StoredConfig,
  credentials: CredentialBroker,
  value: string,
  persist: boolean,
): Promise<StoredConfig> {
  const sep = value.indexOf('::');
  if (sep <= 0) throw new Error(`Invalid model selection: ${value}`);
  const providerId = value.slice(0, sep);
  const modelId = value.slice(sep + 2);

  const selection = catalogSelection(providerId, modelId);
  if (!selection) throw new Error(`Unknown model: ${modelId} (${providerId})`);

  const next: StoredConfig = { ...stored, preset: selection.preset, model: selection.model };

  const nextProviderId = providerIdForConfig(next, {}) ?? '';
  const variable = credentialVariableForProvider(nextProviderId, next);
  const key = await credentials.lookup(variable);
  const check = validateModelConfig(resolveConfig(next, key ? { apiKey: key } : {}));
  if (!check.ok) {
    throw new Error(
      `Cannot switch to ${modelId}: ${check.problem ?? 'invalid configuration'}${
        check.hint ? ` (${check.hint})` : ''
      }`,
    );
  }

  if (persist) {
    await saveStoredConfig(engine.paths, next, { preserveProviderKeys: false });
  }
  return next;
}

export { loadStoredConfig };