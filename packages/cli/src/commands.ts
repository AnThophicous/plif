/**
 * Slash commands.
 *
 * Held in one table rather than a switch so that `/help` is generated from the
 * same source that dispatches — a help text that can drift from behaviour is
 * worse than none, because it is confidently wrong.
 *
 * Commands return timeline entries; they never render. That keeps them testable
 * without a terminal and keeps all layout decisions inside components.
 */

import path from 'node:path';

import {
  CredentialBroker,
  credentialVariableForProvider,
  discoverProviderModels,
  EFFORT_LEVELS,
  findCatalogModel,
  findCatalogProvider,
  MODEL_CATALOG,
  modelVisionBadge,
  rankFacts,
  rankModelIds,
  providerIdForConfig,
  selectAvailableModels,
  supportedEfforts,
  strategyStatus,
  userCatalog,
  visionCandidates,
} from '@plif/core';
import type {
  Container,
  Effort,
  Engine,
  ModelCatalogProvider,
  ModelCatalogModel,
  ModelProvider,
  ModelSelection,
  ProviderModel,
  ProviderAccess,
  StoredConfig,
} from '@plif/core';
import {
  globalConfigPath,
  isAutoApproveEnabled,
  loadGlobalConfig,
  permissionMode,
  setAutoApprove,
  setPermissionMode,
  saveGlobalConfig,
  profilesOf,
  PlifError,
} from '@plif/core';

import { formatCapabilities, tokenize } from './format.js';
import { effortVisual } from './effort-visuals.js';
import {
  effortPickerItems,
} from './components/Picker.js';
import { formatStatus } from './status.js';
import type { StatusInput } from './status.js';
import type { PickerGroup, PickerItem } from './components/Picker.js';

import { entry } from './session.js';
import type { BrowserTab, TimelineEntry } from './session.js';
import { formatBytes, formatDuration, glyph, shortenPath, type PaletteKey } from './theme.js';
import { containerMount, containerWorkdir } from './container-paths.js';
import type { ThemeDefinition } from './themes.js';

export interface CommandContext {
  readonly engine: Engine;
  /** The container input is currently aimed at, if any. */
  readonly current: Container | null;
  readonly setCurrent: (container: Container | null) => void;
  readonly clear: () => void;
  readonly exit: () => void;
  readonly cwd: string;
  readonly model: ModelProvider | null;
  readonly modelProblem: string | null;
  readonly switchModel: (selection: ModelSelection | string) => Promise<void>;
  readonly credentials?: CredentialBroker;
  readonly setEffort: (effort: Effort | undefined) => Promise<void>;
  readonly supportedEfforts?: () => readonly Effort[];
  /** Curated/live model ids available to the generic argument completer. */
  readonly modelCompletionValues?: () => readonly string[];
  /** Enter or leave the read-only planning mode. */
  readonly setPlanMode?: (enabled: boolean, description?: string) => Promise<void>;
  /** Start a session-scoped completion condition. */
  readonly startGoal?: (condition: string) => Promise<void>;
  readonly goalStatus?: () => { readonly condition: string; readonly status: 'active' } | null;
  readonly clearGoal?: () => void;
  readonly switchProfile: (name: string) => Promise<void>;
  /**
   * Shrink the conversation now, rather than waiting for the threshold.
   *
   * Resolves to what it did, so the command can report it. The conversation
   * itself lives in the app — commands never hold it — which is why this is a
   * callback rather than something `/compact` could do on its own.
   */
  readonly compactNow: (aggressive: boolean) => Promise<{ before: number; after: number }>;
  /** Open the MCP & skills browser on a given tab. */
  readonly openBrowser: (tab: BrowserTab) => void;
  /** Authenticate one MCP server by name, reporting what happened. */
  readonly loginMcp: (server: string) => Promise<TimelineEntry>;
  /** The MCP servers this session knows about, for naming them back. */
  readonly mcpNames: readonly string[];
  /** Pull an image off the clipboard and attach it to the line being typed. */
  readonly pasteImage: () => Promise<void>;
  readonly openPicker: (picker: FlatPickerRequest | CatalogPickerRequest) => void;
  readonly copySession?: () => Promise<void>;
  readonly saveSession?: () => Promise<void>;
  readonly themes: readonly ThemeDefinition[];
  readonly switchTheme: (id: string) => Promise<void>;
  readonly sessionStatus?: () => StatusInput;
  /** Full-screen utility views keep their own keyboard lifecycle. */
  readonly openStatus?: () => void;
  readonly openConfig?: () => void;
}

export interface FlatPickerRequest {
  readonly title: string;
  readonly hint?: string;
  readonly countLabel?: string;
  readonly items: readonly PickerItem[];
  readonly onPick: (value: string | ModelSelection) => void;
  /** Initial keyboard position; defaults to the first visible row. */
  readonly selected?: number;
  readonly onBack?: () => void;
}

export interface CatalogPickerRequest {
  readonly title: string;
  readonly hint?: string;
  readonly countLabel?: string;
  readonly groups: readonly PickerGroup[];
  readonly expanded: readonly string[];
  readonly selected: number;
  readonly onPick: (selection: string | ModelSelection) => void;
  readonly onBack?: () => void;
}

export interface CommandArgumentCompletionContext {
  readonly command: Command;
  readonly context: CommandContext;
  readonly input: string;
  readonly cursor: number;
  readonly argv: readonly string[];
  readonly argumentIndex: number;
  readonly token: string;
  readonly tokenStart: number;
  readonly tokenEnd: number;
}

export interface CommandAutocomplete {
  /** A fixed enum, when the command's values never depend on session state. */
  readonly values?: readonly string[];
  /** A session-aware enum, used when provider/model capabilities can change. */
  readonly getValues?: (context: CommandArgumentCompletionContext) => readonly string[];
  readonly getDetail?: (
    value: string,
    context: CommandArgumentCompletionContext,
  ) => string | undefined;
  /** Row tone for a value that carries visual identity, e.g. the PLIF signature. */
  readonly getTone?: (value: string) => PaletteKey | undefined;
}

export interface ArgumentCompletion {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly tone?: PaletteKey;
}

export interface ArgumentCompletionState {
  readonly command: Command;
  readonly input: string;
  readonly cursor: number;
  readonly argumentIndex: number;
  readonly token: string;
  readonly tokenStart: number;
  readonly tokenEnd: number;
  readonly matches: readonly ArgumentCompletion[];
}

export interface CommandResult {
  readonly entries: readonly TimelineEntry[];
}

export interface Command {
  readonly name: string;
  /** Older spellings remain dispatchable without creating duplicate menu rows. */
  readonly aliases?: readonly string[];
  readonly args?: string;
  readonly summary: string;
  readonly concurrent?: boolean;
  /** Optional argument metadata consumed by the generic TAB completer. */
  readonly autocomplete?: CommandAutocomplete;
  readonly run: (argv: readonly string[], context: CommandContext) => Promise<CommandResult>;
}

export function runsWhileWorking(name: string): boolean {
  return findCommand(name)?.concurrent === true;
}

const ok = (...entries: TimelineEntry[]): CommandResult => ({ entries });

const formatTokens = (value: number): string =>
  value < 1000 ? `${value} tokens` : `${(value / 1000).toFixed(1)}k tokens`;

export function validateEffortArgument(
  value: string,
  available: readonly Effort[],
): Effort | 'default' {
  if (value === 'default') return value;
  if (!EFFORT_LEVELS.includes(value as Effort)) {
    throw new PlifError('INVALID_ARGUMENT', `Unknown effort "${value}".`, {
      hint: `Available: default, ${available.join(', ')}`,
    });
  }
  if (!available.includes(value as Effort)) {
    throw new PlifError('INVALID_ARGUMENT', `${value} is not supported by the current model.`, {
      hint: `Supported: ${available.join(', ')}`,
    });
  }
  return value as Effort;
}

