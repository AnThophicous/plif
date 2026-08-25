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
  discoveredModelCost,
  EFFORT_LEVELS,
  findCatalogModel,
  findCatalogProvider,
  filterAvailableModels,
  BUILTIN_AGENT_PRESETS,
  formatModelRef,
  MODEL_CATALOG,
  modelVisionBadge,
  rankFacts,
  rankModelIds,
  scoreModel,
  providerIdForConfig,
  selectAvailableModels,
  supportedEfforts,
  strategyStatus,
  userCatalog,
  visionCandidates,
  agentsOf,
  appendTokenSplitSanity,
  unavailableUsage,
  loadTokenSplitConfig,
  readTokenSplitAudit,
  readTokenSplitMetrics,
  readTokenSplitSanity,
  resetTokenSplitMetrics,
  runTokenSplitSanity,
  saveTokenSplitConfig,
  stateNotesHasHardFacts,
  techniqueIsOn,
  tokenSplitDefinition,
  tokenSplitDefinitions,
  tokenSplitSanityRate,
} from '@plif/core';
import type {
  Container,
  Effort,
  Engine,
  ModelCatalogProvider,
  ModelCatalogModel,
  ModelProvider,
  ModelSelection,
  ModelBrowserFilter,
  AvailableCatalogModel,
  ProviderModel,
  ProviderAccess,
  StoredConfig,
  GlobalConfig,
  UsageInfo,
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
import { binaryStateIndicator, formatBytes, formatDuration, glyph, shortenPath, type BinaryState, type PaletteKey } from './theme.js';
import { containerMount, containerTempMount, containerWorkdir } from './container-paths.js';
import type { ThemeDefinition } from './themes.js';

export { BUILTIN_AGENT_PRESETS } from '@plif/core';

export interface CommandContext {
  readonly engine: Engine;
  /** The container input is currently aimed at, if any. */
  readonly current: Container | null;
  readonly setCurrent: (container: Container | null) => void;
  readonly clear: () => void;
  readonly exit: () => void;
  readonly cwd: string;
  /** Host path for the current session's disposable /temp mount. */
  readonly tempDir: string;
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
  readonly goalStatus?: () => {
    readonly condition: string;
    readonly status: 'active' | 'paused' | 'complete' | 'blocked';
    readonly revision?: number;
    readonly rounds?: number;
    readonly maxRounds?: number;
    readonly armed?: boolean;
    readonly blockedReason?: string | null;
  } | null;
  readonly clearGoal?: () => void | Promise<void>;
  readonly switchProfile: (name: string) => Promise<void>;
  /** Leave the persisted profile/persona layer without changing the model. */
  readonly clearProfile?: () => Promise<void>;
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
  /** Start the official ChatGPT login flow inside the PLIF provider picker. */
  readonly loginCodex?: () => Promise<boolean>;
  /** The MCP servers this session knows about, for naming them back. */
  readonly mcpNames: readonly string[];
  /** Pull an image off the clipboard and attach it to the line being typed. */
  readonly pasteImage: () => Promise<void>;
  readonly openPicker: (picker: FlatPickerRequest | CatalogPickerRequest) => void;
  /** Optional live notice for asynchronous picker actions. */
  readonly notify?: (notice: TimelineEntry) => void;
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
  /**
   * Pickers may perform asynchronous work after the row is selected. Returning
   * that promise lets callers (and tests) wait for the operation to settle;
   * existing synchronous pickers remain valid.
   */
  readonly onPick: (value: string | ModelSelection) => void | Promise<void>;
  /** Initial keyboard position; defaults to the first visible row. */
  readonly selected?: number;
  readonly onBack?: () => void;
  readonly onFilter?: () => void;
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
  /** Optional human-facing label while preserving the value inserted by Tab. */
  readonly getLabel?: (
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

function formatUsageNumber(value: number | 'unlimited' | undefined, unit: string, currency?: string): string {
  if (value === undefined) return 'Unknown';
  if (value === 'unlimited') return 'Unlimited';
  if (unit === 'tokens') return formatTokens(value);
  if (unit === 'credits' && currency) return `${currency === 'USD' ? '$' : `${currency} `}${value.toFixed(2)}`;
  return value.toLocaleString();
}

function formatUsage(info: UsageInfo, session?: StatusInput['usage']): string {
  const lines = [
    `provider  ${info.provider}`,
    `model     ${info.model}`,
    `status    ${info.status}`,
  ];
  if (info.plan) lines.push(`plan      ${info.plan}`);
  if (info.windows.length === 0) {
    lines.push(`limits    ${info.detail ?? 'not exposed by this provider'}`);
  } else {
    for (const window of info.windows) {
      const values = [
        `limit ${formatUsageNumber(window.limit, window.unit, window.currency)}`,
        `used ${formatUsageNumber(window.used, window.unit, window.currency)}`,
        `remaining ${formatUsageNumber(window.remaining, window.unit, window.currency)}`,
        ...(window.percentage === undefined ? [] : [`${window.percentage}% used`]),
        ...(window.resetAt ? [`reset ${window.resetAt}`] : []),
      ];
      lines.push(`${window.type.padEnd(9)}${values.join(' · ')}`);
    }
  }
  if (info.source) lines.push(`source    ${info.source}`);
  if (info.detail) lines.push(info.detail);
  if (session) {
    lines.push('', 'this session', `requests ${session.requests} · ${formatTokens(session.inputTokens)} in · ${formatTokens(session.outputTokens)} out`);
  }
  return lines.join('\n');
}

async function usageSnapshot(context: CommandContext): Promise<{ info: UsageInfo; session: StatusInput['usage'] | undefined }> {
  const model = context.model;
  if (!model) throw new PlifError('INVALID_ARGUMENT', 'usage is unavailable until a model is configured');
  let info: UsageInfo;
  try {
    info = model.getUsage
      ? await model.getUsage()
      : unavailableUsage(
          model.info.providerId ?? model.info.endpoint,
          model.info.id,
          'This provider adapter does not expose usage information.',
        );
  } catch {
    info = unavailableUsage(
      model.info.providerId ?? model.info.endpoint,
      model.info.id,
      'Usage is temporarily unavailable; no quota was inferred.',
    );
  }
  return { info, session: context.sessionStatus?.().usage };
}

function usageIsPositive(status: UsageInfo['status']): boolean {
  return status === 'available' || status === 'unlimited';
}

function openUsageMenu(context: CommandContext): void {
  void usageSnapshot(context).then(({ info, session }) => {
    const status = info.status;
    context.openPicker({
      title: 'Usage',
      hint: `${info.provider} · ${info.model} · ${status} · choose a view · Esc closes`,
      countLabel: 'views',
      items: [
        {
          value: 'overview',
          label: 'Overview',
          detail: 'Provider, model, limits, source, and this session',
          current: true,
        },
        {
          value: 'limits',
          label: 'Provider limits',
          detail: info.windows.length
            ? `${info.windows.length} normalized limit(s) · ${info.source ?? 'provider'}`
            : info.detail ?? 'No provider limit data exposed',
        },
        {
          value: 'session',
          label: 'This session',
          detail: session
            ? `${session.requests} requests · ${formatTokens(session.inputTokens)} in · ${formatTokens(session.outputTokens)} out`
            : 'No session counters available',
        },
        {
          value: 'refresh',
          label: 'Refresh usage',
          detail: 'Read the latest provider headers or policy snapshot',
          symbol: '↻',
        },
      ],
      onPick: (value) => {
        if (String(value) === 'refresh') {
          openUsageMenu(context);
          return;
        }
        context.notify?.(entry('notice', `usage · ${String(value)}`, {
          tone: usageIsPositive(info.status) ? 'accent' : 'muted',
          subtitle: usageIsPositive(info.status)
            ? info.source === 'config'
              ? 'official provider policy · live counters may be unavailable'
              : 'official provider metadata from the latest response'
            : 'no quota was invented',
          detail: formatUsage(info, session),
          expand: true,
        }));
      },
    });
  }).catch((error: unknown) => {
    context.notify?.(entry('notice', 'could not open usage', {
      tone: 'danger',
      subtitle: error instanceof Error ? error.message : 'try again',
    }));
  });
}

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
    return discoveredModelCost(catalog.id, id, discovered?.cost) === 'free' ||
      curated?.badges.includes('no key') === true;
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
  const ranking = scoreModel(model);
  const missingMetadata = [
    model.contextWindow === undefined ? 'context window' : undefined,
    model.reasoning === undefined ? 'reasoning support' : undefined,
    model.tools === undefined ? 'tool support' : undefined,
    model.pricing === undefined ? 'token pricing' : undefined,
  ].filter((value): value is string => value !== undefined);
  const auth = effectiveSource.auth === 'codex'
    ? 'ChatGPT sign-in · PLIF window'
    : access === 'free'
      ? model.cost === 'free' || model.badges.includes('no key')
        ? 'Free · no key'
        : model.cost === 'paid'
          ? 'Paid · key required'
          : 'Access not reported'
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
    ...(model.maxInputTokens === undefined ? {} : { maxInput: formatContext(model.maxInputTokens) }),
    ...(model.maxOutputTokens === undefined ? {} : { maxOutput: formatContext(model.maxOutputTokens) }),
    auth,
    ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
    ...(model.tools === undefined ? {} : { tools: model.tools }),
    ...(model.cost === undefined ? {} : { cost: model.cost }),
    ...(model.pricing === undefined ? {} : { pricing: model.pricing }),
    ...(ranking.known ? { tier: ranking.tier } : {}),
    ...(model.tier ? { providerTier: model.tier } : {}),
    ...(model.metadataSource ? { source: model.metadataSource } : {}),
    ...(missingMetadata.length > 0
      ? { metadataNote: `Not reported by ${effectiveSource.label}: ${missingMetadata.join(', ')}.` }
      : {}),
    searchText: [
      effectiveSource.id,
      effectiveSource.label,
      model.id,
      model.description,
      ...(model.aliases ?? []),
      ...badges,
      ranking.tier,
      ranking.reasoning >= 60 ? 'reasoning' : '',
      ranking.coding >= 60 ? 'coding' : '',
      model.tools === true ? 'tools' : '',
      model.modalities?.includes('image') ? 'vision' : '',
      model.contextWindow && model.contextWindow >= 128_000 ? 'long context' : '',
    ].join(' '),
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
  options: {
    readonly availableOnly?: boolean;
    readonly onPick?: (selection: ModelSelection) => void | Promise<void>;
  } = {},
): Promise<void> {
  const access = await providerAccessMap(sources, stored, context.credentials, currentProvider);
  const visibleSources = options.availableOnly
    ? sources.filter(({ entryProvider }) => access.has(entryProvider.id))
    : sources;
  const discovered = new Map<string, Awaited<ReturnType<typeof discoverProviderModels>>>();
  await Promise.all(visibleSources.map(async ({ entryProvider }) => {
    const key = await providerKey(entryProvider.id, stored, context.credentials);
    const isCurrentProvider = entryProvider.id === currentProvider && currentModel !== undefined;
    const result = await discoverProviderModels(entryProvider.id, {
      stored,
      // Opening /models is an explicit catalog request. Refresh the active
      // offer synchronously so removed models disappear and newly published
      // offers are visible in this picker. Other providers keep their cached
      // or background path and are refreshed when selected, avoiding a burst
      // of network calls just to paint a menu.
      ...(isCurrentProvider ? { refresh: true, waitForNetwork: true } : { waitForNetwork: false }),
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
  }).filter((candidate): candidate is AvailableCatalogModel =>
    candidate.access !== undefined && (!options.availableOnly || access.has(candidate.provider.id)));
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

  const hasVisionHelper = visionCandidates(stored).length > 0;
  const filterOptions: readonly PickerItem[] = [
    { value: 'strength', label: 'Strongest first', detail: 'PLIF default ranking', current: true },
    { value: 'context', label: 'Largest context', detail: 'Known context window, largest first' },
    { value: 'speed', label: 'Fastest first', detail: 'Known speed signals' },
    { value: 'alphabetical', label: 'A–Z', detail: 'Optional alphabetical order' },
    ...(selectedModels.some(({ model }) => model.reasoning !== undefined)
      ? [{ value: 'reasoning', label: 'Reasoning', detail: 'Only declared reasoning models' }]
      : []),
    ...(selectedModels.some(({ model }) => model.tools !== undefined)
      ? [{ value: 'tools', label: 'Tools', detail: 'Only declared tool-capable models' }]
      : []),
    ...(selectedModels.some(({ model }) => model.modalities?.includes('image'))
      ? [{ value: 'vision', label: 'Vision', detail: 'Only declared image-capable models' }]
      : []),
    ...(selectedModels.some(({ model }) => scoreModel(model).known && scoreModel(model).coding >= 60)
      ? [{ value: 'coding', label: 'Coding', detail: 'Known coding-capable models' }]
      : []),
    ...(selectedModels.some(({ model }) => model.contextWindow !== undefined && model.contextWindow >= 128_000)
      ? [{ value: 'long-context', label: 'Long context', detail: 'Known windows of 128k or more' }]
      : []),
    ...(['S', 'A', 'B', 'C', 'D'] as const).map((tier) => ({
      value: `tier:${tier}`,
      label: `Tier ${tier}`,
      detail: tier === 'D' ? 'Conservative / unknown models' : 'Internal capability tier',
    })),
    ...[...new Map(selectedModels.map(({ provider }) => [provider.id, provider])).values()].map((provider) => ({
      value: `provider:${provider.id}`,
      label: provider.label,
      detail: 'Provider filter',
    })),
  ];

  const qualify = (modelItems: readonly AvailableCatalogModel[]): PickerItem[] => {
    const rows = modelItems.map(({ provider, model, access: providerAccess }) =>
      modelRowItem(provider, model, providerAccess, currentProvider, currentModel, hasVisionHelper));
    const duplicateLabels = new Map<string, number>();
    for (const item of rows) duplicateLabels.set(item.label.toLowerCase(), (duplicateLabels.get(item.label.toLowerCase()) ?? 0) + 1);
    return rows.map((item) => duplicateLabels.get(item.label.toLowerCase())! > 1 && item.provider
      ? { ...item, label: `${item.label} (${shortProviderName(item.provider)})` }
      : item);
  };

  const openFilterPicker = (activeFilter: ModelBrowserFilter = 'strength'): void => {
    context.openPicker({
      title: 'Filter models',
      hint: 'Choose how the model browser is organized · Esc returns to models',
      countLabel: 'filters',
      items: filterOptions.map((item) => ({ ...item, current: item.value === activeFilter })),
      selected: Math.max(0, filterOptions.findIndex((item) => item.value === activeFilter)),
      onPick: (value) => openModelList(String(value) as ModelBrowserFilter),
      onBack: () => openModelList(activeFilter),
    });
  };

  function openModelList(activeFilter: ModelBrowserFilter = 'strength'): void {
    const qualifiedItems = qualify(filterAvailableModels(selectedModels, activeFilter));
    const activeHint = `${modelHint}\nfilter: ${filterOptions.find((item) => item.value === activeFilter)?.label ?? 'Strongest first'}`;
    context.openPicker({
      title,
      hint: activeHint,
      countLabel: 'available',
      items: qualifiedItems,
      selected: Math.max(0, qualifiedItems.findIndex((item) => item.current)),
      onPick: (selection) => {
        if (typeof selection !== 'string') {
          void (options.onPick ? options.onPick(selection) : context.switchModel(selection));
        }
      },
      onFilter: () => openFilterPicker(activeFilter),
      ...(onBack ? { onBack } : {}),
    });
  }
  openModelList();
}

export function mergeDiscoveredModel(
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
  const curatedHasExplicitMetadata = curated !== undefined && [
    curated.contextWindow,
    curated.maxInputTokens,
    curated.maxOutputTokens,
    curated.reasoning,
    curated.tools,
    curated.modalities,
    curated.cost,
    curated.pricing,
    curated.provider,
    curated.product,
    curated.tier,
    curated.protocol,
    curated.streamSemantics,
    curated.metadataSource,
  ].some((value) => value !== undefined);
  const sourceHasExplicitMetadata = source.product !== undefined || source.tier !== undefined || source.defaultCost !== undefined;
  const metadataSource = discovered.metadataSource
    ?? curated?.metadataSource
    ?? (curatedHasExplicitMetadata || sourceHasExplicitMetadata ? 'registry' : undefined);
  const registryFallback = curated ? {} : {
    ...(source.product ? { product: source.product } : {}),
    ...(source.tier ? { tier: source.tier } : {}),
    ...(source.defaultCost ? { cost: source.defaultCost } : {}),
    ...(metadataSource ? { metadataSource } : {}),
  };
  return {
    ...(curated ?? {
      id,
      label: discovered.name ?? friendlyModelName(id),
      description: 'Discovered from the provider',
      badges: ['live'],
    }),
    ...registryFallback,
    ...(discovered.aliases === undefined ? {} : { aliases: discovered.aliases }),
    ...(discovered.name ? { label: discovered.name } : {}),
    ...(discovered.contextWindow === undefined ? {} : { contextWindow: discovered.contextWindow }),
    ...(discovered.maxInputTokens === undefined ? {} : { maxInputTokens: discovered.maxInputTokens }),
    ...(discovered.maxOutputTokens === undefined ? {} : { maxOutputTokens: discovered.maxOutputTokens }),
    ...(discovered.reasoning === undefined ? {} : { reasoning: discovered.reasoning }),
    ...(discovered.tools === undefined ? {} : { tools: discovered.tools }),
    ...(discovered.modalities === undefined ? {} : { modalities: discovered.modalities }),
    ...(discovered.cost === undefined ? {} : { cost: discovered.cost }),
    ...(discovered.pricing === undefined ? {} : { pricing: discovered.pricing }),
    ...(discovered.provider === undefined ? {} : { provider: discovered.provider }),
    ...(discovered.product === undefined ? {} : { product: discovered.product }),
    ...(discovered.tier === undefined ? {} : { tier: discovered.tier }),
    ...(discovered.protocol === undefined ? {} : { protocol: discovered.protocol }),
    ...(discovered.streamSemantics === undefined ? {} : { streamSemantics: discovered.streamSemantics }),
    ...(discovered.ranking === undefined ? {} : { ranking: discovered.ranking }),
    ...(metadataSource ? { metadataSource } : {}),
    ...(discovered.cost === undefined && curated?.cost === undefined && source.defaultCost ? { cost: source.defaultCost } : {}),
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

/**
 * Configure a locked built-in provider without selecting a model as a side
 * effect. Discovery is the validation probe; the key is remembered only after
 * the endpoint answers, and it never enters a timeline entry or cache row.
 */
async function configureProvider(
  context: CommandContext,
  stored: StoredConfig,
  source: ModelCatalogProvider,
): Promise<boolean> {
  if (!context.credentials) {
    context.notify?.(entry('notice', `cannot configure ${source.label} without secure credential storage`, {
      tone: 'warn',
      subtitle: 'Nothing was requested or saved. Start the normal interactive session and try again.',
    }));
    return false;
  }
  const keyEnv = credentialVariableForProvider(source.id, stored);
  const key = (await context.engine.questions.ask({
    text: `API key · ${source.label}`,
    secret: true,
    context: [
      `Endpoint: ${source.endpoint}`,
      'The key is masked and never enters the transcript or model cache.',
      `After validation it is stored in the encrypted credential store (${keyEnv}). Esc cancels.`,
    ].join('\n'),
  }))?.trim();
  if (!key) return false;
  const result = await discoverProviderModels(source.id, {
    stored,
    apiKey: key,
    refresh: true,
    waitForNetwork: true,
  });
  if (!result.live || result.error) {
    context.notify?.(entry('notice', `could not validate ${source.label} API key`, {
      tone: 'danger',
      subtitle: 'Nothing was saved. Check the key and endpoint, then try again.',
    }));
    return false;
  }
  try {
    await context.credentials.remember(keyEnv, key);
  } catch {
    context.notify?.(entry('notice', `validated ${source.label}, but could not save its API key`, {
      tone: 'warn',
      subtitle: 'The provider was not changed. Check the secure credential store and try again.',
    }));
    return false;
  }
  return true;
}

async function providerAccessMap(
  sources: readonly ProviderSource[],
  stored: StoredConfig,
  credentials: CredentialBroker | undefined,
  activeProvider: string | undefined,
): Promise<Map<string, ProviderAccess>> {
  const entries = await Promise.all(sources.map(async ({ entryProvider }) => {
    // ChatGPT/Codex is an optional local session, not a generic API-key
    // provider. Keep it out of the default model list until the user selects
    // it (or it is already active), otherwise a logged-in Codex installation
    // silently changes the default model picker order for every workspace.
    if (entryProvider.auth === 'codex') {
      return entryProvider.id === activeProvider
        ? [entryProvider.id, 'configured' as const] as const
        : null;
    }
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
    const auth = entryProvider.auth === 'codex'
      ? 'ChatGPT sign-in in PLIF'
      : state === 'free'
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
      const isCodex = selected.auth === 'codex';
      const isLocked = !isCodex && !access.has(selected.id) && !selected.anonymous && !isLocalEndpoint(selected.endpoint);
      void (async () => {
        if (isLocked && !(await configureProvider(context, stored, selected))) return;
        if (isCodex && !sameProvider && !(await context.loginCodex?.() ?? false)) return;
        await openModelPicker(
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
      })();
    },
    ...(onBack ? { onBack } : {}),
  });
}

export const AGENT_SUBCOMMANDS = ['add', 'remove', 'rename', 'list', 'auto'] as const;
type AgentAction = (typeof AGENT_SUBCOMMANDS)[number] | 'menu';

/** Short forms are intentionally stable: `/agents a` + Tab is a guided add. */
export function normalizeAgentAction(value?: string): AgentAction | null {
  const action = value?.trim().toLowerCase();
  if (!action) return 'menu';
  if (action === 'menu') return 'menu';
  if (action === 'a' || action === 'add') return 'add';
  if (action === 'r' || action === 'remove' || action === 'rm') return 'remove';
  if (action === 'rn' || action === 'rename') return 'rename';
  if (action === 'l' || action === 'list' || action === 'ls') return 'list';
  if (action === 'auto') return 'auto';
  return null;
}

function agentEntries(config: GlobalConfig): Array<[string, NonNullable<GlobalConfig['agent']>[string]]> {
  return Object.entries(agentsOf(config)) as Array<[string, NonNullable<GlobalConfig['agent']>[string]]>;
}

function agentAutoLaunchStatus(config: GlobalConfig): BinaryState {
  return config.agentAutoLaunch === false ? 'off' : 'on';
}

function isBuiltinAgent(name: string): boolean {
  return BUILTIN_AGENT_PRESETS.some((preset) => preset.name === name);
}

type AgentTone = 'accent' | 'warn' | 'danger' | 'success' | 'muted';

function agentNotice(context: CommandContext, message: string, tone: AgentTone = 'accent', subtitle?: string): void {
  context.notify?.(entry('notice', message, {
    tone,
    subtitle: subtitle ?? globalConfigPath(),
  }));
}

async function saveNamedAgent(
  context: CommandContext,
  name: string,
  selection: ModelSelection,
  description: string | undefined,
  instructions: string | undefined,
  replace = false,
): Promise<void> {
  const config = await loadGlobalConfig();
  const current = { ...(config.agent ?? {}) };
  if (current[name] && !replace) {
    agentNotice(context, `agent ${name} already exists`, 'warn', 'Choose another name or remove it first.');
    return;
  }
  current[name] = {
    model: formatModelRef(selection.preset, selection.model),
    ...(description?.trim() ? { description: description.trim() } : {}),
    ...(instructions?.trim() ? { instructions: instructions.trim() } : {}),
  };
  await saveGlobalConfig({ ...config, agent: current });
  agentNotice(
    context,
    `agent ${name} saved`,
    'success',
    `${formatModelRef(selection.preset, selection.model)} · ${globalConfigPath()}`,
  );
}

function openAgentModelPicker(
  context: CommandContext,
  stored: StoredConfig,
  name: string,
  description?: string,
  instructions?: string,
  replace = false,
): void {
  const activeProvider = providerIdForConfig(stored) ?? undefined;
  void openModelPicker(
    context,
    stored,
    providerSources(stored),
    activeProvider,
    context.model?.info.id,
    `Select model · ${name}`,
    'Only active providers are shown · Enter selects · Esc cancels',
    undefined,
    {
      availableOnly: true,
      onPick: (selection) => {
        void saveNamedAgent(context, name, selection, description, instructions, replace).catch((error: unknown) => {
          agentNotice(context, `could not save agent ${name}`, 'danger', error instanceof Error ? error.message : 'try again');
        });
      },
    },
  ).catch((error: unknown) => {
    agentNotice(context, 'could not open the active model list', 'danger', error instanceof Error ? error.message : 'try again');
  });
}

function openAgentAddMenu(context: CommandContext, stored: GlobalConfig): void {
  const items: PickerItem[] = [
    {
      value: 'custom',
      label: 'Custom agent',
      detail: 'Choose a name, an active-provider model, and a description',
      symbol: '+',
    },
  ];
  context.openPicker({
    title: 'Add agent',
    hint: 'Built-in PLIF roles are already in List · create a custom role · Esc cancels',
    countLabel: 'agent types',
    items,
    onPick: (value) => {
      if (String(value) === 'custom') {
        void (async () => {
          const answer = await context.engine.questions.ask({
            text: 'Agent name',
            context: 'Use a short name you will recognize in /agents and in subagent requests. Esc cancels.',
          });
          const name = answer?.trim();
          if (!name) return agentNotice(context, 'agent creation cancelled', 'muted');
          if (agentEntries(stored).some(([existing]) => existing === name)) {
            return agentNotice(context, `agent ${name} already exists`, 'warn', 'Choose another name or remove it first.');
          }
          openAgentModelPicker(context, stored, name);
        })().catch((error: unknown) => agentNotice(context, 'could not start agent creation', 'danger', error instanceof Error ? error.message : 'try again'));
        return;
      }
    },
  });
}

function openAgentList(context: CommandContext, stored: GlobalConfig): void {
  const agents = agentEntries(stored);
  const autoStatus = agentAutoLaunchStatus(stored);
  context.openPicker({
    title: 'Agents',
    hint: `AUTO-LAUNCH ${binaryStateIndicator(autoStatus).icon} · built-in and custom agents · Esc closes`,
    countLabel: 'agents',
    items: agents.length
      ? agents.map(([name, agent]) => ({
          value: name,
          label: name,
          detail: `${isBuiltinAgent(name) ? 'built-in' : 'custom'} · ${agent.model ?? '(parent model)'}${agent.description ? ` · ${agent.description}` : ''}`,
          badges: [isBuiltinAgent(name) ? 'built-in' : 'custom'],
          current: false,
        }))
      : [{ value: '__none__', label: 'No named agents available', detail: 'Use Add agent to create a custom role.' }],
    onPick: () => undefined,
  });
}

function openAgentRemove(context: CommandContext, stored: GlobalConfig): void {
  const agents = agentEntries(stored);
  if (!agents.length) {
    agentNotice(context, 'no named agents configured', 'muted', 'Use /agents add to create one.');
    return;
  }
  context.openPicker({
    title: 'Remove agent',
    hint: 'Choose an agent · Enter confirms the next step · Esc cancels',
    countLabel: 'agents',
    items: agents.map(([name, agent]) => ({
      value: name,
      label: name,
      detail: `${agent.model ?? '(parent model)'}${agent.description ? ` · ${agent.description}` : ''}`,
    })),
    onPick: (value) => {
      const name = String(value);
      void (async () => {
        const answer = await context.engine.questions.ask({
          text: `Remove agent ${name}?`,
          options: ['remove', 'cancel'],
          context: 'This removes the saved role from the global config. The model and credentials are not deleted.',
        });
        if (answer?.trim().toLowerCase() !== 'remove') return agentNotice(context, 'agent removal cancelled', 'muted');
        const latest = await loadGlobalConfig();
        const effective = agentsOf(latest);
        if (!effective[name]) return agentNotice(context, `agent ${name} is already gone`, 'muted');
        const next = { ...(latest.agent ?? {}) };
        if (isBuiltinAgent(name)) next[name] = { disable: true };
        else delete next[name];
        await saveGlobalConfig({ ...latest, agent: next });
        agentNotice(context, `agent ${name} removed`, 'accent');
      })().catch((error: unknown) => agentNotice(context, `could not remove agent ${name}`, 'danger', error instanceof Error ? error.message : 'try again'));
    },
  });
}

function openAgentRename(context: CommandContext, stored: GlobalConfig): void {
  const agents = agentEntries(stored);
  if (!agents.length) {
    agentNotice(context, 'no named agents configured', 'muted', 'Use /agents add to create one.');
    return;
  }
  context.openPicker({
    title: 'Rename agent',
    hint: 'Choose an agent, then type its new name · Esc cancels',
    countLabel: 'agents',
    items: agents.map(([name, agent]) => ({
      value: name,
      label: name,
      detail: `${agent.model ?? '(parent model)'}${agent.description ? ` · ${agent.description}` : ''}`,
    })),
    onPick: (value) => {
      const oldName = String(value);
      void (async () => {
        const answer = await context.engine.questions.ask({
          text: `New name for ${oldName}`,
          context: 'The model, description, and role instructions will be preserved. Esc cancels.',
        });
        const newName = answer?.trim();
        if (!newName) return agentNotice(context, 'rename cancelled', 'muted');
        const latest = await loadGlobalConfig();
        const effective = agentsOf(latest);
        const source = effective[oldName];
        if (!source) return agentNotice(context, `agent ${oldName} is already gone`, 'muted');
        if (newName !== oldName && effective[newName]) return agentNotice(context, `agent ${newName} already exists`, 'warn');
        const next = { ...(latest.agent ?? {}) };
        next[newName] = source;
        if (newName !== oldName) {
          if (isBuiltinAgent(oldName)) next[oldName] = { disable: true };
          else delete next[oldName];
        }
        await saveGlobalConfig({ ...latest, agent: next });
        agentNotice(context, `agent renamed to ${newName}`, 'success');
      })().catch((error: unknown) => agentNotice(context, `could not rename agent ${oldName}`, 'danger', error instanceof Error ? error.message : 'try again'));
    },
  });
}

function openAgentAuto(context: CommandContext, stored: GlobalConfig): void {
  const enabled = stored.agentAutoLaunch !== false;
  const status = agentAutoLaunchStatus(stored);
  context.openPicker({
    title: `Agent auto-use · ${binaryStateIndicator(status).icon}`,
    hint: 'Choose automatic launch or manual launch only · Esc closes',
    countLabel: 'settings',
    items: [
      { value: 'on', label: 'Automatic launch', detail: 'PLIF can auto-launch a configured agent for a matching task', state: 'on', current: enabled },
      { value: 'off', label: 'Manual launch only', detail: 'Use “use the CEO” or “use subagents” to request delegation', state: 'off', current: !enabled },
    ],
    onPick: (value) => {
      void (async () => {
        const next = String(value) === 'on';
        const latest = await loadGlobalConfig();
        await saveGlobalConfig({ ...latest, agentAutoLaunch: next });
        const marker = binaryStateIndicator(next ? 'on' : 'off').icon;
        agentNotice(context, `agent auto-use ${marker}`, next ? 'success' : 'danger', next ? 'Named agents may be selected when they fit.' : 'Named agents now require an explicit request.');
      })().catch((error: unknown) => agentNotice(context, 'could not update agent auto-use', 'danger', error instanceof Error ? error.message : 'try again'));
    },
  });
}

function openAgentsMenu(context: CommandContext, stored: GlobalConfig): void {
  const count = agentEntries(stored).length;
  const autoStatus = agentAutoLaunchStatus(stored);
  context.openPicker({
    title: 'Agents',
    hint: `${count} available · AUTO-LAUNCH ${binaryStateIndicator(autoStatus).icon} · choose an action · Tab completes /agents a → add`,
    countLabel: 'actions',
    items: [
      { value: 'add', label: 'Add', detail: 'Create a custom agent (PLIF built-ins are already listed)', symbol: '+' },
      { value: 'remove', label: 'Remove', detail: 'Delete a saved named agent', symbol: '−' },
      { value: 'rename', label: 'Rename', detail: 'Choose an agent and give it a new name', symbol: '↔' },
      { value: 'list', label: 'List', detail: 'Browse configured agents and their models', symbol: '≡' },
      { value: 'auto', label: 'Auto-use', detail: 'Control automatic launch of named agents', state: autoStatus },
    ],
    onPick: (value) => { void runAgentAction(String(value), [], context); },
  });
}

function personaNotice(
  context: CommandContext,
  message: string,
  tone: 'accent' | 'success' | 'muted' | 'warn' | 'danger' = 'accent',
  subtitle?: string,
  detail?: string,
): void {
  context.notify?.(entry('notice', message, {
    tone,
    ...(subtitle ? { subtitle } : {}),
    ...(detail ? { detail, expand: true } : {}),
  }));
}

const PERSONA_RESERVED_NAMES = new Set(['add', 'create', 'list', 'show', 'off']);

function personaListEntry(config: GlobalConfig): TimelineEntry {
  const profiles = profilesOf(config);
  const active = typeof config.activeProfile === 'string' ? config.activeProfile : undefined;
  const names = Object.entries(profiles).map(([name, profile]) =>
    `${name}${active === name ? ' (active)' : ''} · ${profile.name ?? 'persona'}${profile.model ? ` · ${profile.model}` : ''}${profile.description ? ` · ${profile.description}` : ''}`,
  );
  return entry('notice', names.length ? names.join('\n') : 'no personas configured', {
    tone: 'accent',
    subtitle: active ? `active persona: ${active}` : 'no active persona · base PLIF behavior',
    expand: true,
  });
}

function personaShowEntry(config: GlobalConfig): TimelineEntry {
  const profiles = profilesOf(config);
  const active = typeof config.activeProfile === 'string' ? config.activeProfile : undefined;
  if (!active || !profiles[active]) {
    return entry('notice', 'no active persona', {
      tone: 'muted',
      subtitle: 'PLIF base identity is active. Use /persona add to create one.',
    });
  }
  const profile = profiles[active];
  return entry('notice', `persona ${active} (active)`, {
    tone: 'accent',
    subtitle: profile.name ?? 'persistent persona',
    detail: profile.systemPrompt,
    expand: true,
  });
}

async function savePersona(
  context: CommandContext,
  name: string,
  description: string | undefined,
  systemPrompt: string,
): Promise<CommandResult> {
  const config = await loadGlobalConfig();
  const profiles = profilesOf(config);
  if (PERSONA_RESERVED_NAMES.has(name.toLowerCase())) {
    throw new PlifError('INVALID_ARGUMENT', `persona name "${name}" is reserved; choose another name`);
  }
  if (profiles[name]) {
    throw new PlifError('INVALID_ARGUMENT', `persona ${name} already exists; use another name or remove it first`);
  }
  const model = context.model?.info.id;
  const nextProfile = {
    ...(model ? { model } : {}),
    name,
    ...(description?.trim() ? { description: description.trim() } : {}),
    systemPrompt: systemPrompt.trim(),
  };
  await saveGlobalConfig({
    ...config,
    profiles: { ...(config.profiles ?? {}), [name]: nextProfile },
  });
  return ok(entry('notice', `persona ${name} saved`, {
    tone: 'success',
    subtitle: `${model ? `${model} · ` : ''}Use /persona ${name} to activate · ${globalConfigPath()}`,
  }));
}

async function createPersona(
  context: CommandContext,
  initialName?: string,
  initialPrompt?: string,
): Promise<CommandResult> {
  const nameAnswer = initialName ?? await context.engine.questions.ask({
    text: 'Persona name',
    context: 'Use a short name you will recognize in /persona. Esc cancels.',
  });
  const name = nameAnswer?.trim();
  if (!name) return ok(entry('notice', 'persona creation cancelled', { tone: 'muted' }));

  const descriptionAnswer = await context.engine.questions.ask({
    text: `Description for ${name} (optional)`,
    context: 'One short line shown by /persona list and /persona show. Press Enter to skip; Esc cancels.',
  });
  if (descriptionAnswer === null) return ok(entry('notice', 'persona creation cancelled', { tone: 'muted' }));

  const promptAnswer = initialPrompt ?? await context.engine.questions.ask({
    text: `Instructions for ${name}`,
    context: 'Paste the behavior/personality instructions for this persona. Esc cancels.',
  });
  const systemPrompt = promptAnswer?.trim();
  if (!systemPrompt) return ok(entry('notice', 'persona creation cancelled', {
    tone: 'muted',
    subtitle: 'A persona needs instructions before it can be saved.',
  }));

  return savePersona(context, name, descriptionAnswer?.trim() || undefined, systemPrompt);
}

function openPersonasMenu(context: CommandContext, config: GlobalConfig): void {
  const profiles = profilesOf(config);
  const active = typeof config.activeProfile === 'string' ? config.activeProfile : undefined;
  const personaItems: PickerItem[] = Object.entries(profiles).map(([name, profile]) => ({
    value: `use:${name}`,
    label: name,
    detail: `${name === active ? 'active · ' : ''}${profile.description ?? profile.name ?? 'saved persona'}`,
    current: name === active,
  }));
  context.openPicker({
    title: 'Personas',
    hint: `${Object.keys(profiles).length} configured · ${active ? `active: ${active}` : 'no active persona'} · choose an action · Esc closes`,
    countLabel: 'actions',
    items: [
      { value: 'add', label: 'Add persona', detail: 'Create and save a guided behavior layer', symbol: '+' },
      { value: 'list', label: 'List personas', detail: 'Browse saved personas and their descriptions', symbol: '≡' },
      { value: 'show', label: 'Show active', detail: active ? `Read the instructions for ${active}` : 'Show the base PLIF behavior status', symbol: '◇' },
      { value: 'off', label: 'Return to base behavior', detail: 'Use the base PLIF behavior without a saved persona', state: 'off', current: !active },
      ...personaItems,
    ],
    onPick: (value) => {
      const selected = String(value);
      if (selected.startsWith('use:')) {
        void runPersonaAction(selected.slice('use:'.length), [], context)
          .then((result) => result.entries.forEach((item) => context.notify?.(item)))
          .catch((error: unknown) => personaNotice(context, 'could not activate persona', 'danger', error instanceof Error ? error.message : 'try again'));
        return;
      }
      void runPersonaAction(selected, [], context)
        .then((result) => result.entries.forEach((item) => context.notify?.(item)))
        .catch((error: unknown) => personaNotice(context, 'persona action failed', 'danger', error instanceof Error ? error.message : 'try again'));
    },
  });
}

async function runPersonaAction(action: string, argv: readonly string[], context: CommandContext): Promise<CommandResult> {
  const config = await loadGlobalConfig();
  const normalized = action.trim().toLowerCase();
  if (!normalized || normalized === 'menu') {
    openPersonasMenu(context, config);
    return ok();
  }
  if (normalized === 'add' || normalized === 'create') {
    const name = argv[0]?.trim();
    const prompt = argv.slice(1).join(' ').trim();
    return createPersona(context, name || undefined, prompt || undefined);
  }
  if (normalized === 'list') return ok(personaListEntry(config));
  if (normalized === 'show') return ok(personaShowEntry(config));
  if (normalized === 'off') {
    if (!context.clearProfile) throw new PlifError('INVALID_ARGUMENT', 'this session cannot disable personas');
    await context.clearProfile();
    return ok(entry('notice', `${binaryStateIndicator('off').icon} persona`, {
      tone: 'danger',
      subtitle: 'base PLIF identity restored; the model selection was preserved',
    }));
  }
  const profiles = profilesOf(config);
  if (!profiles[action]) throw new PlifError('INVALID_ARGUMENT', `unknown persona ${action}; use /persona add or /persona list`);
  await context.switchProfile(action);
  return ok(entry('notice', `persona ${action} is active`, {
    tone: 'accent',
    subtitle: 'persistent behavior layer applied above the base PLIF rules',
  }));
}

async function runAgentAction(action: string, argv: readonly string[], context: CommandContext): Promise<CommandResult> {
  const config = await loadGlobalConfig().catch((): GlobalConfig => ({}));
  const agents = { ...(config.agent ?? {}) };
  const normalized = normalizeAgentAction(action);
  if (normalized === 'menu') return openAgentsMenu(context, config), ok();
  if (!normalized) throw new PlifError('INVALID_ARGUMENT', 'usage: /agents [add|remove|rename|list|auto]');
  if (normalized === 'add') {
    // Keep the old explicit form working for scripts and existing muscle memory.
    const name = argv[0]?.trim();
    const model = argv[1]?.trim();
    if (name && model) {
      const description = argv.slice(2).join(' ').trim();
      agents[name] = { model, ...(description ? { description } : {}) };
      await saveGlobalConfig({ ...config, agent: agents });
      return ok(entry('notice', `agent ${name} saved`, { tone: 'success', subtitle: globalConfigPath() }));
    }
    openAgentAddMenu(context, config);
    return ok();
  }
  if (normalized === 'remove') {
    const name = argv[0]?.trim();
    if (name) {
      if (!agentsOf(config)[name]) throw new PlifError('INVALID_ARGUMENT', `unknown agent "${name}"; use /agents list`);
      if (isBuiltinAgent(name)) agents[name] = { disable: true };
      else delete agents[name];
      await saveGlobalConfig({ ...config, agent: agents });
      return ok(entry('notice', `agent ${name} removed`, { tone: 'accent', subtitle: globalConfigPath() }));
    }
    openAgentRemove(context, config);
    return ok();
  }
  if (normalized === 'rename') {
    openAgentRename(context, config);
    return ok();
  }
  if (normalized === 'list') {
    openAgentList(context, config);
    return ok();
  }
  if (normalized === 'auto') {
    const mode = argv[0]?.trim().toLowerCase();
    if (mode === 'on' || mode === 'off') {
      await saveGlobalConfig({ ...config, agentAutoLaunch: mode === 'on' });
      const marker = binaryStateIndicator(mode === 'on' ? 'on' : 'off').icon;
      return ok(entry('notice', `agent auto-use ${marker}`, {
        tone: mode === 'on' ? 'success' : 'danger',
        subtitle: globalConfigPath(),
      }));
    }
    if (mode && mode !== 'show') throw new PlifError('INVALID_ARGUMENT', 'usage: /agents auto [on|off|show]');
    if (mode === 'show') {
      const status = agentAutoLaunchStatus(config);
      return ok(entry('notice', `AUTO-LAUNCH ${binaryStateIndicator(status).icon}`, {
        tone: 'accent',
        subtitle: status === 'on'
          ? 'Named agents may be selected automatically when they match the task.'
          : 'Named agents require an explicit request such as “use the CEO”.',
      }));
    }
    openAgentAuto(context, config);
    return ok();
  }
  return ok();
}

function tokenSplitListEntry(
  config: Awaited<ReturnType<typeof loadTokenSplitConfig>>,
): TimelineEntry {
  const definitions = tokenSplitDefinitions();
  return entry('notice', JSON.stringify({
    enabled: config.enabled,
    techniques: definitions.map((definition) => ({
      ...definition,
      on: config.techniques[definition.id]?.on === true,
    })),
    prices: config.prices,
    sanity: config.sanity,
  }, null, 2), { tone: 'accent', expand: true });
}

function openTokenSplitPicker(
  config: Awaited<ReturnType<typeof loadTokenSplitConfig>>,
  context: CommandContext,
): void {
  const definitions = tokenSplitDefinitions();
  const items: PickerItem[] = definitions.map((definition) => {
    const on = config.techniques[definition.id]?.on === true;
    return {
      value: definition.id,
      label: definition.id,
      state: on ? 'on' : 'off',
      current: on,
      badges: [`L${definition.layer}`],
      detail: `${definition.name} · ${definition.runtime} · ${definition.description}`,
    };
  });

  context.openPicker({
    title: `TOKEN SPLIT · ${binaryStateIndicator(config.enabled ? 'on' : 'off').icon}`,
    countLabel: 'methods',
    hint: '↑↓ navigate · Enter activate/remove · / search · Esc close · ✓ active · × inactive',
    items,
    selected: Math.max(0, items.findIndex((item) => item.current)),
    onPick: (value) => {
      const id = String(value);
      return runTokenSplitAction('toggle', [id], context)
        .then((result) => result.entries.forEach((item) => context.notify?.(item)))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          context.notify?.(entry('notice', `token-split: ${message}`, { tone: 'danger' }));
        });
    },
  });
}

async function runTokenSplitAction(action: string, argv: readonly string[], context: CommandContext): Promise<CommandResult> {
  const normalized = action.trim().toLowerCase() || 'list';
  const config = await loadTokenSplitConfig();
  if (normalized === 'list') {
    if (argv.includes('--json')) return ok(tokenSplitListEntry(config));
    openTokenSplitPicker(config, context);
    return ok();
  }

  if (normalized === 'add' || normalized === 'remove' || normalized === 'toggle') {
    const id = argv[0]?.trim();
    const definition = id ? tokenSplitDefinition(id) : undefined;
    if (!definition) throw new PlifError('INVALID_ARGUMENT', `unknown technique "${id ?? ''}"; use /token-split list`);
    const current = config.techniques[definition.id]!.on;
    const desired = normalized === 'add' ? true : normalized === 'remove' ? false : !current;
    if (!desired && !definition.removable) {
      return ok(entry('notice', `${definition.id} cannot be removed`, {
        tone: 'warn',
        subtitle: 'layer 0 techniques are lossless safety rails and cannot be switched off',
      }));
    }
    if (desired && definition.layer === 2 && !current) {
      const answer = await context.engine.questions.ask({
        text: `Enable ${definition.id}? This is a lossy technique and can change model-visible prose.`,
        options: ['enable', 'cancel'],
        context: 'Layer 2 requires explicit confirmation. Use /token-split test and /token-split audit after enabling.',
      });
      if (answer?.trim().toLowerCase() !== 'enable') {
        return ok(entry('notice', `${binaryStateIndicator('off').icon} ${definition.id} unchanged`, { tone: 'muted', subtitle: 'lossy technique remains inactive' }));
      }
    }
    if (desired && definition.layer === 1 && !current) {
      const answer = await context.engine.questions.ask({
        text: `Enable ${definition.id}? It changes only the model-facing projection and keeps the durable transcript intact.`,
        options: ['enable', 'cancel'],
        context: 'Layer 1 is reversible, but review /token-split audit after the next turn.',
      });
      if (answer?.trim().toLowerCase() !== 'enable') {
        return ok(entry('notice', `${binaryStateIndicator('off').icon} ${definition.id} unchanged`, { tone: 'muted', subtitle: 'reversible projection remains inactive' }));
      }
    }
    await saveTokenSplitConfig({
      ...config,
      techniques: {
        ...config.techniques,
        [definition.id]: { ...config.techniques[definition.id]!, on: desired },
      },
    });
    return ok(entry('notice', `${binaryStateIndicator(desired ? 'on' : 'off').icon} ${definition.id}`, {
      tone: desired ? 'success' : 'danger',
      subtitle: `${definition.runtime} · applies at the next turn · /token-split test ${definition.id}`,
    }));
  }

  if (normalized === 'stats') {
    const records = await readTokenSplitMetrics(context.cwd);
    const requested = argv[0]?.trim();
    const relevant = requested
      ? records.filter((record) => record.transformacoes.some((item) => item.technique === requested))
      : records;
    const baseline = relevant.reduce((sum, record) => sum + record.inputTokens.baseline, 0);
    const sent = relevant.reduce((sum, record) => sum + record.inputTokens.enviados, 0);
    const output = relevant.reduce((sum, record) => sum + record.outputTokens, 0);
    const saved = Math.max(0, baseline - sent);
    const pct = baseline > 0 ? (saved / baseline) * 100 : 0;
    const transforms = relevant.flatMap((record) => record.transformacoes);
    const lines = [
      `TOKEN SPLIT — STATS${requested ? ` · ${requested}` : ''}`,
      `turns       ${relevant.length}`,
      `input       ${formatTokens(sent)} sent · ${formatTokens(baseline)} baseline`,
      `reduction   ${formatTokens(saved)} (${pct.toFixed(1)}%)`,
      `output      ${formatTokens(output)}`,
      `cache       ${relevant.every((record) => record.cache.hit === null) ? 'unknown' : formatTokens(relevant.reduce((sum, record) => sum + (record.cache.hit ?? 0), 0))} hit · ${relevant.every((record) => record.cache.miss === null) ? 'unknown' : formatTokens(relevant.reduce((sum, record) => sum + (record.cache.miss ?? 0), 0))} miss`,
      `cost        ${relevant.some((record) => record.custo.totalUsd === null) ? 'unknown (provider did not expose a price)' : `$${relevant.reduce((sum, record) => sum + (record.custo.totalUsd ?? 0), 0).toFixed(4)}`}`,
      `transforms  ${transforms.length}`,
    ];
    if (transforms.length) lines.push('', ...transforms.slice(-12).map((item) => `${item.technique} · ${item.action} · ~${item.tokensAffected} tokens`));
    return ok(entry('notice', lines.join('\n'), {
      tone: 'accent',
      expand: true,
      subtitle: 'measured from request projections; raw transcript remains intact',
    }));
  }

  if (normalized === 'test') {
    const id = argv[0]?.trim();
    if (id && !tokenSplitDefinition(id)) throw new PlifError('INVALID_ARGUMENT', `unknown technique "${id}"; use /token-split list`);
    const results = runTokenSplitSanity(id);
    await appendTokenSplitSanity(context.cwd, results);
    const observations = await readTokenSplitSanity(context.cwd);
    const disabled: string[] = [];
    const blocked: string[] = [];
    let nextConfig = config;
    for (const definition of tokenSplitDefinitions()) {
      const health = tokenSplitSanityRate(observations, definition.id, config.sanity.window);
      if (health.samples < config.sanity.window || health.rate === null || health.rate >= config.sanity.autoDisableBelow) continue;
      if (!config.techniques[definition.id]!.on) continue;
      if (!definition.removable) {
        blocked.push(`${definition.id} (${Math.round(health.rate * 100)}%/${health.samples})`);
        continue;
      }
      nextConfig = {
        ...nextConfig,
        techniques: {
          ...nextConfig.techniques,
          [definition.id]: { ...nextConfig.techniques[definition.id]!, on: false },
        },
      };
      disabled.push(`${definition.id} (${Math.round(health.rate * 100)}%/${health.samples})`);
    }
    if (disabled.length > 0) await saveTokenSplitConfig(nextConfig);
    const lines = results.map((result) => `${result.status === 'pass' ? '✓' : result.status === 'not-wired' ? '·' : '✗'} ${result.technique.padEnd(18)} ${result.detail} (${result.durationMs}ms)`);
    if (disabled.length > 0) lines.push('', `${binaryStateIndicator('off').icon} AUTO (<${Math.round(config.sanity.autoDisableBelow * 100)}% over ${config.sanity.window} runs): ${disabled.join(', ')}`);
    if (blocked.length > 0) lines.push('', `SAFETY RAILS KEPT ON: ${blocked.join(', ')}`);
    return ok(entry('notice', lines.join('\n'), {
      tone: results.some((result) => result.status === 'fail') ? 'danger' : 'accent',
      expand: true,
      subtitle: disabled.length > 0
        ? 'sanity history recorded; failing removable techniques are inactive for the next turn'
        : 'deterministic local checks; not a provider benchmark',
    }));
  }

  if (normalized === 'reset') {
    await resetTokenSplitMetrics(context.cwd);
    return ok(entry('notice', 'token-split metrics reset', { tone: 'accent', subtitle: 'configuration was preserved' }));
  }

  if (normalized === 'audit') {
    const records = await readTokenSplitAudit(context.cwd);
    const lines = records.flatMap((record) => record.transformacoes.map((item) => `${record.ts} · ${item.technique} · ${item.action} · ~${item.tokensAffected} tokens · reversible=${item.reversible}`));
    return ok(entry('notice', lines.slice(-40).join('\n') || 'no token-split transformations recorded yet', {
      tone: 'accent', expand: true, subtitle: 'request projection audit · original messages are not rewritten',
    }));
  }

  if (normalized === 'now') {
    const reason = argv.join(' ').trim() || 'manual token-split request';
    if (techniqueIsOn(config, 'state-notes') && !(await stateNotesHasHardFacts(context.cwd))) {
      return ok(entry('notice', 'token-split compaction blocked: NOTES.md has no hard facts yet', {
        tone: 'warn',
        subtitle: 'run at least one turn first; the raw transcript was not changed',
      }));
    }
    const answer = await context.engine.questions.ask({
      text: `Run token-split compaction now? Reason: ${reason}`,
      options: ['compact', 'cancel'],
      context: 'The NOTES.md gate passed. The durable transcript remains available for export and recovery.',
    });
    if (answer?.trim().toLowerCase() !== 'compact') return ok(entry('notice', 'token-split compaction cancelled', { tone: 'muted' }));
    const result = await context.compactNow(false);
    return ok(entry('notice', `token-split compacted ${formatTokens(result.before)} → ${formatTokens(result.after)}`, {
      tone: result.before === result.after ? 'warn' : 'success',
      subtitle: result.before === result.after ? 'no progress; raw history was preserved' : `manual reason: ${reason}`,
    }));
  }

  throw new PlifError('INVALID_ARGUMENT', 'usage: /token-split list [--json] | add|remove|toggle <id> | stats [id] | test [id] | now [reason] | reset | audit');
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
    name: 'token-split',
    args: 'list [--json] | add|remove|toggle <id> | stats [id] | test [id] | now [reason] | reset | audit',
    summary: 'Inspect and control measured context/token projections',
    autocomplete: {
      getValues: ({ argumentIndex }) => argumentIndex === 0
        ? ['list', 'add', 'remove', 'toggle', 'stats', 'test', 'now', 'reset', 'audit']
        : argumentIndex === 1
          ? tokenSplitDefinitions().map((definition) => definition.id)
          : [],
      getDetail: (value) => tokenSplitDefinition(value)?.description,
    },
    run: async (argv, context) => runTokenSplitAction(argv[0] ?? 'list', argv.slice(1), context),
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
    name: 'temp',
    args: '[show]',
    summary: 'Show the isolated session scratch directory',
    concurrent: true,
    run: async (argv, context) => {
      if (argv.length > 0 && argv[0] !== 'show') {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /temp [show]');
      }
      return ok(
        entry('notice', '/temp', {
          tone: 'accent',
          subtitle: 'session-scoped · isolated from /project · cleaned on exit',
          detail: [
            'Use /temp for scratch files, logs, screenshots, probes, and intermediate output.',
            'Only final files explicitly requested by the user belong in /project.',
            'container path: /temp · the host scratch path stays private and is removed when this session exits',
          ].join('\n'),
          expand: true,
        }),
      );
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
      const explicitMounts = (flags.repeated['mount'] ?? []).length > 0;
      const requestedMounts = explicitMounts
        ? (flags.repeated['mount'] ?? []).map(parseMount)
        : [containerMount(context.cwd)];
      const mounts = requestedMounts.some((mount) => mount.target === '/temp')
        ? requestedMounts
        : [...requestedMounts, containerTempMount(context.tempDir)];

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
              ? '\n' + mounts
                .map((m) =>
                  m.target === '/temp'
                    ? `mount  (session temp) -> ${m.target} (${m.mode})`
                    : `mount  ${m.source} -> ${m.target} (${m.mode})`,
                )
                .join('\n')
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
        return ok(entry('notice', `${binaryStateIndicator('off').icon} plan mode`, {
          tone: 'danger',
          subtitle: 'the next agent turn may make workspace changes',
        }));
      }
      await context.setPlanMode(true, value || undefined);
      return ok(entry('notice', `${binaryStateIndicator('on').icon} plan mode`, {
        tone: 'success',
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
        await context.clearGoal();
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
        const state = isAutoApproveEnabled(config) ? 'on' : 'off';
        return ok(entry('notice', `${binaryStateIndicator(state).icon} auto approve`, {
          tone: state === 'on' ? 'success' : 'danger',
          subtitle: globalConfigPath(),
        }));
      }
      if (action !== 'on' && action !== 'off') {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /config auto-approve [on|off|show]');
      }
      const next = await setAutoApprove(action === 'on');
      context.engine.approvals.setAutoApprove(isAutoApproveEnabled(next));
      return ok(entry('notice', `${binaryStateIndicator(action === 'on' ? 'on' : 'off').icon} auto approve`, {
        tone: action === 'on' ? 'success' : 'danger',
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
    name: 'agents',
    aliases: ['agent'],
    args: '[add|remove|rename|list|auto]',
    summary: 'Add, remove, rename, list, or control named subagents',
    autocomplete: {
      getValues: ({ argumentIndex }) => argumentIndex === 0 ? ['menu'] : [],
      getLabel: (value) => value === 'menu' ? 'Abrir menu' : value,
      getDetail: () => 'Menu interativo de agentes · Enter abre',
    },
    run: async (argv, context) => runAgentAction(argv[0] ?? 'menu', argv.slice(1), context),
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
          `${name}${config.activeProfile === name ? ' (active)' : ''} → ${profile.model ?? '(current model)'}${profile.name ? ` — ${profile.name}` : ''}${profile.description ? ` · ${profile.description}` : ''}`,
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
    name: 'persona',
    args: '[add [name] [instructions] | list | show | off | name]',
    summary: 'Create, list, or activate a persistent PLIF persona',
    autocomplete: {
      getValues: ({ argumentIndex }) => argumentIndex === 0 ? ['add', 'list', 'show', 'off'] : [],
      getDetail: (value) => value === 'add'
        ? 'Create and save a persona with a guided form'
        : value === 'off'
          ? 'Return to the base PLIF behavior'
          : value === 'show'
            ? 'Show the active persona and its prompt layer'
            : 'List saved personas and descriptions',
    },
    run: (argv, context) => runPersonaAction(argv[0]?.trim() || 'menu', argv.slice(1), context),
  },

  {
    name: 'usage',
    args: '[menu|overview|limits|session]',
    summary: 'Open provider limits and session usage',
    autocomplete: {
      getValues: ({ argumentIndex }) => argumentIndex === 0 ? ['menu', 'overview', 'limits', 'session'] : [],
      getLabel: (value) => value === 'menu' ? 'Abrir menu' : value,
      getDetail: (value) => value === 'session'
        ? 'Show only this session counters'
        : value === 'limits'
          ? 'Show provider policy/rate-limit data'
          : 'Open the interactive usage window',
    },
    run: async (argv, context) => {
      const action = argv[0]?.trim().toLowerCase() || 'menu';
      if (action === 'menu') {
        openUsageMenu(context);
        return ok();
      }
      if (!['overview', 'limits', 'session'].includes(action)) {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /usage [menu|overview|limits|session]');
      }
      const { info, session } = await usageSnapshot(context);
      const detail = action === 'session' && session
        ? `requests ${session.requests} · ${formatTokens(session.inputTokens)} in · ${formatTokens(session.outputTokens)} out`
        : formatUsage(info, session);
      return ok(entry('notice', `usage · ${action}`, {
      tone: usageIsPositive(info.status) ? 'accent' : 'muted',
      subtitle: usageIsPositive(info.status)
          ? info.source === 'config'
            ? 'official provider policy · live counters may be unavailable'
            : 'official provider metadata from the latest response'
          : 'no quota was invented',
        detail,
        expand: true,
      }));
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
      label: command.autocomplete?.getLabel?.(value, completionContext) ?? value,
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
