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
  forgetDiscoveredModels,
  EFFORT_LEVELS,
  findCatalogModel,
  findCatalogProvider,
  filterAvailableModels,
  BUILTIN_AGENT_PRESETS,
  formatModelRef,
  isLocal,
  MODEL_CATALOG,
  modelVisionBadge,
  rankFacts,
  rankModelIds,
  scoreModel,
  providerIdForConfig,
  providerForModel,
  selectAvailableModels,
  supportedEfforts,
  strategyStatus,
  userCatalog,
  visionCandidates,
  agentsOf,
  appendTokenSplitSanity,
  unavailableUsage,
  loadTokenSplitConfig,
  mergeCustomProviderConfig,
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
  CURATED_MCP_SERVERS,
  PROMPT_PROFILES,
  findCuratedServer,
  installCuratedServer,
  isPromptProfile,
  type PromptProfile,
  promptProfileOf,
  toolModeOf,
  PlifError,
} from '@plif/core';
import type { ToolPresentationMode } from '@plif/core';

import { formatCapabilities, tokenize } from './format.js';
import {
  isDotEnvPath,
  normalizeEnvName,
} from './commands/env.js';
import type { EnvCommandActions, EnvStatus } from './commands/env.js';
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
  /** Whether plan mode is on, so the menu can say which state is active. */
  readonly planMode?: boolean;
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
  /** Open the session-scoped environment surface without printing values. */
  readonly openEnv?: () => void | Promise<void>;
  /** Open the isolated BTW input surface. */
  readonly openBtw?: () => void | Promise<void>;
  /** Session environment operations; values are accepted only through this seam. */
  readonly env?: EnvCommandActions;
  /** Resolves after pending transcript writes, so /env never races lazy session creation. */
  readonly hasPersistentSession?: () => Promise<boolean>;
  /** The mutable runtime map injected after a newly-created container is running. */
  readonly containerEnvironment?: () => Readonly<Record<string, string>>;
  /** Start/cancel a read-only, non-transcript BTW request. */
  readonly runBtw?: (question: string) => void | Promise<void>;
  readonly cancelBtw?: () => void;
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
  /** The list-shaped screens. Absent in non-interactive runs, which print instead. */
  readonly openUsage?: () => void;
  readonly openAgents?: () => void;
  readonly openSessions?: () => void;
  readonly openStats?: () => void;
  readonly openMcp?: () => void;
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

export interface SlashCommandPresentation {
  /** Safe text, if any, that may be shown in the main timeline. */
  readonly display: string;
  /** Secret-bearing commands are deliberately absent from composer history. */
  readonly remember: boolean;
  /** Side-channel commands do not become rows in the main conversation view. */
  readonly timeline: boolean;
}

/**
 * Keep local command values out of both the timeline and shell history. This
 * is intentionally independent from command execution: the raw argv is still
 * passed to `/env set`, but its presentation is decided before any UI write.
 */
export function slashCommandPresentation(line: string): SlashCommandPresentation {
  const trimmed = line.trim();
  const words = tokenize(trimmed.startsWith('/') ? trimmed.slice(1) : trimmed);
  const name = words[0]?.toLowerCase() ?? '';
  if (name === 'btw') return { display: '', remember: false, timeline: false };
  if (name === 'env' && words[1]?.toLowerCase() === 'set' && words.length > 3) {
    const variable = words[2] ?? 'NAME';
    return {
      display: `/env set ${variable} [secret omitted]`,
      remember: false,
      timeline: true,
    };
  }
  return { display: trimmed, remember: true, timeline: true };
}

export function parseBtwAction(argv: readonly string[]):
  | { readonly action: 'open' }
  | { readonly action: 'cancel' }
  | { readonly action: 'ask'; readonly question: string } {
  const words = argv.map((word) => word.trim()).filter(Boolean);
  if (words.length === 0) return { action: 'open' };
  if (words[0]?.toLowerCase() === 'cancel' && words.length === 1) return { action: 'cancel' };
  return { action: 'ask', question: words.join(' ') };
}

function envUnavailableEntry(): CommandResult {
  return ok(
    entry('notice', '/env needs a persistent session', {
      tone: 'muted',
      subtitle: 'Start a normal conversation first; secrets are never attached to a session-less run.',
    }),
  );
}

async function envGate(context: CommandContext): Promise<CommandResult | null> {
  if (context.hasPersistentSession && !(await context.hasPersistentSession())) {
    return envUnavailableEntry();
  }
  if (!context.env) {
    return ok(
      entry('notice', 'secure environment storage is unavailable', {
        tone: 'warn',
        subtitle: 'No plaintext fallback was used; start Plif with its platform credential store enabled.',
      }),
    );
  }
  return null;
}