/** Keep verified built-ins visible while adding everything the endpoint reports. */
export function providerModelIds(
  catalog: ModelCatalogProvider,
  discoveredIds: readonly string[],
  live: boolean,
  access?: ProviderAccess,
  discoveredModels: readonly ProviderModel[] = [],
): string[] {
  if (!live) {
    return catalog.models
      .filter((item) => access !== 'free' || item.badges.includes('no key'))
      .map((item) => item.id);
  }
  // A successful provider response is authoritative. Merging the static list
  // here would keep retired models selectable forever.
  const metadata = new Map(discoveredModels.map((model) => [model.id, model]));
  return [...new Set(discoveredIds)].filter((id) => {
    if (access !== 'free') return true;
    // A live response is authoritative for availability, but not for
    // authentication. Unknown/paid rows must not inherit Zen's provider-level
    // anonymous badge merely because they came from the same endpoint.
    const discovered = metadata.get(id);
    const curated = catalog.models.find((model) => model.id === id);
    return discovered?.cost === 'free' || curated?.badges.includes('no key') === true;
  });
}

/** Built-ins hidden by a user provider with the same id. */
export function builtInPickerProviders(
  custom: readonly ModelCatalogProvider[],
  builtins: readonly ModelCatalogProvider[] = MODEL_CATALOG,
): readonly ModelCatalogProvider[] {
  const customIds = new Set(custom.map((provider) => provider.id));
  return builtins.filter((provider) => !customIds.has(provider.id));
}

function pickerBadges(
  candidate: ModelCatalogModel | undefined,
  hasVisionHelper: boolean,
): readonly string[] {
  if (!candidate) return [];
  const vision = modelVisionBadge(candidate, hasVisionHelper);
  return vision ? [...new Set([...candidate.badges, vision])] : candidate.badges;
}

interface ProviderSource {
  readonly entryProvider: ModelCatalogProvider;
  readonly section: string;
}

function providerSources(stored: StoredConfig): ProviderSource[] {
  const mine = userCatalog(stored);
  return [
    ...mine.map((entryProvider) => ({ entryProvider, section: 'your providers' })),
    ...builtInPickerProviders(mine).map((entryProvider) => ({ entryProvider, section: 'built into PLIF' })),
  ];
}

function modelRowItem(
  source: ModelCatalogProvider,
  model: ModelCatalogModel,
  access: ProviderAccess | undefined,
  currentProvider: string | undefined,
  currentModel: string | undefined,
  hasVisionHelper: boolean,
): PickerItem {
  const discoveredProvider = model.provider ? findCatalogProvider(model.provider) : undefined;
  // Raw discovery provenance wins when a gateway explicitly identifies a
  // different registered offer. This prevents a Go row from being rendered or
  // persisted as Zen merely because the endpoint was opened through a stale
  // provider entry.
  const effectiveSource = discoveredProvider ?? source;
  const badges = pickerBadges(model, hasVisionHelper);
  const capabilities = model.modalities?.map((modality) => modality === 'image' ? 'vision' : 'text') ?? [];
  const auth = access === 'free'
    ? model.cost === 'free' || model.badges.includes('no key')
      ? 'Free · no key'
      : model.cost === 'paid'
        ? 'Paid · key required'
        : 'Unknown · verify access'
    : access === 'local'
      ? 'Local'
      : access === 'configured'
        ? 'Configured'
        : model.cost === 'paid'
          ? 'Paid · API key'
          : 'API key';
  const current = effectiveSource.id === currentProvider && model.id === currentModel;
  return {
    value: `${effectiveSource.id}:${model.id}`,
    label: model.label,
    detail: model.description,
    badges,
    current,
    provider: effectiveSource.label,
    capabilities,
    ...(model.contextWindow === undefined ? {} : { context: formatContext(model.contextWindow) }),
    auth,
    ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
    ...(model.tools === undefined ? {} : { tools: model.tools }),
    ...(model.cost === undefined ? {} : { cost: model.cost }),
    searchText: [effectiveSource.id, effectiveSource.label, model.id, model.description, ...badges].join(' '),
    selection: {
      preset: effectiveSource.id,
      model: model.id,
      ...(model.protocol ? { protocol: model.protocol } : {}),
      ...(model.streamSemantics ? { streamSemantics: model.streamSemantics } : {}),
    },
  };
}

/**
 * Model-first catalog. Availability is resolved from provider state and the
 * provider-owned discovery cache; static catalog rows are used only until a
 * provider has answered authoritatively. `/providers` can deliberately open
 * one locked provider to configure it.
 */
async function openModelPicker(
  context: CommandContext,
  stored: StoredConfig,
  sources: readonly ProviderSource[],
  currentProvider: string | undefined,
  currentModel: string | undefined,
  title: string,
  hint: string,
  onBack?: () => void,
  options: { readonly availableOnly?: boolean } = {},
): Promise<void> {
  const access = await providerAccessMap(sources, stored, context.credentials, currentProvider);
  const visibleSources = options.availableOnly
    ? sources.filter(({ entryProvider }) => access.has(entryProvider.id))
    : sources;
  const discovered = new Map<string, Awaited<ReturnType<typeof discoverProviderModels>>>();
  await Promise.all(visibleSources.map(async ({ entryProvider }) => {
    const key = await providerKey(entryProvider.id, stored, context.credentials);
    const result = await discoverProviderModels(entryProvider.id, {
      stored,
      waitForNetwork: false,
      ...(key ? { apiKey: key } : {}),
    });
    discovered.set(entryProvider.id, result);
  }));
  const selectedModels = visibleSources.flatMap(({ entryProvider }) => {
    const state = access.get(entryProvider.id);
    const live = discovered.get(entryProvider.id);
    const ids = providerModelIds(
      entryProvider,
      live?.ids ?? [],
      live?.live === true,
      access.get(entryProvider.id),
      live?.models ?? [],
    );
    const metadata = new Map((live?.models ?? []).map((model) => [model.id, model]));
    return ids.map((id) => ({
      provider: entryProvider,
      model: mergeDiscoveredModel(entryProvider, id, metadata.get(id)),
      access: state,
    }));
  }).filter(({ provider }) => !options.availableOnly || access.has(provider.id));
  const currentProviderResult = currentProvider ? discovered.get(currentProvider) : undefined;
  if (currentProvider && currentModel && currentProviderResult?.live && !currentProviderResult.stale) {
    const currentStillExists = currentProviderResult.ids.includes(currentModel);
    const replacement = currentProviderResult.ids[0];
    if (!currentStillExists && replacement) {
      // A successful catalog response is stronger evidence than the static
      // catalog. Move a dead active model to the provider's first stable
      // result; if no result exists, leave the provider untouched and let the
      // normal error path explain the next request.
      void context.switchModel({ preset: currentProvider, model: replacement });
    }
  }
  const hasVisionHelper = visionCandidates(stored).length > 0;
  const items = selectedModels.map(({ provider, model, access: providerAccess }) =>
    modelRowItem(provider, model, providerAccess, currentProvider, currentModel, hasVisionHelper));
  const duplicateLabels = new Map<string, number>();
  for (const item of items) duplicateLabels.set(item.label.toLowerCase(), (duplicateLabels.get(item.label.toLowerCase()) ?? 0) + 1);
  const qualifiedItems = items.map((item) => duplicateLabels.get(item.label.toLowerCase())! > 1 && item.provider
    ? { ...item, label: `${item.label} (${shortProviderName(item.provider)})` }
    : item);
  const currentItem = selectedModels.find(({ provider, model }) =>
    provider.id === currentProvider && model.id === currentModel);
  const availableProviderIds = new Set(selectedModels.map(({ provider }) => provider.id));
  const hasLockedProviders = sources.some(({ entryProvider }) => !availableProviderIds.has(entryProvider.id));
  const modelHint = options.availableOnly
    ? [
        `Current  ${currentItem?.model.label ?? currentModel ?? 'none'}`,
        ...(hasLockedProviders ? ['Add providers with /providers to unlock more models.'] : []),
      ].join('\n')
    : hint;

  context.openPicker({
    title,
    hint: modelHint,
    countLabel: 'available',
    items: qualifiedItems,
    selected: Math.max(0, qualifiedItems.findIndex((item) => item.current)),
    onPick: (selection) => {
      if (typeof selection !== 'string') void context.switchModel(selection);
    },
    ...(onBack ? { onBack } : {}),
  });
}

function mergeDiscoveredModel(
  source: ModelCatalogProvider,
  id: string,
  discovered?: ProviderModel,
): ModelCatalogModel {
  const curated = findCatalogModel(source.id, id);
  if (!discovered) return curated ?? {
    id,
    label: friendlyModelName(id),
    description: 'Discovered from the provider',
    badges: ['live'],
  };
  return {
    ...(curated ?? {
      id,
      label: discovered.name ?? friendlyModelName(id),
      description: 'Discovered from the provider',
      badges: ['live'],
    }),
    ...(discovered.name ? { label: discovered.name } : {}),
    ...(discovered.contextWindow === undefined ? {} : { contextWindow: discovered.contextWindow }),
    ...(discovered.reasoning === undefined ? {} : { reasoning: discovered.reasoning }),
    ...(discovered.tools === undefined ? {} : { tools: discovered.tools }),
    ...(discovered.modalities === undefined ? {} : { modalities: discovered.modalities }),
    ...(discovered.cost === undefined ? {} : { cost: discovered.cost }),
    ...(discovered.provider === undefined ? {} : { provider: discovered.provider }),
    ...(discovered.product === undefined ? {} : { product: discovered.product }),
    ...(discovered.tier === undefined ? {} : { tier: discovered.tier }),
    ...(discovered.protocol === undefined ? {} : { protocol: discovered.protocol }),
    ...(discovered.streamSemantics === undefined ? {} : { streamSemantics: discovered.streamSemantics }),
    ...(discovered.cost === undefined && source.defaultCost ? { cost: source.defaultCost } : {}),
  };
}

function friendlyModelName(id: string): string {
  const tail = id.split('/').pop() ?? id;
  return tail
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

async function providerKey(
  providerId: string,
  stored: StoredConfig,
  credentials: CredentialBroker | undefined,
): Promise<string | undefined> {
  if (!credentials) return undefined;
  try {
    return await credentials.lookup(credentialVariableForProvider(providerId, stored));
  } catch {
    return undefined;
  }
}

async function providerAccessMap(
  sources: readonly ProviderSource[],
  stored: StoredConfig,
  credentials: CredentialBroker | undefined,
  activeProvider: string | undefined,
): Promise<Map<string, ProviderAccess>> {
  const entries = await Promise.all(sources.map(async ({ entryProvider }) => {
    const key = await providerKey(entryProvider.id, stored, credentials);
    if (entryProvider.anonymous) return [entryProvider.id, key ? 'configured' as const : 'free' as const] as const;
    if (isLocalEndpoint(entryProvider.endpoint)) return [entryProvider.id, 'local' as const] as const;
    // Preview/test contexts have no broker. A declared custom provider or the
    // already active provider is trusted there; production always has the
    // broker and therefore remains key-gated.
    if (key || (!credentials && (entryProvider.origin === 'user' || entryProvider.id === activeProvider))) {
      return [entryProvider.id, 'configured' as const] as const;
    }
    return null;
  }));
  return new Map(entries.filter((entry): entry is readonly [string, ProviderAccess] => entry !== null));
}

function isLocalEndpoint(endpoint: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|::1)(?::\d+)?(?:\/|$)/i.test(endpoint);
}