function envStatusDetail(status: EnvStatus): string {
  const storageLabel = status.storage === 'encrypted' ? 'encrypted at rest' : 'memory only';
  const storedLabel = status.storage === 'encrypted' ? 'stored securely' : 'held in process memory';
  const lines = [
    `storage  ${storageLabel}`,
    'values   never rendered · never written to the transcript',
    `loaded   ${status.variables.filter((variable) => variable.loaded).length}/${status.variables.length} active in the container`,
  ];
  if (status.warning) lines.push(`warning  ${status.warning}`);
  if (status.variables.length > 0) {
    lines.push('', 'keys');
    lines.push(...status.variables.map((variable) =>
      `  ${variable.name} · ${variable.loaded ? 'active in container memory' : `${storedLabel}, not loaded`}`,
    ));
  } else {
    lines.push('', 'keys', '  (none saved for this project)');
  }
  return lines.join('\n');
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
    const isCodex = entryProvider.auth === 'codex';
    const result = await discoverProviderModels(entryProvider.id, {
      stored,
      // Opening /models is an explicit catalog request. Refresh the active
      // offer synchronously so removed models disappear and newly published
      // offers are visible in this picker. Codex model/list is read-only and
      // does not trigger the sign-in dialog, so account-backed models are
      // discovered here even before Codex is the active provider. Other
      // providers keep their cached or background path and are refreshed when
      // selected, avoiding a burst of network calls just to paint a menu.
      ...(isCurrentProvider
        ? { refresh: true, waitForNetwork: true }
        : isCodex
          ? { waitForNetwork: true }
          : { waitForNetwork: false }),
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
  // With no active model, keep the picker anchored to the existing anonymous
  // default instead of letting a newly visible account-backed provider change
  // what Enter selects. This preserves the first-run path while still showing
  // Codex as an available provider in the same catalog.
  const initialModel = currentItem ?? selectedModels.find(({ provider, access: providerAccess }) =>
    provider.anonymous === true && providerAccess === 'free');
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
    const initialValue = initialModel
      ? `${initialModel.provider.id}:${initialModel.model.id}`
      : undefined;
    // Keep the anonymous first-run path at row zero. Codex is intentionally
    // visible in this same catalog, but must never become the accidental
    // Enter target before the user explicitly signs in.
    const orderedItems = !currentModel && activeFilter === 'strength' && initialValue
      ? [
          ...qualifiedItems.filter((item) => item.value === initialValue),
          ...qualifiedItems.filter((item) => item.value !== initialValue),
        ]
      : qualifiedItems;
    context.openPicker({
      title,
      hint: activeHint,
      countLabel: 'available',
      items: orderedItems,
      selected: Math.max(0, orderedItems.findIndex((item) => item.current || item.value === initialValue)),
      onPick: (selection) => {
        if (typeof selection !== 'string') {
          void (options.onPick ? options.onPick(selection) : switchModelSelection(context, selection));
        }
      },
      onFilter: () => openFilterPicker(activeFilter),
      ...(onBack ? { onBack } : {}),
    });
  }
  openModelList();
}

/** Ask only for the Codex-specific speed tier when a user picks a model. */
async function askCodexFast(context: CommandContext): Promise<boolean | undefined> {
  const answer = await context.engine.questions.ask({
    text: 'Deseja usar o modo FAST?',
    options: [
      {
        value: 'fast',
        label: 'FAST',
        description: 'até 1,5× mais velocidade · maior gasto de tokens',
      },
      {
        value: 'standard',
        label: 'Padrão',
        description: 'velocidade normal · menor gasto de tokens',
      },
    ],
    context: 'Disponível somente para modelos do Codex. Esc mantém a configuração atual.',
  });
  if (answer === null) return undefined;
  return answer === 'fast';
}

/** Keep the fast-mode prompt out of startup/fallback paths; it is user-choice only. */
async function switchModelSelection(context: CommandContext, selection: ModelSelection): Promise<void> {
  if (selection.preset !== 'codex') {
    await context.switchModel(selection);
    return;
  }
  const codexFast = await askCodexFast(context);
  if (codexFast === undefined) return;
  await context.switchModel({ ...selection, codexFast });
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
  const needsCredential = !isLocal(source.endpoint) && source.id !== 'codex';
  if (needsCredential && !context.credentials) {
    context.notify?.(entry('notice', `cannot configure ${source.label} without secure credential storage`, {
      tone: 'warn',
      subtitle: 'Nothing was requested or saved. Start the normal interactive session and try again.',
    }));
    return false;
  }
  const keyEnv = credentialVariableForProvider(source.id, stored);
  const key = needsCredential
    ? (await context.engine.questions.ask({
      text: `API key · ${source.label}`,
      secret: true,
      context: [
        `Endpoint: ${source.endpoint}`,
        'The key is masked and never enters the transcript or model cache.',
        `After validation it is stored in the encrypted credential store (${keyEnv}). Esc cancels.`,
      ].join('\n'),
    }))?.trim()
    : undefined;
  if (needsCredential && !key) return false;
  const result = await discoverProviderModels(source.id, {
    stored,
    ...(key ? { apiKey: key } : {}),
    refresh: true,
    waitForNetwork: true,
  });
  if (!result.live || result.error) {
    context.notify?.(entry('notice', `could not validate ${source.label} endpoint`, {
      tone: 'danger',
      subtitle: 'Nothing was saved. Check the key and endpoint, then try again.',
    }));
    return false;
  }
  if (key) {
    try {
      await context.credentials!.remember(keyEnv, key);
    } catch {
      context.notify?.(entry('notice', `validated ${source.label}, but could not save its API key`, {
        tone: 'warn',
        subtitle: 'The provider was not changed. Check the secure credential store and try again.',
      }));
      return false;
    }
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
    // ChatGPT/Codex is an account-backed provider, not an API-key provider.
    // Its static offer must remain visible in the global model browser so the
    // user can discover and select it before the explicit sign-in step.
    if (entryProvider.auth === 'codex') {
      return [entryProvider.id, 'configured' as const] as const;
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
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host === '0.0.0.0';
  } catch {
    return false;
  }
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

const ADD_CUSTOM_PROVIDER = '__plif_add_custom_provider__';

function safeProviderEndpoint(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/(key|secret|token|password|credential|auth)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return 'custom endpoint';
  }
}


/**
 * Ask for one line of text, the way `/models` already does.
 *
 * Four commands took an argument a picker cannot supply — a layer name, an
 * image reference, a directory, a goal condition — and refused with a usage
 * string when called bare. That refusal is the interface knowing exactly what
 * it needs and declining to ask for it.
 *
 * The surface is the one the credential prompt and the custom-provider flow
 * already use, so this adds no new kind of window; it only routes more
 * commands to it. Esc answers null, which every caller treats as "changed my
 * mind" rather than as an error, because abandoning a prompt is not a failure.
 */
async function promptText(
  context: CommandContext,
  question: { readonly text: string; readonly why: string },
): Promise<string | null> {
  const answer = await context.engine.questions.ask({
    text: question.text,
    context: question.why,
  });
  const trimmed = answer?.trim();
  return trimmed ? trimmed : null;
}


/** Snapshot one container, asking for the layer name when it was not given. */
async function commitContainer(
  container: Container,
  layerName: string | undefined,
  context: CommandContext,
): Promise<CommandResult> {
  const name = layerName ?? await promptText(context, {
    text: 'Layer name',
    why: `Snapshots the workspace of ${container.name} into a reusable layer.`,
  });
  if (!name) return cancelled('commit');
  const layer = await container.commit(name);
  return ok(
    entry('step', `committed ${name}`, {
      status: 'done',
      subtitle: `${layer.digest.slice(0, 12)} · ${layer.entries.length} entries · ${formatBytes(layer.size)}`,
    }),
  );
}

/** The entry a command returns when the person pressed Esc at a prompt. */
function cancelled(what: string): CommandResult {
  return ok(entry('notice', `${what} cancelled`, { tone: 'muted' }));
}


/**
 * The recommended servers, as one pick.
 *
 * plif has no browser and no debugger of its own, and the servers that cover
 * that are known. What made them hard was not the choosing — it was reading a
 * README and hand-editing TOML to write six lines of stdio config correctly.
 * Each row says what the agent gains and what the server costs to run, because
 * a recommendation that hides either is not a recommendation.
 */
function openCuratedServerPicker(context: CommandContext): CommandResult {
  context.openPicker({
    title: 'Add a recommended MCP server',
    countLabel: 'servers',
    hint: '↑↓ navigate · Enter adds · Esc closes',
    items: CURATED_MCP_SERVERS.map((server) => ({
      value: server.id,
      label: server.label,
      detail: [
        server.summary,
        server.requires?.length ? `needs ${server.requires.join(', ')}` : '',
        server.note ?? '',
      ].filter(Boolean).join(' · '),
      searchText: [server.id, server.label, server.fills, server.summary].join(' '),
    })),
    onPick: (picked) => {
      const server = findCuratedServer(String(picked));
      if (!server) return;
      void installCuratedServer(server, globalConfigPath())
        .then((result) => {
          context.notify?.(entry('notice', `${result.replaced ? 'updated' : 'added'} ${server.label}`, {
            tone: 'accent',
            subtitle: result.unsetVariables.length
              ? `${result.unsetVariables.join(' and ')} is not set, so it will start unauthenticated`
              : 'restart plif, or reconnect from /mcp, to load its tools',
            detail: `${server.command} ${server.args.join(' ')}
${result.configFile}`,
          }));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          context.notify?.(entry('notice', `could not add ${server.label}`, { tone: 'danger', detail: message }));
        });
    },
  });
  return ok();
}

/** One guided path for a custom OpenAI-compatible gateway and its model list. */
async function addCustomProvider(context: CommandContext, stored: StoredConfig): Promise<boolean> {
  const id = (await context.engine.questions.ask({
    text: 'Provider id',
    context: 'Use letters, numbers, dots, underscores or hyphens. Reusing an id updates its model list without deleting existing metadata.',
  }))?.trim();
  if (!id) return false;

  const baseURL = (await context.engine.questions.ask({
    text: 'Base URL',
    context: 'Example: https://gateway.example.com/v1 · local HTTP endpoints can skip the key prompt.',
  }))?.trim();
  if (!baseURL) return false;

  const label = (await context.engine.questions.ask({
    text: 'Display name (optional)',
    context: 'Press Enter to use the provider id in pickers.',
  }))?.trim();
  const modelText = (await context.engine.questions.ask({
    text: 'Model ids (comma-separated, optional)',
    context: 'Example: llama-3.1-8b, qwen2.5-coder-32b · leave blank to rely on the provider model endpoint.',
  }))?.trim();
  const models = [...new Set((modelText ?? '').split(',').map((model) => model.trim()).filter(Boolean))]
    .map((model) => ({ id: model }));
  const local = isLocalEndpoint(baseURL);
  const apiKey = local
    ? undefined
    : (await context.engine.questions.ask({
        text: 'API key (optional)',
        secret: true,
        context: 'The value is masked, never enters the transcript, and is stored only in the encrypted credential broker. Press Esc to leave the provider locked until later.',
      }))?.trim() || undefined;

  let next: StoredConfig;
  try {
    next = mergeCustomProviderConfig(stored, {
      id,
      ...(label ? { label } : {}),
      baseURL,
      auth: local ? 'none' : 'api-key',
      needKey: !local,
      ...(models.length > 0 ? { models } : {}),
    });
    await saveGlobalConfig(next);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid provider definition';
    context.notify?.(entry('notice', 'provider was not saved', {
      tone: 'danger',
      subtitle: message,
    }));
    return false;
  }

  let credentialSaved = false;
  if (apiKey && context.credentials) {
    try {
      await context.credentials.remember(credentialVariableForProvider(id, next), apiKey);
      credentialSaved = true;
    } catch {
      context.notify?.(entry('notice', `provider ${label || id} saved without its key`, {
        tone: 'warn',
        subtitle: 'The endpoint is configured, but its key could not be persisted securely. Nothing was written in plaintext.',
      }));
    }
  }

  forgetDiscoveredModels(id);
  const discovered = await discoverProviderModels(id, {
    stored: next,
    ...(apiKey ? { apiKey } : {}),
    refresh: true,
    waitForNetwork: true,
  }).catch(() => null);
  const modelCount = discovered?.live && discovered.ids.length > 0
    ? `${discovered.ids.length} model${discovered.ids.length === 1 ? '' : 's'} discovered`
    : models.length > 0
      ? `${models.length} configured model${models.length === 1 ? '' : 's'}`
      : 'models will appear after the first successful discovery';
  context.notify?.(entry('notice', `provider ${label || id} ready`, {
    tone: 'success',
    subtitle: `${safeProviderEndpoint(baseURL)} · ${modelCount}${apiKey && credentialSaved ? ' · key saved securely' : ''}`,
  }));
  return true;
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
    if (entryProvider.auth === 'codex' && entryProvider.id !== activeProvider) return;
    const key = await providerKey(entryProvider.id, stored, context.credentials);
    discovered.set(entryProvider.id, await discoverProviderModels(entryProvider.id, {
      stored,
      waitForNetwork: false,
      ...(key ? { apiKey: key } : {}),
    }));
  }));
  const items = [
    {
      value: ADD_CUSTOM_PROVIDER,
      label: 'Add custom provider',
      detail: 'Endpoint + model list + masked key · no config file editing required',
      symbol: '+',
      searchText: 'add custom provider gateway endpoint model',
    },
    ...providerPickerItems(sources, activeProvider, access, discovered),
  ];
  context.openPicker({
    title: 'Select provider',
    hint: `active: ${activeLabel ?? 'none'} · Enter opens models · choose Add custom provider for a guided setup`,
    countLabel: 'providers',
    items,
    selected: Math.max(0, items.findIndex((item) => item.current) + 1),
    onPick: (value) => {
      if (String(value) === ADD_CUSTOM_PROVIDER) {
        void (async () => {
          if (await addCustomProvider(context, stored)) {
            const refreshed = (await loadGlobalConfig().catch(() => ({}))) as StoredConfig;
            await openProviderPicker(context, refreshed, providerSources(refreshed), onBack);
          }
        })();
        return;
      }
      const selected = sources.find(({ entryProvider }) => entryProvider.id === String(value))?.entryProvider;
      if (!selected) return;
      const sameProvider = selected.id === activeProvider;
      const isCodex = selected.auth === 'codex';
      const isLocked = !isCodex && !access.has(selected.id) && !selected.anonymous && !isLocalEndpoint(selected.endpoint);
      void (async () => {
        if (isLocked && !(await configureProvider(context, stored, selected))) return;
        const pickerStored = stored;
        // Selecting Codex is also the explicit session-verification action.
        // Do this even when the config already points at Codex: that state only
        // records the selected provider, not whether the ChatGPT session is
        // still authenticated in the official app-server.
        if (isCodex && !(await context.loginCodex?.() ?? false)) return;
        await openModelPicker(
          context,
          pickerStored,
          [{ entryProvider: selected, section: 'selected provider' }],
          selected.id,
          sameProvider ? context.model?.info.id : undefined,
          `Provider / ${selected.label}`,
          `${selected.description} · select a model · Esc returns to providers`,
          () => { void openProviderPicker(context, pickerStored, sources, onBack); },
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
  if (normalized === 'menu') {
    if (context.openAgents) return context.openAgents(), ok();
    return openAgentsMenu(context, config), ok();
  }
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

const TOOL_MODES = ['native', 'code', 'both'] as const;

const TOOL_MODE_DETAIL: Record<ToolPresentationMode, string> = {
  native: 'every tool schema on every request · the historical behaviour',
  code: 'one schema on the wire · the catalogue moves into the cacheable system prefix',
  both: 'schemas and run_code together · the model chooses · costs the most',
};

/**
 * Switch the tool presentation, or show which one is running.
 *
 * The environment override is reported rather than silently obeyed: a developer
 * who exported `PLIF_TOOLS_MODE` for one comparison and forgot deserves to find
 * out here, not from a config file that says something the session is ignoring.
 */
async function runCodeModeAction(
  requested: string | undefined,
  context: CommandContext,
): Promise<CommandResult> {
  const config = await loadGlobalConfig();
  const active = toolModeOf(config);
  const override = process.env['PLIF_TOOLS_MODE']?.trim();
  const overrideNote = override
    ? ` · PLIF_TOOLS_MODE=${override} overrides the saved value`
    : '';

  const value = requested?.trim().toLowerCase();
  if (!value) {
    context.openPicker({
      title: `TOOL PRESENTATION · ${active}`,
      countLabel: 'modes',
      hint: `↑↓ navigate · Enter select · Esc close${overrideNote}`,
      items: TOOL_MODES.map((mode) => ({
        value: mode,
        label: mode,
        current: mode === active,
        state: mode === active ? ('on' as const) : ('off' as const),
        detail: TOOL_MODE_DETAIL[mode],
      })),
      selected: Math.max(0, TOOL_MODES.indexOf(active)),
      onPick: (picked) => {
        void runCodeModeAction(String(picked), context)
          .then((result) => result.entries.forEach((item) => context.notify?.(item)))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            context.notify?.(entry('notice', `code-mode: ${message}`, { tone: 'danger' }));
          });
      },
    });
    return ok();
  }

  if (!(TOOL_MODES as readonly string[]).includes(value)) {
    throw new PlifError('INVALID_ARGUMENT', `unknown tool mode "${value}"; use native, code or both`);
  }
  const mode = value as ToolPresentationMode;
  await saveGlobalConfig({ ...config, toolMode: mode });
  return ok(
    entry('notice', `${glyph.done}  tool presentation    ${mode}`, {
      tone: mode === 'native' ? 'accent' : 'accentBright',
      subtitle: `${TOOL_MODE_DETAIL[mode]} · applies to the next request${overrideNote}`,
    }),
  );
}


/**
 * The prompt layer, chosen and priced.
 *
 * The numbers in the picker are measured, not asserted: they come from
 * compiling both layers against the same tool set. They are on the row because
 * this is a spending decision, and a menu that offered "compact" without
 * saying what compact buys is asking someone to guess.
 */
const PROMPT_PROFILE_DETAIL: Readonly<Record<PromptProfile, string>> = {
  auto: 'Pick by context window — compact under 32k, full above. What plif has always done.',
  compact: 'Short instruction layer at any context size. About half the fixed per-request cost.',
  full: 'Long instruction layer at any context size. The most detailed guidance, the highest fixed cost.',
};

async function runPromptProfileAction(
  requested: string | undefined,
  context: CommandContext,
): Promise<CommandResult> {
  const config = await loadGlobalConfig();
  const active = promptProfileOf(config);
  const override = process.env['PLIF_PROMPT_PROFILE']?.trim();
  const overrideNote = override ? ` · PLIF_PROMPT_PROFILE=${override} overrides the saved value` : '';

  const value = requested?.trim().toLowerCase();
  if (!value) {
    context.openPicker({
      title: `PROMPT LAYER · ${active}`,
      countLabel: 'layers',
      hint: `↑↓ navigate · Enter select · Esc close${overrideNote}`,
      items: PROMPT_PROFILES.map((profile) => ({
        value: profile,
        label: profile,
        current: profile === active,
        state: profile === active ? ('on' as const) : ('off' as const),
        detail: PROMPT_PROFILE_DETAIL[profile],
      })),
      selected: Math.max(0, PROMPT_PROFILES.indexOf(active)),
      onPick: (picked) => {
        void runPromptProfileAction(String(picked), context)
          .then((result) => result.entries.forEach((item) => context.notify?.(item)))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            context.notify?.(entry('notice', `prompt-layer: ${message}`, { tone: 'danger' }));
          });
      },
    });
    return ok();
  }

  if (!isPromptProfile(value)) {
    throw new PlifError('INVALID_ARGUMENT', `unknown prompt layer "${value}"; use auto, compact or full`);
  }
  await saveGlobalConfig({ ...config, promptProfile: value });
  return ok(
    entry('notice', `${glyph.done}  prompt layer    ${value}`, {
      tone: value === 'compact' ? 'accentBright' : 'accent',
      subtitle: `${PROMPT_PROFILE_DETAIL[value]} · applies to the next request${overrideNote}`,
    }),
  );
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
    name: 'code-mode',
    args: '[native|code|both]',
    summary: 'Choose how tools reach the model: schemas on the wire, or one run_code program',
    autocomplete: {
      getValues: ({ argumentIndex }) => (argumentIndex === 0 ? [...TOOL_MODES] : []),
      getDetail: (value) => TOOL_MODE_DETAIL[value as ToolPresentationMode],
    },
    run: async (argv, context) => runCodeModeAction(argv[0], context),
  },
  {
    name: 'prompt-layer',
    args: '[auto|compact|full]',
    summary: 'Choose the instruction layer: compact roughly halves the fixed per-request cost',
    autocomplete: {
      getValues: ({ argumentIndex }) => (argumentIndex === 0 ? [...PROMPT_PROFILES] : []),
      getDetail: (value) => PROMPT_PROFILE_DETAIL[value as PromptProfile],
    },
    run: async (argv, context) => runPromptProfileAction(argv[0], context),
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
    args: '[add | <server> login]',
    summary: 'Browse MCP servers, add a recommended one, or authenticate one',
    /**
     * Both word orders are accepted. `/mcp github login` reads as a sentence
     * and `/mcp login github` is the shape every other CLI uses; guessing
     * wrong should not cost a round trip to the help text.
     */
    run: async (argv, context) => {
      const words = argv.map((word) => word.trim()).filter(Boolean);
      const verb = words.findIndex((word) => word.toLowerCase() === 'login');

      if (verb === -1) {
        if (words.length === 1 && words[0]?.toLowerCase() === 'add') {
          return openCuratedServerPicker(context);
        }
        if (words.length === 0) {
          // The dedicated screen when there is one. The extension browser is
          // still the fallback for non-interactive runs, which have no screen
          // lifecycle to hand a full-screen view to.
          if (context.openMcp) context.openMcp();
          else context.openBrowser('mcp');
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
     * and then it is one row to clear.
     *
     * The sections are separate views rather than one dump because they answer
     * different questions — "what does it believe" and "what has it already
     * tried" are not read at the same moment, and printing both every time is
     * what made this unreadable.
     */
    run: async (argv, context) => {
      const workspace = context.cwd;
      const verb = argv.map((word) => word.trim().toLowerCase()).filter(Boolean)[0];

      const forget = async (): Promise<CommandResult> => {
        await context.engine.memory.forget(workspace);
        return ok(
          entry('notice', 'memory for this workspace is gone', {
            tone: 'accent',
            subtitle: 'facts, failures, strategies and notes',
          }),
        );
      };

      if (verb === 'forget') return await forget();
      if (verb) {
        return ok(
          entry('notice', `/memory does not know "${verb}"`, {
            tone: 'warn',
            subtitle: '/memory opens the menu · /memory forget drops it',
          }),
        );
      }

      const snapshot = await context.engine.memory.snapshot(workspace);
      const notes = snapshot.notes.trim();
      const empty =
        snapshot.facts.length === 0 &&
        snapshot.failures.length === 0 &&
        snapshot.strategies.length === 0 &&
        !notes;

      if (empty) {
        return ok(
          entry('notice', 'nothing remembered about this workspace yet', {
            tone: 'muted',
            subtitle: 'it fills in as the agent works here',
          }),
        );
      }

      return openReportMenu(context, {
        title: `Memory · ${shortenPath(workspace, 40)}`,
        hint: '↑↓ navigate · Enter opens',
        views: [
          {
            value: 'facts',
            label: 'Facts',
            detail: `${snapshot.facts.length} thing(s) it believes about this workspace`,
            primary: true,
            run: () =>
              reportEntry(
                'facts',
                rankFacts(snapshot.facts, 40).map(
                  (fact) =>
                    `${fact.text}${fact.confirmations > 1 ? `  (seen ${fact.confirmations}x)` : ''}`,
                ),
              ),
          },
          {
            value: 'failures',
            label: 'Known not to work',
            detail: `${snapshot.failures.length} approach(es) already ruled out`,
            run: () =>
              reportEntry('known not to work', rankFacts(snapshot.failures, 40).map((fact) => fact.text)),
          },
          {
            value: 'strategies',
            label: 'Strategies',
            detail: `${snapshot.strategies.length} recorded approach(es)`,
            run: () =>
              reportEntry(
                'strategies',
                snapshot.strategies.slice(-20).map((strategy) => `${strategy.approach} · ${strategyStatus(strategy)}`),
              ),
          },
          {
            value: 'notes',
            label: 'Notes',
            detail: notes ? `${notes.split(NEWLINE).length} line(s)` : 'No notes',
            run: () => reportEntry('notes', notes ? notes.split(NEWLINE) : []),
          },
          {
            value: 'forget',
            label: 'Forget everything here',
            detail: 'Drop facts, failures, strategies and notes for this workspace',
            tone: 'danger',
            run: forget,
          },
        ],
      });
    },
  },

  {
    name: 'env',
    concurrent: true,
    args: '[set NAME [value] | import <file.env> | delete NAME | clear | status]',
    summary: 'Manage project-scoped secrets without ever showing their values',
    autocomplete: {
      getValues: ({ argumentIndex }) => argumentIndex === 0
        ? ['set', 'import', 'delete', 'clear', 'status']
        : [],
      getDetail: (value) => value === 'set'
        ? 'Ask privately for a value; the project vault injects it into future container processes'
        : value === 'import'
          ? 'Import names and values from a dotenv file through the project vault; values never enter the transcript'
          : value === 'delete'
            ? 'Remove one project secret'
            : value === 'clear'
              ? 'Remove every stored secret from this project'
              : 'Show names and secure/in-memory state only',
    },
    run: async (argv, context) => {
      const blocked = await envGate(context);
      if (blocked) return blocked;
      const env = context.env!;
      const action = argv[0]?.trim().toLowerCase() ?? '';

      if (!action) {
        if (context.openEnv) {
          await context.openEnv();
          return ok();
        }
        const status = await env.status();
        return ok(entry('notice', 'project environment', {
          tone: 'accent',
          subtitle: `${status.variables.length} ${status.storage === 'encrypted' ? 'encrypted' : 'memory-only'} key(s) · values hidden`,
          detail: envStatusDetail(status),
          expand: true,
        }));
      }

      if (action === 'set') {
        const name = normalizeEnvName(argv[1] ?? '');
        const supplied = argv.length > 2 ? argv.slice(2).join(' ') : undefined;
        const result = await env.set(name, supplied);
        return ok(entry('notice', result.saved ? `env ${result.name} saved` : `env ${result.name} unchanged`, {
          tone: result.saved ? 'success' : 'muted',
          subtitle: result.saved
            ? 'stored through the project vault · active in the running container on the next process'
            : 'no value was entered; the secret never entered the timeline or composer history',
        }));
      }

      if (action === 'import') {
        const file = argv[1]?.trim();
        if (!file) throw new PlifError('INVALID_ARGUMENT', 'usage: /env import <file.env>');
        if (!isDotEnvPath(file)) {
          throw new PlifError('INVALID_ARGUMENT', 'import expects a dotenv file', {
            hint: 'Use a file named .env, .env.local, or *.env.',
          });
        }
        const imported = await env.importFile(file);
        return ok(entry('notice', `imported ${imported.names.length} environment key(s)`, {
          tone: 'success',
          subtitle: 'stored through the project vault · nothing was copied to the timeline',
          detail: imported.names.length ? imported.names.join('\n') : '(no assignments found)',
          expand: true,
        }));
      }

      if (action === 'delete') {
        const name = normalizeEnvName(argv[1] ?? '');
        const removed = await env.delete(name);
        return ok(entry('notice', removed ? `env ${name} deleted` : `env ${name} was not saved`, {
          tone: removed ? 'success' : 'muted',
          subtitle: removed ? 'removed from encrypted storage and the active container map' : 'nothing changed',
        }));
      }

      if (action === 'clear') {
        const count = await env.clear();
        return ok(entry('notice', `cleared ${count} environment key(s)`, {
          tone: count > 0 ? 'success' : 'muted',
          subtitle: 'project vault and the active container map are empty',
        }));
      }

      if (action === 'status') {
        const status = await env.status();
        return ok(entry('notice', 'project environment', {
          tone: 'accent',
          subtitle: `${status.variables.length} ${status.storage === 'encrypted' ? 'encrypted' : 'memory-only'} key(s) · values hidden`,
          detail: envStatusDetail(status),
          expand: true,
        }));
      }

      throw new PlifError('INVALID_ARGUMENT', 'usage: /env [set NAME [value] | import <file.env> | delete NAME | clear | status]');
    },
  },

  {
    name: 'btw',
    concurrent: true,
    args: '[<question> | cancel]',
    summary: 'Ask an isolated read-only side question without interrupting the main agent',
    run: async (argv, context) => {
      const action = parseBtwAction(argv);
      if (action.action === 'cancel') {
        if (context.cancelBtw) context.cancelBtw();
        return ok();
      }
      if (action.action === 'open') {
        if (context.openBtw) {
          await context.openBtw();
          return ok();
        }
        return ok(entry('notice', 'BTW is ready', {
          tone: 'accent',
          subtitle: 'Use /btw <question> for a read-only side answer; it never enters the main transcript.',
        }));
      }
      if (!context.runBtw) {
        throw new PlifError('INTERNAL', 'the BTW side-channel is unavailable in this host');
      }
      await context.runBtw(action.question);
      return ok();
    },
  },

  {
    name: 'sessions',
    concurrent: true,
    summary: 'Browse and resume conversations in this workspace',
    run: async (_argv, context) => {
      // Resuming a conversation is not an extension-management task, so it no
      // longer opens the plugin browser's fourth tab. The browser remains the
      // place for MCP, skills and the marketplace.
      if (context.openSessions) context.openSessions();
      else context.openBrowser('sessions');
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
    name: 'stats',
    concurrent: true,
    summary: 'Sessions, streaks and token totals across your whole history',
    run: async (_argv, context) => {
      if (context.openStats) {
        context.openStats();
        return ok();
      }
      // A non-interactive run has no screen to open, and printing a heatmap
      // into a pipe helps nobody.
      return ok(
        entry('notice', 'stats needs an interactive session', {
          tone: 'warn',
          subtitle: 'run `plif` and use /stats',
        }),
      );
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
    args: '[--list]',
    summary: 'Browse every command and run one',
    /**
     * The way in, so it should not be a wall.
     *
     * This printed forty-two lines of text, which is the least usable shape
     * for the one surface whose job is discovery: you cannot act on it, and by
     * the time you have read to the bottom the top has scrolled away. As a
     * picker it is navigable, filterable by typing, and Enter runs the command
     * the cursor is on — which, for most of them, opens that command's own
     * menu. Discovery and use become the same gesture.
     *
     * `--list` keeps the printed form, because a flat list is what you want
     * when you are copying a name into a note or a script.
     */
    run: async (argv, context) => {
      const nameWidth = Math.max(...COMMANDS.map((command) => command.name.length)) + 3;

      if (argv.includes('--list')) {
        const lines: string[] = [];
        for (const command of COMMANDS) {
          lines.push(`/${command.name}`.padEnd(nameWidth) + command.summary);
          if (command.args) lines.push(' '.repeat(nameWidth) + command.args);
        }
        return ok(
          entry('notice', 'commands', { tone: 'accent', detail: lines.join(NEWLINE), expand: true }),
          entry('notice', 'Anything not starting with / runs as a command in the active container.', {
            tone: 'muted',
          }),
        );
      }
      if (argv.length > 0) throw new PlifError('INVALID_ARGUMENT', 'usage: /help [--list]');

      context.openPicker({
        title: 'Commands',
        countLabel: 'commands',
        hint: 'type to filter · Enter runs · Esc closes',
        items: COMMANDS.map((command) => ({
          value: command.name,
          label: `/${command.name}`,
          detail: command.args ? `${command.summary} · ${command.args}` : command.summary,
          // Aliases are how people actually reach some of these, so filtering
          // has to find a command by the name the person knows it under.
          searchText: [command.name, ...(command.aliases ?? []), command.summary].join(' '),
        })),
        onPick: (picked) => {
          // Run it bare, which for most commands now opens their own menu.
          runCommandFromMenu(String(picked), [], context);
        },
      });
      return ok();
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
      // Do this only after Engine.run has transitioned the container to
      // running. Passing the map in the spec would persist decrypted values in
      // the container metadata on disk.
      const environment = context.containerEnvironment?.();
      if (environment && Object.keys(environment).length > 0) {
        container.applyEnvironment(environment);
      }
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
    summary: 'Browse containers and act on one',
    run: async (_argv, context) =>
      openContainerPicker(context, {
        title: 'Containers',
        hint: '↑↓ navigate · Enter opens actions',
        onPick: (name) => openContainerActions(name, context),
      }),
  },

  {
    name: 'use',
    args: '<container>',
    summary: 'Aim input at a container',
    run: async (argv, context) => {
      const ref = argv[0];
      if (!ref) {
        return openContainerPicker(context, {
          title: 'Target a container',
          hint: '↑↓ navigate · Enter targets',
          onPick: (name) => runCommandFromMenu('use', [name], context),
        });
      }
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
      // Bare, with nothing targeted, this used to be an error telling you to
      // go and run two other commands first. Offer the list instead.
      if (!argv[0] && !context.current) {
        return openContainerPicker(context, {
          title: 'Stop a container',
          hint: '↑↓ navigate · Enter stops',
          onPick: (name) => runCommandFromMenu('stop', [name], context),
        });
      }
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
      // As with /stop: no target is a reason to show the list, not to refuse.
      if (!argv[0] && !context.current) {
        return openContainerPicker(context, {
          title: 'Remove a container',
          hint: '↑↓ navigate · Enter removes',
          onPick: (picked) => runCommandFromMenu('rm', [picked], context),
        });
      }
      const container = resolveTarget(argv[0], context);
      const name = container.name;
      await context.engine.remove(container.id);
      if (context.current?.id === container.id) context.setCurrent(null);
      return ok(entry('step', `removed ${name}`, { status: 'done', tone: 'muted' }));
    },
  },

  {
    name: 'commit',
    args: '[layer-name] [container]',
    summary: 'Snapshot the container workspace into a layer',
    run: async (argv, context) => {
      // No container named and none targeted: choose one, the same way /stop
      // and /rm do, rather than refusing with a usage string. The chosen
      // container goes straight to the commit path rather than back through
      // this command, which with no target would just reopen the picker.
      if (!argv[1] && !context.current) {
        return openContainerPicker(context, {
          title: 'Commit a container',
          hint: '↑↓ navigate · Enter asks for the layer name',
          onPick: (picked) => {
            const container = context.engine.get(picked);
            if (!container) return;
            void commitContainer(container, argv[0], context)
              .then((result) => result.entries.forEach((item) => context.notify?.(item)))
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                context.notify?.(entry('notice', `commit: ${message}`, { tone: 'danger' }));
              });
          },
        });
      }
      return await commitContainer(resolveTarget(argv[1], context), argv[0], context);
    },
  },

  {
    name: 'build',
    args: '[reference] [directory]',
    summary: 'Build an image from a host directory',
    run: async (argv, context) => {
      const reference = argv[0] ?? await promptText(context, {
        text: 'Image reference',
        why: 'How the image will be named, for example myproject/base:1.0.',
      });
      if (!reference) return cancelled('build');
      const source = argv[1] ?? await promptText(context, {
        text: 'Source directory',
        why: `Relative to ${shortenPath(context.cwd, 48)}, or an absolute path.`,
      });
      if (!source) return cancelled('build');

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
    summary: 'Browse images in the store',
    run: async (_argv, context) => {
      const images = await context.engine.images.list();
      if (images.length === 0) {
        return ok(entry('notice', 'No images yet. Run /build to make one.', { tone: 'muted' }));
      }
      // Same shape as /ps: the facts that were columns in a printed table are
      // the detail line of the row they describe.
      context.openPicker({
        title: 'Images',
        countLabel: 'images',
        hint: '↑↓ navigate · Enter shows the layers · Esc closes',
        items: images.map((image) => ({
          value: image.reference,
          label: image.reference,
          detail: `${image.digest.slice(0, 12)} · ${image.layers.length} layer${image.layers.length === 1 ? '' : 's'}`,
        })),
        onPick: (picked) => {
          const image = images.find((candidate) => candidate.reference === String(picked));
          if (!image) return;
          context.notify?.(
            entry('notice', image.reference, {
              tone: 'accent',
              subtitle: image.digest,
              detail: image.layers.map((layer, index) => `${String(index + 1).padStart(2)}  ${layer}`).join(NEWLINE),
              expand: true,
            }),
          );
        },
      });
      return ok();
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
    args: '[add]',
    summary: 'Choose a provider, then one of its models',
    run: async (argv, context) => {
      const stored = (await loadGlobalConfig().catch(() => ({}))) as StoredConfig;
      const action = argv[0]?.trim().toLowerCase();
      if (action && action !== 'add') {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /providers [add]');
      }
      if (action === 'add') {
        if (await addCustomProvider(context, stored)) {
          const refreshed = (await loadGlobalConfig().catch(() => ({}))) as StoredConfig;
          await openProviderPicker(context, refreshed, providerSources(refreshed));
        }
        return ok();
      }
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
        const preset = providerForModel(argv[0]);
        if (preset === 'codex') {
          await switchModelSelection(context, { preset, model: argv[0] });
        } else {
          // Preserve the existing string-selection behavior for custom or
          // user-configured models whose provider cannot be inferred here.
          await context.switchModel(argv[0]);
        }
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
      // Snapshot capabilities once. Providers can refresh their model metadata
      // asynchronously; reading the callback again while building the picker
      // can otherwise make its rows and selected index disagree.
      const supported = context.supportedEfforts?.();
      const available = [...new Set(supported ?? EFFORT_LEVELS)];
      if (!value) {
          context.openPicker({
            title: `Select effort · ${context.model?.info.id ?? 'current model'}`,
          hint: 'model → effort · choose the reasoning energy for this model',
          countLabel: 'efforts',
          items: [
            { value: 'default', label: 'Default', detail: 'let the provider choose', current: current === 'default' },
            ...effortPickerItems(available, current === 'default' ? undefined : current as Effort),
          ],
          selected: current === 'default'
            ? 0
            : Math.max(0, available.indexOf(current as Effort) + 1),
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

      const leave = async (): Promise<CommandResult> => {
        await context.setPlanMode!(false);
        return ok(entry('notice', `${binaryStateIndicator('off').icon} plan mode`, {
          tone: 'danger',
          subtitle: 'the next agent turn may make workspace changes',
        }));
      };
      const enter = async (request?: string): Promise<CommandResult> => {
        await context.setPlanMode!(true, request);
        return ok(entry('notice', `${binaryStateIndicator('on').icon} plan mode`, {
          tone: 'success',
          subtitle: request
            ? 'the plan request was sent without write tools'
            : 'inspect files and propose a plan; use /plan off to resume work',
        }));
      };

      if (command === 'off' || command === 'clear' || command === 'execute' || command === 'work') {
        return await leave();
      }
      // A description is a request, not a mode name: send it straight through.
      if (value) return await enter(value);

      // Bare, this is a mode switch with two states — the same shape as
      // /permissions — so it says which one is active instead of silently
      // toggling and leaving you to infer where you landed.
      const active = context.planMode === true;
      return openReportMenu(context, {
        title: `Plan mode · ${active ? 'on' : 'off'}`,
        hint: '↑↓ navigate · Enter switches',
        countLabel: 'modes',
        views: [
          {
            value: 'on',
            label: 'Enter plan mode',
            detail: 'Read and propose only; the write tools are withheld',
            ...(active ? { primary: true } : {}),
            run: () => enter(),
          },
          {
            value: 'off',
            label: 'Leave plan mode',
            detail: 'The next agent turn may change the workspace',
            ...(active ? {} : { primary: true }),
            run: leave,
          },
        ],
      });
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

      const clear = async (): Promise<CommandResult> => {
        await context.clearGoal!();
        return ok(entry('notice', 'goal cleared', { tone: 'accent' }));
      };
      const start = async (condition: string): Promise<CommandResult> => {
        if (condition.length > 2000) {
          throw new PlifError('INVALID_ARGUMENT', 'goal condition must be 2000 characters or fewer');
        }
        await context.startGoal!(condition);
        return ok(entry('notice', 'goal active', { tone: 'accent', subtitle: condition }));
      };
      const ask = async (): Promise<CommandResult> => {
        const condition = await promptText(context, {
          text: 'Completion condition',
          why: 'Something checkable, so the agent can tell when it is done — "npm test passes and the lint job is clean".',
        });
        return condition ? await start(condition) : cancelled('goal');
      };

      if (command === 'clear' || command === 'off' || command === 'reset') return await clear();
      // A condition typed inline is a request, not a menu selection.
      if (value) return await start(value);

      // Bare, this used to print the status and stop — a dead end that told
      // you a goal existed but not how to set or clear one.
      const goal = context.goalStatus();
      return openReportMenu(context, {
        title: goal ? `Goal · ${goal.status}` : 'Goal · none',
        hint: '↑↓ navigate · Enter selects',
        countLabel: 'actions',
        views: [
          {
            value: 'set',
            label: goal ? 'Replace the goal' : 'Set a goal',
            detail: goal ? goal.condition : 'Describe a condition the agent can verify',
            primary: true,
            run: ask,
          },
          ...(goal
            ? [{
                value: 'clear',
                label: 'Clear the goal',
                detail: 'Stop working toward it',
                tone: 'danger' as const,
                run: clear,
              }]
            : []),
        ],
      });
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
      const enforcement = (): CommandResult =>
        reportEntry(
          `sandbox: ${report.backend} (${report.isolation})`,
          [
            ...flags.map(([label, on]) => `${on ? glyph.done : glyph.failed} ${label}`),
            '',
            `output decoded as ${report.textEncoding}`,
          ],
          { tone: report.isolation === 'none' ? 'danger' : 'accent' },
        );

      // With nothing degraded there is one thing to say, and a menu offering a
      // single row would be ceremony. The second view appears only when there
      // is a second thing to read.
      if (report.degradations.length === 0) return enforcement();

      return openReportMenu(context, {
        title: `Sandbox · ${report.backend} (${report.isolation})`,
        hint: '↑↓ navigate · Enter opens',
        views: [
          {
            value: 'enforcement',
            label: 'What is enforced',
            detail: `${flags.filter(([, on]) => on).length} of ${flags.length} controls active`,
            primary: true,
            run: enforcement,
          },
          {
            value: 'degradations',
            label: 'What this machine cannot enforce',
            detail: `${report.degradations.length} gap(s) in the isolation`,
            tone: 'danger',
            run: () => reportEntry('sandbox degradations', [...report.degradations], { tone: 'warn' }),
          },
        ],
      });
    },
  },

  {
    name: 'policy',
    concurrent: true,
    summary: 'Show the active policy rules',
    run: async (_argv, context) => {
      const document = context.engine.policy.document;
      const rules = document.rules.map(
        (rule) =>
          `${rule.decision.padEnd(6)} ${rule.name.padEnd(28)} ${rule.match ?? rule.argvPattern ?? '*'}`,
      );
      const byDecision = (decision: string): string[] =>
        document.rules
          .filter((rule) => rule.decision === decision)
          .map((rule) => `${rule.name.padEnd(28)} ${rule.match ?? rule.argvPattern ?? '*'}`);

      return openReportMenu(context, {
        title: `Policy · trust=${document.trust} · fallback=${document.fallback}`,
        hint: '↑↓ navigate · Enter opens',
        views: [
          {
            value: 'all',
            label: 'All rules',
            detail: `${rules.length} rule${rules.length === 1 ? '' : 's'}, in evaluation order`,
            primary: true,
            run: () => reportEntry('policy rules', rules),
          },
          {
            // The rules that refuse outright are the ones worth being able to
            // read on their own: they are why an action failed.
            value: 'deny',
            label: 'What is denied',
            detail: `${byDecision('deny').length} rule(s) that refuse outright`,
            run: () => reportEntry('denied by policy', byDecision('deny'), { tone: 'danger' }),
          },
          {
            value: 'ask',
            label: 'What needs approval',
            detail: `${byDecision('ask').length} rule(s) that prompt first`,
            run: () => reportEntry('needs approval', byDecision('ask'), { tone: 'warn' }),
          },
          {
            value: 'network',
            label: 'Network allowlist',
            detail: document.networkAllowlist.length
              ? `${document.networkAllowlist.length} host(s) reachable`
              : 'Empty — no outbound host is allowed',
            run: () => reportEntry('network allowlist', [...document.networkAllowlist]),
          },
        ],
      });
    },
  },

  {
    name: 'config',
    concurrent: true,
    summary: 'Open PLIF settings',
    run: async (argv, context) => {
      if (argv.length > 0) {
        // `/config auto-approve on|off` used to write the approval setting too,
        // through a boolean that could not express all four modes: turning it
        // "off" from `full` silently landed on `ask`, and "show" reported `full`
        // as on. One setting with two commands and two vocabularies disagreed in
        // exactly the case that matters. /permissions owns it now.
        throw new PlifError(
          'INVALID_ARGUMENT',
          'approval mode moved to /permissions [ask|auto-approve|full|deny]',
        );
      }
      if (context.openConfig) {
        context.openConfig();
        return ok();
      }
      return ok(entry('notice', 'settings need an interactive session', {
        tone: 'warn',
        subtitle: globalConfigPath(),
      }));
    },
  },

  {
    name: 'permissions',
    aliases: ['permission'],
    concurrent: true,
    args: '[ask|auto-approve|full|deny]',
    summary: 'Choose how PLIF approves model actions',
    run: async (argv, context) => {
      const current = await loadGlobalConfig();
      const mode = argv[0];
      if (!mode) {
        context.openPicker({
          title: 'Permissões',
          hint: `ativo: ${permissionMode(current)} · escolha um modo · Esc cancela`,
          countLabel: 'modos',
          items: [
            { value: 'ask', label: 'Perguntar', detail: 'Pede confirmação antes de cada ação de modelo, ferramenta, arquivo ou rede.', current: permissionMode(current) === 'ask' },
            { value: 'auto-approve', label: 'Aprovar para mim', detail: 'Aprova ações dentro do workspace sem pausar. Restrições de segurança continuam.', current: permissionMode(current) === 'auto-approve' },
            { value: 'full', label: 'Permissão Total', detail: 'Sem prompts para ações PLIF na sessão e workspace. Sandbox, máscaras e bloqueios rígidos continuam.', current: permissionMode(current) === 'full' },
          ],
          onPick: async (selected) => {
            const selectedMode = String(selected);
            if (selectedMode !== 'ask' && selectedMode !== 'auto-approve' && selectedMode !== 'full') return;
            const next = await setPermissionMode(selectedMode);
            context.engine.approvals.setPermissionMode(permissionMode(next));
            context.notify?.(entry('notice', `permissão: ${selectedMode}`, {
              tone: selectedMode === 'full' ? 'warn' : selectedMode === 'auto-approve' ? 'success' : 'accent',
              subtitle: globalConfigPath(),
            }));
          },
        });
        return ok();
      }
      if (mode !== 'ask' && mode !== 'auto-approve' && mode !== 'full' && mode !== 'deny') {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /permissions [ask|auto-approve|full|deny]');
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
        // One screen answers both halves of the question — what the provider
        // allows and what this session spent — instead of a menu whose every
        // option printed one more line into the transcript.
        if (context.openUsage) context.openUsage();
        else openUsageMenu(context);
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

      const recent = async (): Promise<CommandResult> => {
        const records: string[] = [];
        for await (const record of context.engine.audit.read()) {
          records.push(
            `${record.at.slice(11, 19)}  ${record.type.padEnd(20)} ${JSON.stringify(record.data).slice(0, 90)}`,
          );
        }
        return reportEntry(`audit · ${records.length} records today`, records.slice(-20));
      };

      const verify = async (): Promise<CommandResult> => {
        const result = await context.engine.audit.verify();
        return ok(
          entry('notice', result.ok ? 'audit chain intact' : 'AUDIT CHAIN BROKEN', {
            tone: result.ok ? 'success' : 'danger',
            ...(result.ok ? {} : { subtitle: `first bad record: seq ${result.brokenAt}` }),
          }),
        );
      };

      // `--verify` was a flag you had to know existed. It is a row now, and
      // the flag still works for anyone who already learned it.
      if (argv.includes('--verify')) return await verify();
      if (argv.length > 0) throw new PlifError('INVALID_ARGUMENT', 'usage: /audit [--verify]');

      return openReportMenu(context, {
        title: 'Audit log',
        hint: '↑↓ navigate · Enter opens',
        views: [
          {
            value: 'recent',
            label: 'Recent records',
            detail: 'The last 20 audited actions from today',
            primary: true,
            run: recent,
          },
          {
            value: 'verify',
            label: 'Verify the hash chain',
            detail: 'Re-hash every record and report the first break',
            run: verify,
          },
        ],
      });
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

/**
 * Commands that were removed because another command already did the job.
 *
 * They are not kept as aliases: an alias would leave two names for one
 * behaviour in `/help`, which is the thing being fixed. What is kept is the
 * redirect, so muscle memory lands on an explanation rather than on "unknown
 * command" plus a fuzzy guess.
 */
export const RETIRED_COMMANDS: Readonly<Record<string, { readonly replacement: string; readonly why: string }>> = {
  profile: {
    replacement: '/persona',
    why: 'Both stored and switched the same persistent identity; /persona is the one with a menu, a guided form, /persona show and /persona off.',
  },
  'auto-approve': {
    replacement: '/permissions',
    why: 'Approval mode has four settings, and the boolean spelling could not express them.',
  },
};

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


/**
 * The containers, as something you can act on.
 *
 * The old flow was: run `/ps`, read a name off a printed table, remember it,
 * then type `/stop <name>` — four steps and one act of memorisation for one
 * decision. Every fact `/ps` printed is on the row here, and Enter opens the
 * verbs for the container the cursor is already on, so the name never has to
 * be transcribed.
 *
 * `/use`, `/stop`, `/rm` and `/commit` still take a name, because a name typed
 * from memory is faster than a menu when you already know it. They open this
 * picker only when called bare, which previously was an error.
 */

/**
 * One shape for every read-only report that has more than one view.
 *
 * `/usage` worked out the pattern — a title, a hint, and one row per view with
 * a label and a line saying what it contains — and the reason to factor it out
 * rather than copy it five times is that the value here is *consistency*. A
 * surface where each report invented its own layout is the thing that made
 * plif feel like a pile of separate tools, and five hand-written pickers drift
 * apart the moment one of them is edited.
 *
 * Views run on pick and report through the live notice channel, because a
 * picker has already closed by the time its work finishes.
 */
interface ReportView {
  readonly value: string;
  readonly label: string;
  readonly detail: string;
  /** Marked as the row the cursor starts on. */
  readonly primary?: boolean;
  readonly tone?: 'danger';
  run(): CommandResult | Promise<CommandResult>;
}

function openReportMenu(
  context: CommandContext,
  options: {
    readonly title: string;
    readonly hint: string;
    readonly countLabel?: string;
    readonly views: readonly ReportView[];
  },
): CommandResult {
  const views = options.views;
  context.openPicker({
    title: options.title,
    countLabel: options.countLabel ?? 'views',
    hint: `${options.hint} · Esc closes`,
    items: views.map((view) => ({
      value: view.value,
      label: view.label,
      detail: view.detail,
      ...(view.primary ? { current: true } : {}),
      ...(view.tone ? { tone: view.tone } : {}),
    })),
    selected: Math.max(0, views.findIndex((view) => view.primary)),
    onPick: (picked) => {
      const view = views.find((candidate) => candidate.value === String(picked));
      if (!view) return;
      void Promise.resolve(view.run())
        .then((result) => result.entries.forEach((item) => context.notify?.(item)))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          context.notify?.(entry('notice', `${options.title}: ${message}`, { tone: 'danger' }));
        });
    },
  });
  return ok();
}

/** Splitting on this rather than an inline literal keeps the source free of raw newlines. */
const NEWLINE = '\n';

/** A report body, in the one shape every view returns. */
function reportEntry(
  title: string,
  lines: readonly string[],
  options: { readonly tone?: 'accent' | 'danger' | 'muted' | 'success' | 'warn'; readonly subtitle?: string } = {},
): CommandResult {
  return ok(
    entry('notice', title, {
      tone: options.tone ?? 'accent',
      ...(options.subtitle ? { subtitle: options.subtitle } : {}),
      detail: lines.length > 0 ? lines.join('\n') : '(nothing to show)',
      expand: true,
    }),
  );
}

function containerRows(context: CommandContext): FlatPickerRequest['items'] {
  return context.engine.list().map((container) => {
    const status = container.status();
    const active = container.name === context.current?.name;
    return {
      value: container.name,
      label: container.name,
      current: active,
      detail: [
        container.id.slice(0, 8),
        status.state,
        `${status.usage.execCount} execs`,
        formatBytes(status.usage.peakMemoryBytes),
        active ? 'active' : '',
      ].filter(Boolean).join(' · '),
    };
  });
}

function openContainerPicker(
  context: CommandContext,
  options: {
    readonly title: string;
    readonly hint: string;
    readonly onPick: (name: string) => void;
  },
): CommandResult {
  const items = containerRows(context);
  if (items.length === 0) {
    return ok(entry('notice', 'No containers. Run /new to create one.', { tone: 'muted' }));
  }
  context.openPicker({
    title: options.title,
    countLabel: 'containers',
    hint: `${options.hint} · Esc closes`,
    items,
    selected: Math.max(0, items.findIndex((item) => item.current)),
    onPick: (picked) => options.onPick(String(picked)),
  });
  return ok();
}

/**
 * Run any command from a menu, reporting through the live notice channel.
 *
 * A picker has already closed by the time the command it started finishes, so
 * the result cannot be a return value; it goes to the same notice channel the
 * rest of the interface uses.
 */
function runCommandFromMenu(name: string, argv: readonly string[], context: CommandContext): void {
  void findCommand(name)?.run(argv, context)
    .then((result) => result.entries.forEach((item) => context.notify?.(item)))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      context.notify?.(entry('notice', `${name}: ${message}`, { tone: 'danger' }));
    });
}

/** The verbs available for one container, once it has been chosen. */
function openContainerActions(container: string, context: CommandContext): void {
  context.openPicker({
    title: `Container · ${container}`,
    countLabel: 'actions',
    hint: 'Enter runs · Esc closes',
    /**
     * Only the verbs a container name is the whole argument for.
     *
     * `/commit` is deliberately absent: it takes a layer name first and the
     * container second, so a row that sent one value would commit under the
     * container's own name. A picker cannot ask for the layer name, so that
     * one stays a typed command until there is a surface that can.
     */
    items: [
      { value: 'use', label: 'Target this container', detail: 'Send the next commands here' },
      { value: 'stop', label: 'Stop', detail: 'Stop it and reap its process tree' },
      { value: 'rm', label: 'Remove', detail: 'Remove it and discard its layer', tone: 'danger' as const },
    ],
    onPick: (picked) => runCommandFromMenu(String(picked), [container], context),
  });
}

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