function formatContext(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return 'Unknown';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}m`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function shortProviderName(provider: string): string {
  return provider.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+AI$/i, '').trim();
}

function providerPickerItems(
  sources: readonly ProviderSource[],
  activeProvider: string | undefined,
  access: ReadonlyMap<string, ProviderAccess>,
  discovered: ReadonlyMap<string, Awaited<ReturnType<typeof discoverProviderModels>>> = new Map(),
): PickerItem[] {
  return sources.map(({ entryProvider }) => {
    const state = access.get(entryProvider.id);
    const auth = state === 'free'
      ? 'Free · no key'
      : state === 'local'
        ? 'Local'
        : state === 'configured'
          ? 'Configured'
          : 'API key to unlock';
    const live = discovered.get(entryProvider.id);
    const available = live?.live
      ? live.ids.length
      : state
        ? selectAvailableModels([entryProvider], new Map([[entryProvider.id, state]])).length
        : 0;
    const discoveryState = live?.error
      ? 'model discovery unavailable'
      : live?.source === 'fallback'
        ? 'discovering models…'
        : undefined;
    return {
      value: entryProvider.id,
      label: entryProvider.label,
      detail: `${entryProvider.description} · ${discoveryState ?? (available > 0 ? `${available} model${available === 1 ? '' : 's'} available` : auth)}`,
      badges: [entryProvider.origin === 'user' ? 'custom' : 'built-in', auth],
      current: entryProvider.id === activeProvider,
      searchText: [entryProvider.id, entryProvider.label, entryProvider.description, auth].join(' '),
    };
  });
}

async function openProviderPicker(
  context: CommandContext,
  stored: StoredConfig,
  sources: readonly ProviderSource[],
  onBack?: () => void,
): Promise<void> {
  const activeProvider = providerIdForConfig(stored) ?? undefined;
  const activeLabel = sources.find(({ entryProvider }) => entryProvider.id === activeProvider)?.entryProvider.label;
  const access = await providerAccessMap(sources, stored, context.credentials, activeProvider);
  const discovered = new Map<string, Awaited<ReturnType<typeof discoverProviderModels>>>();
  await Promise.all(sources.filter(({ entryProvider }) => access.has(entryProvider.id)).map(async ({ entryProvider }) => {
    const key = await providerKey(entryProvider.id, stored, context.credentials);
    discovered.set(entryProvider.id, await discoverProviderModels(entryProvider.id, {
      stored,
      waitForNetwork: false,
      ...(key ? { apiKey: key } : {}),
    }));
  }));
  const items = providerPickerItems(sources, activeProvider, access, discovered);
  context.openPicker({
    title: 'Select provider',
    hint: `active: ${activeLabel ?? 'none'} · Enter opens its models`,
    countLabel: 'providers',
    items,
    selected: Math.max(0, items.findIndex((item) => item.current)),
    onPick: (value) => {
      const selected = sources.find(({ entryProvider }) => entryProvider.id === String(value))?.entryProvider;
      if (!selected) return;
      const sameProvider = selected.id === activeProvider;
      void openModelPicker(
        context,
        stored,
        [{ entryProvider: selected, section: 'selected provider' }],
        selected.id,
        sameProvider ? context.model?.info.id : undefined,
        `Provider / ${selected.label}`,
        `${selected.description} · select a model · Esc returns to providers`,
        () => { void openProviderPicker(context, stored, sources, onBack); },
        { availableOnly: false },
      );
    },
    ...(onBack ? { onBack } : {}),
  });
}

export const COMMANDS: readonly Command[] = [
  {
    name: 'theme',
    concurrent: true,
    summary: 'Choose a built-in or ~/.plif/*.theme appearance',
    run: async (_argv, context) => {
      const stored = await loadGlobalConfig();
      context.openPicker({
        title: 'Choose a theme',
        items: context.themes.map((theme) => ({
          value: theme.id,
          label: theme.name,
          detail: theme.description ?? (theme.source === 'user' ? '~/.plif' : 'built in'),
          current: (stored.theme ?? 'minimal') === theme.id,
        })),
        onPick: (value) => { void context.switchTheme(String(value)); },
      });
      return ok();
    },
  },
  {
    name: 'compact',
    args: '[hard]',
    summary: 'Summarise the conversation so far and free up context',
    /**
     * Compaction on demand.
     *
     * The loop compacts on its own at the threshold, so this is not about
     * necessity — it is about timing. Compaction costs a model call over the
     * whole transcript, and having it fire in the middle of a task, unasked,
     * is exactly when a developer least wants to wait for it. Doing it between
     * tasks, when the last thing finished and the next has not started, is
     * free in every way that matters.
     *
     * `hard` targets a third of the window instead of the usual seventy
     * percent, for when the next task is a large one.
     */
    run: async (argv, context) => {
      const aggressive = argv[0] === 'hard';
      const { before, after } = await context.compactNow(aggressive);
      if (before === after) {
        return ok(
          entry('notice', 'nothing to compact', {
            tone: 'muted',
            subtitle: `the conversation is ${formatTokens(before)} and already lean`,
          }),
        );
      }
      return ok(
        entry('notice', `compacted ${formatTokens(before)} → ${formatTokens(after)}`, {
          tone: 'accent',
          subtitle: `${Math.round((1 - after / Math.max(1, before)) * 100)}% of the context freed`,
        }),
      );
    },
  },
  {
    name: 'mcp',
    concurrent: true,
    args: '[<server> login]',
    summary: 'Browse MCP servers, skills, and the plugin marketplace',
    /**
     * Both word orders are accepted. `/mcp github login` reads as a sentence
     * and `/mcp login github` is the shape every other CLI uses; guessing
     * wrong should not cost a round trip to the help text.
     */
    run: async (argv, context) => {
      const words = argv.map((word) => word.trim()).filter(Boolean);
      const verb = words.findIndex((word) => word.toLowerCase() === 'login');

      if (verb === -1) {
        if (words.length === 0) {
          context.openBrowser('mcp');
          return ok();
        }
        return ok(
          entry('notice', `/mcp does not know "${words.join(' ')}"`, {
            tone: 'warn',
            subtitle: '/mcp to browse · /mcp <server> login to authenticate one',
          }),
        );
      }

      const server = words.filter((_, index) => index !== verb).join(' ');
      if (!server) {
        return ok(
          entry('notice', 'name a server to log in to', {
            tone: 'warn',
            subtitle: context.mcpNames.length
              ? `known: ${context.mcpNames.join(', ')}`
              : 'no MCP servers are configured',
          }),
        );
      }

      return ok(await context.loginMcp(server));
    },
  },
  {
    name: 'memory',
    concurrent: true,
    args: '[forget]',
    summary: 'What Plif remembers about this workspace, and how to drop it',
    /**
     * Memory the developer cannot read is memory they cannot trust.
     *
     * The store is already consulted on every turn and already survives
     * restarts; what it lacked was a way to see what it had decided. A wrong
     * fact that keeps steering the agent is invisible until you can list it,
     * and then it is one command to clear.
     */
    run: async (argv, context) => {
      const workspace = context.cwd;
      const verb = argv.map((word) => word.trim().toLowerCase()).filter(Boolean)[0];

      if (verb === 'forget') {
        await context.engine.memory.forget(workspace);
        return ok(
          entry('notice', 'memory for this workspace is gone', {
            tone: 'accent',
            subtitle: 'facts, failures, strategies and notes',
          }),
        );
      }

      if (verb) {
        return ok(
          entry('notice', `/memory does not know "${verb}"`, {
            tone: 'warn',
            subtitle: '/memory to read it · /memory forget to drop it',
          }),
        );
      }

      const snapshot = await context.engine.memory.snapshot(workspace);
      const lines: string[] = [];
      const section = (title: string, rows: readonly string[]): void => {
        if (rows.length === 0) return;
        lines.push(lines.length ? `\n${title}` : title, ...rows);
      };

      section(
        'Facts',
        rankFacts(snapshot.facts, 20).map(
          (fact) =>
            `  ${fact.text}${fact.confirmations > 1 ? `  (seen ${fact.confirmations}x)` : ''}`,
        ),
      );
      section('Known not to work', rankFacts(snapshot.failures, 20).map((fact) => `  ${fact.text}`));
      section(
        'Strategies',
        snapshot.strategies.slice(-10).map((strategy) => `  ${strategy.approach} — ${strategyStatus(strategy)}`),
      );
      const notes = snapshot.notes.trim();
      if (notes) section('Notes', notes.split('\n').map((line) => `  ${line}`));

      if (lines.length === 0) {
        return ok(
          entry('notice', 'nothing remembered about this workspace yet', {
            tone: 'muted',
            subtitle: 'it fills in as the agent works here',
          }),
        );
      }

      return ok(
        entry('notice', `memory for ${shortenPath(workspace, 48)}`, {
          tone: 'accent',
          subtitle: `${snapshot.facts.length} facts · ${snapshot.failures.length} failures · ${snapshot.strategies.length} strategies`,
          detail: lines.join('\n'),
          expand: true,
        }),
      );
    },
  },
  {
    name: 'sessions',
    concurrent: true,
    summary: 'Browse and resume conversations in this workspace',
    run: async (_argv, context) => {
      context.openBrowser('sessions');
      return ok();
    },
  },
  {
    name: 'skills',
    concurrent: true,
    summary: 'The same browser, opened on the skills tab',
    /**
     * Two names for one screen, on purpose.
     *
     * Someone looking for a skill and someone looking for an MCP server are
     * doing the same thing — finding a capability to add — and they are found
     * in the same catalogue. Two separate half-screens would mean discovering
     * each list twice and learning two sets of keys.
     */
    run: async (_argv, context) => {
      context.openBrowser('skills');
      return ok();
    },
  },
  {
    name: 'marketplace',
    concurrent: true,
    summary: 'Open the browser straight on the plugin catalogue',
    run: async (_argv, context) => {
      context.openBrowser('marketplace');
      return ok();
    },
  },
  {
    name: 'paste',
    concurrent: true,
    summary: 'Attach the image currently on the clipboard',
    /**
     * The same thing Ctrl+V does, for terminals that keep Ctrl+V to themselves.
     *
     * Windows Terminal binds it to its own paste, which sends the clipboard's
     * *text* — so when the clipboard holds only an image, nothing arrives and
     * the keystroke appears to do nothing at all. A command cannot be
     * intercepted, so this is the path that always works.
     */
    run: async (_argv, context) => {
      await context.pasteImage();
      return ok();
    },
  },
  {
    name: 'status',
    concurrent: true,
    summary: 'Show the current PLIF runtime and session status',
    run: async (_argv, context) => {
      if (context.openStatus) {
        context.openStatus();
        return ok();
      }
      const read = context.sessionStatus;
      if (!read) {
        throw new PlifError('INVALID_ARGUMENT', 'status is only available in an interactive session');
      }
      const snapshot = read();
      const config = await loadGlobalConfig();
      return ok(
        entry('notice', 'status', {
          tone: 'accent',
          subtitle: snapshot.model || 'no model configured',
          detail: formatStatus({
            ...snapshot,
            permission: permissionMode(config),
            autoApprove: isAutoApproveEnabled(config),
          }),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'help',
    concurrent: true,
    summary: 'List every command',
    run: async () => {
      // Column width comes from the longest *name*, not name+args. Including
      // args pushes the column past the terminal width and the summaries
      // collide with them; args get their own indented line instead.
      const nameWidth = Math.max(...COMMANDS.map((command) => command.name.length)) + 3;
      const lines: string[] = [];

      for (const command of COMMANDS) {
        lines.push(`/${command.name}`.padEnd(nameWidth) + command.summary);
        if (command.args) lines.push(' '.repeat(nameWidth) + command.args);
      }

      return ok(
        entry('notice', 'commands', {
          tone: 'accent',
          detail: lines.join('\n'),
          expand: true,
        }),
        entry('notice', 'Anything not starting with / runs as a command in the active container.', {
          tone: 'muted',
        }),
      );
    },
  },

  {
    name: 'new',
    args: '[image] [--name n] [--mount host:target[:ro|rw]]',
    summary: 'Create and start a container',
    run: async (argv, context) => {
      const flags = parseFlags(argv);
      const image = flags.positional[0] ?? (await context.engine.ensureBaseImage()).reference;
      const mounts = (flags.repeated['mount'] ?? []).length > 0
        ? (flags.repeated['mount'] ?? []).map(parseMount)
        : [containerMount(context.cwd)];

      const container = await context.engine.run({
        image,
        mounts,
        ...(flags.values['name'] ? { name: flags.values['name'] } : {}),
        // A mount asked for rw is pointless without the capability to use it,
        // so grant it implicitly rather than making the user say it twice.
        ...(mounts.some((mount) => mount.mode === 'rw')
          ? { capabilities: { hostWrite: true } }
          : {}),
        ...((flags.repeated['mount'] ?? []).length === 0
          ? { workdir: containerWorkdir(context.cwd) }
          : {}),
      });
      context.setCurrent(container);

      return ok(
        entry('step', `container ${container.name}`, {
          subtitle: `${image} · ${container.id}`,
          status: 'done',
          tag: '[running]',
          detail:
            formatCapabilities(container.capabilities) +
            (mounts.length
              ? '\n' + mounts.map((m) => `mount  ${m.source} -> ${m.target} (${m.mode})`).join('\n')
              : ''),
        }),
      );
    },
  },

  {
    name: 'ps',
    concurrent: true,
    summary: 'List containers',
    run: async (_argv, context) => {
      const containers = context.engine.list();
      if (containers.length === 0) {
        return ok(entry('notice', 'No containers. Run /new to create one.', { tone: 'muted' }));
      }
      return ok(
        entry('notice', 'containers', {
          tone: 'accent',
          detail: containers
            .map((container) => {
              const status = container.status();
              const marker = container.name === context.current?.name ? glyph.caret : ' ';
              return [
                `${marker} ${container.name.padEnd(18)}`,
                container.id.slice(0, 8).padEnd(10),
                status.state.padEnd(9),
                `${status.usage.execCount} execs`.padEnd(10),
                formatBytes(status.usage.peakMemoryBytes),
              ].join(' ');
            })
            .join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'use',
    args: '<container>',
    summary: 'Aim input at a container',
    run: async (argv, context) => {
      const ref = argv[0];
      if (!ref) throw new PlifError('INVALID_ARGUMENT', 'usage: /use <container>');
      const container = context.engine.require(ref);
      context.setCurrent(container);
      return ok(entry('notice', `now targeting ${container.name}`, { tone: 'accent' }));
    },
  },

  {
    name: 'stop',
    args: '[container]',
    summary: 'Stop a container and reap its process tree',
    run: async (argv, context) => {
      const container = resolveTarget(argv[0], context);
      await container.stop('stopped from the CLI');
      const usage = container.status().usage;
      return ok(
        entry('step', `stopped ${container.name}`, {
          status: 'done',
          subtitle: `${usage.execCount} execs · ${formatBytes(usage.peakMemoryBytes)} peak · ${formatDuration(usage.cpuMillis)} cpu`,
        }),
      );
    },
  },

  {
    name: 'rm',
    args: '[container]',
    summary: 'Remove a container and discard its layer',
    run: async (argv, context) => {
      const container = resolveTarget(argv[0], context);
      const name = container.name;
      await context.engine.remove(container.id);
      if (context.current?.id === container.id) context.setCurrent(null);
      return ok(entry('step', `removed ${name}`, { status: 'done', tone: 'muted' }));
    },
  },

  {
    name: 'commit',
    args: '<layer-name> [container]',
    summary: 'Snapshot the container workspace into a layer',
    run: async (argv, context) => {
      const name = argv[0];
      if (!name) throw new PlifError('INVALID_ARGUMENT', 'usage: /commit <layer-name>');
      const container = resolveTarget(argv[1], context);
      const layer = await container.commit(name);
      return ok(
        entry('step', `committed ${name}`, {
          status: 'done',
          subtitle: `${layer.digest.slice(0, 12)} · ${layer.entries.length} entries · ${formatBytes(layer.size)}`,
        }),
      );
    },
  },

  {
    name: 'build',
    args: '<reference> <directory>',
    summary: 'Build an image from a host directory',
    run: async (argv, context) => {
      const [reference, source] = argv;
      if (!reference || !source) {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /build <reference> <directory>');
      }
      const image = await context.engine.buildImage({
        reference,
        source: path.resolve(context.cwd, source),
      });
      return ok(
        entry('step', `built ${image.reference}`, {
          status: 'done',
          subtitle: `${image.digest.slice(0, 12)} · ${image.layers.length} layers`,
        }),
      );
    },
  },

  {
    name: 'images',
    concurrent: true,
    summary: 'List images in the store',
    run: async (_argv, context) => {
      const images = await context.engine.images.list();
      if (images.length === 0) {
        return ok(entry('notice', 'No images yet. Run /build to make one.', { tone: 'muted' }));
      }
      return ok(
        entry('notice', 'images', {
          tone: 'accent',
          detail: images
            .map(
              (image) =>
                `${image.reference.padEnd(28)} ${image.digest.slice(0, 12)}  ${image.layers.length} layers`,
            )
            .join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'store',
    concurrent: true,
    summary: 'Show what the content store is holding',
    run: async (_argv, context) => {
      const { blobs, bytes } = await context.engine.content.size();
      const layers = await context.engine.layers.list();
      const logical = layers.reduce((total, layer) => total + layer.size, 0);
      const saved = Math.max(0, logical - bytes);
      return ok(
        entry('notice', 'content store', {
          tone: 'accent',
          detail: [
            `blobs      ${blobs}`,
            `on disk    ${formatBytes(bytes)}`,
            `logical    ${formatBytes(logical)} across ${layers.length} layers`,
            `saved      ${formatBytes(saved)} by deduplication`,
          ].join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'providers',
    aliases: ['provider'],
    summary: 'Choose a provider, then one of its models',
    run: async (_argv, context) => {
      const stored = (await loadGlobalConfig().catch(() => ({}))) as StoredConfig;
      const sources = providerSources(stored);
      await openProviderPicker(context, stored, sources);
      return ok();
    },
  },

  {
    name: 'models',
    aliases: ['model'],
    args: '[id]',
    summary: 'Show the model, or pick a different one',
    autocomplete: {
      getValues: ({ context, argumentIndex }) => {
        if (argumentIndex !== 0) return [];
        return [...new Set(context.modelCompletionValues?.() ?? [])];
      },
    },
    run: async (argv, context) => {
      if (argv[0]) {
        // A complete model id applies directly, exactly like `/effort plif`:
        // the picker is for browsing, not for confirming a typed decision.
        // `switchModel` reports the switch itself, so there is no second row.
        await context.switchModel(argv[0]);
        return ok();
      }

      // Opening the catalog is deliberately independent of the global config:
      // a malformed config or missing key must not hide the model chooser.
      const currentModel = context.model?.info.id;
      const stored = (await loadGlobalConfig().catch(() => ({}))) as StoredConfig;
      const currentProvider = providerIdForConfig(stored) ?? undefined;
      await openModelPicker(
        context,
        stored,
        providerSources(stored),
        currentProvider,
        currentModel,
        'Select model',
        '',
        undefined,
        { availableOnly: true },
      );
      return ok();
    },
  },

  {
    name: 'effort',
    args: '[effort]',
    summary: 'Show or change model reasoning effort',
    autocomplete: {
      getValues: ({ context, argumentIndex }) => {
        if (argumentIndex !== 0) return [];
        return ['default', ...(context.supportedEfforts?.() ?? EFFORT_LEVELS)];
      },
      getDetail: (value) => value === 'plif'
        ? 'Plif signature mode · adaptive reasoning'
        : value === 'default'
          ? 'provider default'
          : `${value} reasoning effort`,
      getTone: (value) => value === 'plif' ? 'accentBright' : undefined,
    },
    run: async (argv, context) => {
      const stored = await loadGlobalConfig();
      const current = stored.effort ?? 'default';
      const value = argv[0];
      const available = [...new Set(context.supportedEfforts?.() ?? EFFORT_LEVELS)];
      if (!value) {
          context.openPicker({
            title: `Select effort · ${context.model?.info.id ?? 'current model'}`,
          hint: 'model → effort · choose the reasoning energy for this model',
          countLabel: 'efforts',
          items: [
            { value: 'default', label: 'Default', detail: 'let the provider choose', current: current === 'default' },
            ...effortPickerItems(context.supportedEfforts?.() ?? [], current === 'default' ? undefined : current as Effort),
          ],
          selected: current === 'default'
            ? 0
            : Math.max(0, (context.supportedEfforts?.() ?? []).indexOf(current as Effort) + 1),
          onPick: async (picked) => {
            await context.setEffort(picked === 'default' ? undefined : picked as Effort);
          },
        });
        // The picker itself carries the title and active effort. Printing a
        // second notice above it makes the menu look like a receipt instead
        // of one deliberate temporary surface.
        return ok();
      }
      // A complete, valid value applies directly. The picker is for browsing;
      // making someone who already typed `/effort plif` confirm it again is
      // the interface second-guessing a decision it was just given.
      const selected = validateEffortArgument(value, available);
      await context.setEffort(selected === 'default' ? undefined : selected);
      const isPlif = selected === 'plif';
      return ok(entry('notice', `${isPlif ? '' : `${glyph.done}  `}effort    ${effortVisual(selected === 'default' ? undefined : selected).label}`, {
        tone: isPlif ? 'accentBright' : 'accent',
        subtitle: 'conversation preserved · applies to the next request',
      }));
    },
  },

  {
    name: 'plan',
    args: '[description|off]',
    summary: 'Enter read-only planning mode, or leave it',
    run: async (argv, context) => {
      if (!context.setPlanMode) {
        return ok(entry('notice', 'plan mode is unavailable in this session', { tone: 'warn' }));
      }
      const value = argv.join(' ').trim();
      const command = value.toLowerCase();
      if (command === 'off' || command === 'clear' || command === 'execute' || command === 'work') {
        await context.setPlanMode(false);
        return ok(entry('notice', 'plan mode off', {
          tone: 'accent',
          subtitle: 'the next agent turn may make workspace changes',
        }));
      }
      await context.setPlanMode(true, value || undefined);
      return ok(entry('notice', 'plan mode on', {
        tone: 'accent',
        subtitle: value
          ? 'the plan request was sent without write tools'
          : 'inspect files and propose a plan; use /plan off to resume work',
      }));
    },
  },

  {
    name: 'goal',
    args: '[condition|clear]',
    summary: 'Work until a verifiable completion condition is met',
    run: async (argv, context) => {
      if (!context.goalStatus || !context.startGoal || !context.clearGoal) {
        return ok(entry('notice', 'goals are unavailable in this session', { tone: 'warn' }));
      }
      const value = argv.join(' ').trim();
      const command = value.toLowerCase();
      if (!value) {
        const goal = context.goalStatus();
        return ok(entry('notice', goal
          ? `goal ${goal.status}: ${goal.condition}`
          : 'no active goal', {
            tone: goal ? 'accent' : 'muted',
          }));
      }
      if (command === 'clear' || command === 'off' || command === 'reset') {
        context.clearGoal();
        return ok(entry('notice', 'goal cleared', { tone: 'accent' }));
      }
      if (value.length > 2000) {
        throw new PlifError('INVALID_ARGUMENT', 'goal condition must be 2000 characters or fewer');
      }
      await context.startGoal(value);
      return ok(entry('notice', 'goal active', {
        tone: 'accent',
        subtitle: value,
      }));
    },
  },

  {
    name: 'export',
    concurrent: true,
    args: '[clipboard|file]',
    summary: 'Copy or save the complete session transcript',
    run: async (argv, context) => {
      if (!context.copySession || !context.saveSession) {
        return ok(entry('notice', 'session export is unavailable', { tone: 'warn' }));
      }
      const choice = argv[0]?.toLowerCase();
      if (choice === 'clipboard' || choice === 'copy') {
        await context.copySession();
        return ok();
      }
      if (choice === 'file' || choice === 'save') {
        await context.saveSession();
        return ok();
      }
      context.openPicker({
        title: 'export session',
        items: [
          { value: 'clipboard', label: 'Copy to clipboard', detail: 'the full transcript' },
          { value: 'file', label: 'Save .txt in project', detail: 'creates a new file in the workspace' },
        ],
        selected: 0,
        onPick: (value) => {
          void (value === 'clipboard' ? context.copySession!() : context.saveSession!());
        },
      });
      return ok(entry('notice', 'export session', {
        tone: 'accent',
        subtitle: 'choose copy to clipboard or save a .txt in the project',
      }));
    },
  },

  {
    name: 'sandbox',
    concurrent: true,
    summary: 'Show exactly what the sandbox enforces',
    run: async (_argv, context) => {
      const report = context.engine.sandboxReport;
      const flags = [
        ['kill process tree', report.killProcessTree],
        ['memory ceiling', report.memoryLimit],
        ['process ceiling', report.processLimit],
        ['cpu throttle', report.cpuLimit],
        ['fs write block', report.filesystemWriteBlock],
        ['network block', report.networkBlock],
        ['accounting', report.accounting],
      ] as const;

      return ok(
        entry('notice', `sandbox: ${report.backend} (${report.isolation})`, {
          tone: report.isolation === 'none' ? 'danger' : 'accent',
          detail: [
            ...flags.map(([label, on]) => `${on ? glyph.done : glyph.failed} ${label}`),
            '',
            `output decoded as ${report.textEncoding}`,
            ...(report.degradations.length
              ? ['', ...report.degradations.map((note) => `! ${note}`)]
              : []),
          ].join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'policy',
    concurrent: true,
    summary: 'Show the active policy rules',
    run: async (_argv, context) => {
      const document = context.engine.policy.document;
      return ok(
        entry('notice', `policy: trust=${document.trust} fallback=${document.fallback}`, {
          tone: 'accent',
          detail: [
            ...document.rules.map(
              (rule) =>
                `${rule.decision.padEnd(6)} ${rule.name.padEnd(24)} ${
                  rule.match ?? rule.argvPattern ?? '*'
                }`,
            ),
            '',
            `network allowlist: ${
              document.networkAllowlist.length ? document.networkAllowlist.join(', ') : '(empty)'
            }`,
          ].join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'config',
    concurrent: true,
    args: 'auto-approve [on|off|show]',
    summary: 'Open PLIF settings, or change approval mode directly',
    run: async (argv, context) => {
      if (argv.length === 0 && context.openConfig) {
        context.openConfig();
        return ok();
      }
      const config = await loadGlobalConfig();
      const action = argv[0] === 'auto-approve' ? (argv[1] ?? 'show') : (argv[0] ?? 'show');
      if (action === 'show') {
        return ok(entry('notice', `auto approve: ${isAutoApproveEnabled(config) ? 'on' : 'off'}`, {
          tone: 'accent',
          subtitle: globalConfigPath(),
        }));
      }
      if (action !== 'on' && action !== 'off') {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /config auto-approve [on|off|show]');
      }
      const next = await setAutoApprove(action === 'on');
      context.engine.approvals.setAutoApprove(isAutoApproveEnabled(next));
      return ok(entry('notice', `auto approve: ${action}`, {
        tone: action === 'on' ? 'warn' : 'accent',
        subtitle: globalConfigPath(),
      }));
    },
  },

  {
    name: 'permission',
    concurrent: true,
    args: '[ask|auto-approve|deny]',
    summary: 'Show or set the global approval mode',
    run: async (argv, context) => {
      const current = await loadGlobalConfig();
      const mode = argv[0];
      if (!mode) {
        return ok(entry('notice', `permission: ${permissionMode(current)}`, {
          tone: 'accent',
          subtitle: globalConfigPath(),
        }));
      }
      if (mode !== 'ask' && mode !== 'auto-approve' && mode !== 'deny') {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /permission [ask|auto-approve|deny]');
      }
      const next = await setPermissionMode(mode);
      context.engine.approvals.setPermissionMode(permissionMode(next));
      return ok(entry('notice', `permission: ${mode}`, {
        tone: mode === 'auto-approve' ? 'warn' : mode === 'deny' ? 'danger' : 'accent',
        subtitle: globalConfigPath(),
      }));
    },
  },

  {
    name: 'agent',
    args: 'list | add <name> <model> [description] | remove <name>',
    summary: 'Manage persistent named subagents',
    run: async (argv) => {
      const config = await loadGlobalConfig();
      const action = argv[0] ?? 'list';
      const agents = { ...(config.agent ?? {}) };
      if (action === 'list') {
        const names = Object.entries(agents).map(([name, agent]) =>
          `${name} → ${agent.model ?? '(parent model)'}${agent.description ? ` — ${agent.description}` : ''}`,
        );
        return ok(entry('notice', names.length ? names.join('\n') : 'no named agents configured', {
          tone: 'accent', subtitle: globalConfigPath(), expand: names.length > 0,
        }));
      }
      if (action === 'add') {
        const name = argv[1]?.trim();
        const model = argv[2]?.trim();
        if (!name || !model) throw new PlifError('INVALID_ARGUMENT', 'usage: /agent add <name> <model> [description]');
        agents[name] = { model, ...(argv.slice(3).join(' ').trim() ? { description: argv.slice(3).join(' ').trim() } : {}) };
        await saveGlobalConfig({ ...config, agent: agents });
        return ok(entry('notice', `agent ${name} saved`, { tone: 'success', subtitle: globalConfigPath() }));
      }
      if (action === 'remove') {
        const name = argv[1]?.trim();
        if (!name || !agents[name]) throw new PlifError('INVALID_ARGUMENT', 'usage: /agent remove <name>');
        delete agents[name];
        await saveGlobalConfig({ ...config, agent: agents });
        return ok(entry('notice', `agent ${name} removed`, { tone: 'accent', subtitle: globalConfigPath() }));
      }
      throw new PlifError('INVALID_ARGUMENT', 'usage: /agent list | add <name> <model> [description] | remove <name>');
    },
  },

  {
    name: 'profile',
    args: 'list | add <name> <model> <system prompt> | use <name> | remove <name>',
    summary: 'Manage the persistent main-agent identity',
    run: async (argv, context) => {
      const config = await loadGlobalConfig();
      const profiles = { ...profilesOf(config) };
      const action = argv[0] ?? 'list';
      if (action === 'list') {
        const names = Object.entries(profiles).map(([name, profile]) =>
          `${name}${config.activeProfile === name ? ' (active)' : ''} → ${profile.model ?? '(current model)'}${profile.name ? ` — ${profile.name}` : ''}`,
        );
        return ok(entry('notice', names.length ? names.join('\n') : 'no profiles configured', { tone: 'accent', subtitle: globalConfigPath(), expand: true }));
      }
      if (action === 'add') {
        const name = argv[1]?.trim();
        const model = argv[2]?.trim();
        const systemPrompt = argv.slice(3).join(' ').trim();
        if (!name || !model || !systemPrompt) throw new PlifError('INVALID_ARGUMENT', 'usage: /profile add <name> <model> <system prompt>');
        profiles[name] = { model, name, systemPrompt };
        await saveGlobalConfig({ ...config, profiles });
        return ok(entry('notice', `profile ${name} saved`, { tone: 'success', subtitle: globalConfigPath() }));
      }
      if (action === 'use') {
        const name = argv[1]?.trim();
        if (!name || !profiles[name]) throw new PlifError('INVALID_ARGUMENT', 'unknown profile; use /profile list');
        await context.switchProfile(name);
        return ok(entry('notice', `profile is now ${name}`, { tone: 'accent', subtitle: 'conversation reset for the new identity' }));
      }
      if (action === 'remove') {
        const name = argv[1]?.trim();
        if (!name || !profiles[name]) throw new PlifError('INVALID_ARGUMENT', 'usage: /profile remove <name>');
        delete profiles[name];
        await saveGlobalConfig({ ...config, profiles, ...(config.activeProfile === name ? { activeProfile: undefined } : {}) });
        return ok(entry('notice', `profile ${name} removed`, { tone: 'accent' }));
      }
      throw new PlifError('INVALID_ARGUMENT', 'usage: /profile list | add | use | remove');
    },
  },

  {
    name: 'audit',
    concurrent: true,
    args: '[--verify]',
    summary: 'Tail the audit log, or verify its hash chain',
    run: async (argv, context) => {
      await context.engine.audit.flush();

      if (argv.includes('--verify')) {
        const result = await context.engine.audit.verify();
        return ok(
          entry('notice', result.ok ? 'audit chain intact' : 'AUDIT CHAIN BROKEN', {
            tone: result.ok ? 'success' : 'danger',
            subtitle: result.ok ? undefined : `first bad record: seq ${result.brokenAt}`,
          }),
        );
      }

      const records: string[] = [];
      for await (const record of context.engine.audit.read()) {
        records.push(
          `${record.at.slice(11, 19)}  ${record.type.padEnd(20)} ${JSON.stringify(record.data).slice(0, 90)}`,
        );
      }
      return ok(
        entry('notice', `audit — ${records.length} records today`, {
          tone: 'accent',
          detail: records.slice(-20).join('\n') || '(empty)',
        }),
      );
    },
  },

  {
    name: 'clear',
    summary: 'Clear the timeline',
    run: async (_argv, context) => {
      context.clear();
      return ok();
    },
  },

  {
    name: 'exit',
    summary: 'Stop every container and quit',
    run: async (_argv, context) => {
      context.exit();
      return ok(entry('notice', 'shutting down…', { tone: 'muted' }));
    },
  },
];

export function findCommand(name: string): Command | null {
  const needle = name.toLowerCase();
  return COMMANDS.find((command) =>
    command.name === needle || command.aliases?.some((alias) => alias === needle),
  ) ?? null;
}

/** Prefix completions for the tab key. */
export function completeCommand(partial: string): string[] {
  return matchCommands(partial).map((command) => command.name);
}

/**
 * Commands matching what has been typed so far.
 *
 * Prefix matches rank above substring matches, so typing "st" offers `/stop`
 * before `/store`-adjacent things it merely contains. Anything more clever
 * (fuzzy scoring, frecency) would reorder the menu between keystrokes, and a
 * menu whose items move while you aim at them is worse than a dumb one.
 */
export function matchCommands(partial: string): Command[] {
  const needle = partial.toLowerCase();
  if (needle === '') return [...COMMANDS];

  const prefix = COMMANDS.filter((command) =>
    command.name.startsWith(needle) || command.aliases?.some((alias) => alias.startsWith(needle)),
  );
  const contains = COMMANDS.filter(
    (command) =>
      !command.name.startsWith(needle) &&
      !command.aliases?.some((alias) => alias.startsWith(needle)) &&
      (command.name.includes(needle) || command.aliases?.some((alias) => alias.includes(needle))),
  );
  return [...prefix, ...contains];
}

/** Whether a completion row is already the exact command being typed. */
export function isExactCommandMatch(command: Command, typed: string): boolean {
  const value = typed.toLowerCase();
  return command.name === value || command.aliases?.includes(value) === true;
}

/** Return the command word while the user is typing a slash command. */
export function commandPrefix(input: string): string | null {
  const match = /^\/([^\s]*)/.exec(input);
  return match ? match[1] ?? '' : null;
}

interface TokenSpan {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

function slashTokenSpans(input: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  let start = -1;
  let quoted = false;

  for (let index = 1; index <= input.length; index += 1) {
    const char = input[index] ?? '';
    if (char === '"' && start >= 0) quoted = !quoted;
    const boundary = index === input.length || (!quoted && /\s/.test(char));
    if (start < 0) {
      if (index < input.length && !/\s/.test(char)) start = index;
      continue;
    }
    if (boundary) {
      const raw = input.slice(start, index);
      spans.push({
        value: raw.replace(/^"|"$/g, ''),
        start,
        end: index,
      });
      start = -1;
      quoted = false;
    }
  }
  return spans;
}

/**
 * Find the argument token under the cursor and resolve its command metadata.
 * The returned state deliberately includes an empty token after whitespace so
 * `/effort ` can show every value without inventing a fake argv parser.
 */
export function matchArgumentCompletions(
  input: string,
  cursor: number,
  context: CommandContext,
): ArgumentCompletionState | null {
  if (!input.startsWith('/')) return null;
  const position = Math.max(0, Math.min(cursor, input.length));
  const spans = slashTokenSpans(input);
  const commandSpan = spans[0];
  if (!commandSpan || position <= commandSpan.end) return null;

  const command = findCommand(commandSpan.value);
  if (!command?.autocomplete) return null;

  const argumentSpans = spans.slice(1);
  const activeIndex = argumentSpans.findIndex(
    (span) => position >= span.start && position <= span.end,
  );
  const active = activeIndex >= 0 ? argumentSpans[activeIndex] : undefined;
  const argumentIndex = activeIndex >= 0
    ? activeIndex
    : argumentSpans.filter((span) => span.end < position).length;
  const tokenStart = active?.start ?? position;
  const tokenEnd = active?.end ?? position;
  const token = active?.value ?? '';
  const completionContext: CommandArgumentCompletionContext = {
    command,
    context,
    input,
    cursor: position,
    argv: tokenize(input.slice(commandSpan.end)),
    argumentIndex,
    token,
    tokenStart,
    tokenEnd,
  };
  const values = command.autocomplete.values ?? command.autocomplete.getValues?.(completionContext) ?? [];
  const seen = new Set<string>();
  const needle = token.toLowerCase();
  const matches = values
    .filter((value) => {
      if (seen.has(value) || !value.toLowerCase().startsWith(needle)) return false;
      seen.add(value);
      return true;
    })
    .map((value): ArgumentCompletion => ({
      value,
      label: value,
      ...(command.autocomplete?.getDetail
        ? { detail: command.autocomplete.getDetail(value, completionContext) }
        : {}),
      ...(command.autocomplete?.getTone
        ? { tone: command.autocomplete.getTone(value) }
        : {}),
    }));

  return {
    command,
    input,
    cursor: position,
    argumentIndex,
    token,
    tokenStart,
    tokenEnd,
    matches,
  };
}

export function longestCommonPrefix(values: readonly string[]): string {
  const first = values[0] ?? '';
  let length = first.length;
  for (const value of values.slice(1)) {
    length = Math.min(length, value.length);
    let index = 0;
    while (index < length && first[index]?.toLowerCase() === value[index]?.toLowerCase()) index += 1;
    length = index;
  }
  return first.slice(0, length);
}

/** Return the text a TAB press can add without choosing an ambiguous value. */
export function tabArgumentCompletion(state: ArgumentCompletionState): string | null {
  if (state.matches.length === 0) return null;
  const candidate = state.matches.length === 1
    ? state.matches[0]!.value
    : longestCommonPrefix(state.matches.map((match) => match.value));
  return candidate.length > state.token.length ? candidate : null;
}

// ---------------------------------------------------------------------------

function resolveTarget(ref: string | undefined, context: CommandContext): Container {
  if (ref) return context.engine.require(ref);
  if (context.current) return context.current;
  throw new PlifError('CONTAINER_NOT_FOUND', 'no container is active', {
    hint: 'Run /new to create one, or /use <name> to pick one.',
  });
}

interface ParsedFlags {
  readonly positional: string[];
  readonly values: Record<string, string>;
  readonly repeated: Record<string, string[]>;
  readonly booleans: Set<string>;
}

/**
 * A deliberately small flag parser.
 *
 * Handles `--key value`, repeated `--key`, and bare `--flag`. It does not
 * handle `-k`, `--key=value` or quoting, because pulling in a full parser for
 * an internal command table trades a dependency for problems it does not have.
 */
function parseFlags(argv: readonly string[]): ParsedFlags {
  const positional: string[] = [];
  const values: Record<string, string> = {};
  const repeated: Record<string, string[]> = {};
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      booleans.add(key);
      continue;
    }
    values[key] = next;
    (repeated[key] ??= []).push(next);
    index += 1;
  }
  return { positional, values, repeated, booleans };
}

/** `host:target` or `host:target:ro|rw`, with Windows drive letters allowed. */
function parseMount(spec: string): { source: string; target: string; mode: 'ro' | 'rw' } {
  // Split from the right so a Windows drive letter stays intact.
  const parts = spec.split(':');
  let mode: 'ro' | 'rw' = 'ro';
  if (parts.length > 2 && (parts[parts.length - 1] === 'ro' || parts[parts.length - 1] === 'rw')) {
    mode = parts.pop() as 'ro' | 'rw';
  }
  const target = parts.pop();
  const source = parts.join(':');

  if (!target || !source) {
    throw new PlifError(
      'INVALID_ARGUMENT',
      `could not parse mount "${spec}"`,
      { hint: 'Use --mount <host-path>:<container-path>[:ro|rw]' },
    );
  }
  return { source: path.resolve(source), target, mode };
}
