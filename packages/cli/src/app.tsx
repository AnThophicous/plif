import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import type { Key } from 'ink';

import {
  adoptProvider,
  credentialVariableForProvider,
  createModelProvider,
  discoverProviderModels,
  forgetProviderKey,
  findCatalogProvider,
  forgetDiscoveredModels,
  buildSystemPrompt,
  catalogSelection,
  checkForUpdate,
  disableVersion,
  conversationFromTranscript,
  DEFAULT_CONTEXT_TOKENS,
  estimateTokens,
  eventBase,
  loadStoredConfig,
  migrateProviderCredentials,
  mcpServersOf,
  openOAuthBrowser,
  parseServerConfigs,
  readAgentInstructions,
  resolveConfig,
  resolveServerConfigs,
  runCompaction,
  runLoop,
  RUN_SCRIPT_SPEC,
  stableToolSpecs,
  skillTool,
  subagentTool,
  sendMessageTool,
  SubagentCoordinator,
  GoalController,
  visionTools,
  WEB_TOOLS,
  TaskManager,
  LspManager,
  lspTools,
  EditCoordinator,
  agentsOf,
  diffStats,
  MODEL_CATALOG,
  parseDiff,
  profilesOf,
  providerIdForConfig,
  providerForModel,
  saveStoredConfig,
  storedProviderCredentials,
  userCatalog,
  searchPlugins,
  loadCatalog,
  installMarketplacePlugin,
  modelSupportsImages,
  sourceUrl,
  globalConfigPath,
  loadGlobalConfig,
  activityHudModeOf,
  plifModeOf,
  loadTokenSplitConfig,
  loadedSkillNames,
  mandatorySkillsForEffort,
  saveGlobalConfig,
  scheduleProviderDiscovery,
  startCodexLogin,
  summariseMemory,
  validateModelConfig,
  PlifError,
  supportedEfforts,
  normalizeEffort,
  redactedProviderId,
  ProjectEnvironmentStore,
  readUpdatePreferences,
  runBtw as runEphemeralBtw,
} from '@plif/core';
import type {
  Attachment,
  CatalogPlugin,
  Container,
  CredentialBroker,
  Engine,
  GlobalConfig,
  McpServerStatus,
  McpRegistry,
  McpServerConfig,
  Message,
  ModelApprovalRequest,
  ModelExecutionContext,
  ModelProvider,
  ModelSelection,
  Session,
  Skill,
  SkillRegistry,
  Tool,
  ConversationEvent,
  TaskSnapshot,
  Effort,
  CodexLoginFlow,
  EffortCapabilityCache,
  GoalState as PlifGoalState,
  LspStatus,
} from '@plif/core';
import type { SandboxCapabilityReport } from '@plif/sandbox';

import { Approval, APPROVAL_CHOICES, approvalHeight } from './components/Approval.js';
import { Browser, mcpStatusKind, sessionAge, sortMcpStatuses } from './components/Browser.js';
import { Compaction, COMPACTION_HEIGHT } from './components/Compaction.js';
import { Completions, EmojiMenu } from './components/Completions.js';
import { CodexLoginDialog } from './components/CodexLoginDialog.js';
import type { CodexLoginStatus } from './components/CodexLoginDialog.js';
import { Discovery, discoveryHeight } from './components/Discovery.js';
import { BtwPanel, btwPanelHeight } from './components/BtwPanel.js';
import type { BtwViewState } from './components/BtwPanel.js';
import { Queue, queueHeight } from './components/Queue.js';
import { Question, questionChoiceAtRow, questionHeight } from './components/Question.js';
import { SecretWarning } from './components/SecretWarning.js';
import { Footer, FOOTER_HEIGHT } from './components/Footer.js';
import type { Hint } from './components/Footer.js';
import { Header, headerHeight } from './components/Header.js';
import { ConfigScreen } from './components/ConfigScreen.js';
import { StatusScreen } from './components/StatusScreen.js';
import { Picker, filterItems, filterPickerGroups, flattenPickerGroups, pickerRows as visiblePickerRows } from './components/Picker.js';
import { Prompt, layoutPrompt, promptBodyRows, promptHeight, visiblePromptRows } from './components/Prompt.js';
import { PastedTextDialog } from './components/PastedTextDialog.js';
import { PlifActivation, PLIF_ACTIVATION_DURATION_MS } from './components/PlifActivation.js';
import { terminalSurfaceLayout } from './components/TerminalSurface.js';
import { LoadingStatus } from './components/LoadingStatus.js';
import { visibleTasks } from './components/TaskIndicator.js';
import {
  DEFAULT_ACTIVITY_HUD_MODE,
  WorkDock,
  workDockHeight,
} from './components/WorkDock.js';
import type { ActivityHudMode } from './components/WorkDock.js';
import {
  Timeline,
  TimelineRow,
  estimateHeight,
  measureTranscriptCells,
  timelineVisibleHeight,
  timelineEntriesFromEvents,
} from './components/Timeline.js';
import { ToolExpansion } from './components/ToolExpansion.js';
import { TranscriptOverlay } from './components/TranscriptOverlay.js';
import { ThinkingOverlay, thinkingBodyHeight } from './components/ThinkingOverlay.js';
import {
  commandPrefix,
  findCommand,
  matchArgumentCompletions,
  matchCommands,
  isExactCommandMatch,
  runsWhileWorking,
  tabArgumentCompletion,
  slashCommandPresentation,
} from './commands.js';
import type { Command, CommandContext } from './commands.js';
import { redactBtwSecrets } from './commands/btw.js';
import { isDotEnvPath, normalizeEnvName } from './commands/env.js';
import type { EnvCommandActions } from './commands/env.js';
import { launchUpdater } from './update-runtime.js';
import {
  redactDetectedSecrets,
  SECRET_FIRST_CONTEXT,
  SECRET_FIRST_QUESTION,
  SECRET_FINAL_CONTEXT,
  SECRET_FINAL_QUESTION,
  SECRET_REDACT_VALUE,
  SECRET_REVIEW_VALUE,
  SECRET_SEND_VALUE,
  detectDraftSecrets,
} from './security/secret-detector.js';
import {
  formatError,
  formatExecOutput,
  formatExecTag,
  describeToolCall,
  imagePathsInPaste,
  isTerminalPaste,
  languageServerNote,
  PASTE_ATTACHMENT_MIN_CHARS,
  parseSearchResults,
  pastedContentToken,
  sanitizePastedText,
  shouldAttachPastedText,
  splitPaste,
  summariseToolInput,
  toolLane,
  tokenize,
} from './format.js';
import {
  MAX_ATTACHMENT_BYTES,
  mediaTypeOf,
  readClipboardImage,
  readClipboardText,
  writeClipboardText,
} from './clipboard.js';
import { IDLE_PASTE, hasPasteMarker, readPasteChunk } from './paste.js';
import type { PasteState } from './paste.js';
import { expandShortcodes, matchEmoji, openShortcode } from './emoji.js';
import { displayWidth, stepLeft, stepRight } from './text.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { AnimationClockProvider } from './hooks/useAnimationClock.js';
import { useTranscriptController } from './hooks/useTranscriptController.js';
import { withoutReasoning } from './conversation.js';
import { entry, initialSession, scrollbackCommitEnd, sessionReducer } from './session.js';
import type { BrowserRow, BrowserState, QueuedMessage, SessionState, TimelineEntry } from './session.js';
import { ComposerHistory } from './composer/history.js';
import { composerReducer, initialComposerState, submissionFromComposer } from './composer/state.js';
import type { PastedAttachment } from './composer/state.js';
import { materializePastedLine } from './composer/paste.js';
import {
  applyLocalSuggestion,
  DEFAULT_LOCAL_ASSISTANCE_SETTINGS,
  inlineSuggestionSuffix,
  suggestLocal,
} from './composer/local-assistance.js';
import type { LocalAssistanceSettings, LocalSuggestion } from './composer/local-assistance.js';
import { editorDeleteAction, isControlShortcut } from './editor-keys.js';
import { attachmentsForPrimaryModel, hasImageAttachments } from './attachments.js';
import { allTranscriptCells } from './transcript/reducer.js';
import { initialViewport, viewportReducer } from './transcript/scroll.js';
import {
  blockJumpOffset,
  emptyThinkingDocument,
  thinkingDocument,
  thoughtBlocks,
} from './thinking-history.js';
import { emptySessionUsage } from './status.js';
import type { SessionUsage, StatusInput } from './status.js';
import { StreamFrameScheduler } from './stream-frame.js';
import type { StreamFrame } from './stream-frame.js';
import { deriveLiveStatus } from './live-status.js';
import { animationClockActive, strongFrameActive } from './animation-activity.js';
import {
  appendCompletionDelta,
  classifySubmission,
  countAgentTurns,
  discardCompletionEstimate,
  initialCompletionMeter,
  reconcileCompletionUsage,
} from './interaction-metrics.js';
import type { CompletionMeter } from './interaction-metrics.js';
import { compactPlifReviewCheckpoint, preToolProseAction } from './pre-tool-prose.js';
import { applyEffortPalette, color, formatCount, formatDuration, glyph, layout } from './theme.js';
import { containerMount, containerTempMount, containerWorkdir } from './container-paths.js';
import { authNotice } from './auth.js';
import { askProjectBrief, projectBriefInstruction } from './project-brief.js';
import { ensureProjectRoot, projectRootChoices } from './project-root.js';
import { completedTitle, titleForWorking, writeTerminalTitle } from './terminal-title.js';
import { terminalFrameRows } from './terminal-resize.js';
import { activateTheme } from './themes.js';
import type { ThemeCatalogue } from './themes.js';
import { formatSessionExport, sessionExportFileName } from './session-export.js';
import { createConfigSettings, filterConfigSettings } from './configuration.js';
import type { ConfigActions } from './configuration.js';
import {
  activityModel,
  monotonicNow,
  type LoadingPhase,
} from './loading-state.js';
import {
  EMPTY_CLICK_SEQUENCE,
  needsPasteClickTracking,
  nextClickSequence,
  SgrMouseReader,
} from './mouse.js';

export interface AppProps {
  readonly engine: Engine;
  readonly report: SandboxCapabilityReport;
  readonly cwd: string;
  /** Host path for the isolated session scratch mount exposed as /temp. */
  readonly tempDir: string;
  /** The conversation this run belongs to. Null only if sessions are disabled. */
  readonly session: Session | null;
  /** Complete prior history to render on screen, including compacted turns. */
  readonly replay: readonly ConversationEvent[];
  /** Compact prior context sent to the model after the compaction boundary. */
  readonly contextReplay?: readonly ConversationEvent[];
  readonly version: string;
  /** Null when no model is configured; the agent then refuses politely. */
  readonly provider: ModelProvider | null;
  /** Shared across profile switches so effort negotiation survives a turn. */
  readonly capabilityCache?: EffortCapabilityCache;
  readonly effort?: Effort;
  /** Theme active at startup. */
  readonly initialThemeId?: string;
  /** Why there is no provider, when there is none. Shown verbatim. */
  readonly providerProblem: string | null;
  /** Everything the agent can reach: builtins, the skill loader, MCP tools. */
  readonly tools: readonly Tool[];
  readonly skillCatalogue: string;
  readonly mcpCatalogue: string;
  /** Loaded skills, for the browser. The catalogue string is for the prompt. */
  readonly skills: readonly Skill[];
  /** Live source of both, so a skill the agent writes mid-session is reachable. */
  readonly skillRegistry?: SkillRegistry;
  /** MCP servers as connected at startup, for the browser. */
  readonly mcpStatuses: readonly McpServerStatus[];
  readonly mcpRegistry?: McpRegistry;
  /** Finds credentials the MCP configuration asked for, asking when it must. */
  readonly credentials?: CredentialBroker;
  /** Show the first-run project location question before model startup prompts. */
  readonly projectRootSetup?: boolean;
  readonly themeCatalogue: ThemeCatalogue;
}

function initialSessionState({
  replay,
  contextMax,
}: {
  readonly replay: readonly ConversationEvent[];
  readonly contextMax: number;
}): SessionState {
  const committed = timelineEntriesFromEvents(replay);
  return {
    ...initialSession,
    committed,
    epoch: committed.length > 0 ? 1 : 0,
    contextMax,
  };
}

/** How often command output is flushed into the timeline. */
const STREAM_FLUSH_MS = 90;
/**
 * Stream text gets its own bounded cadence. It must not wait for the visual
 * animation clock: that clock is intentionally slow for spinners, while text
 * already received from the provider should reach the terminal within one
 * ordinary paint window.
 */
const SEMANTIC_STREAM_FRAME_MS = 33;
const EMPTY_TRANSCRIPT_CELLS: readonly import('./transcript/types.js').TranscriptCell[] = [];
/** Window in which a second Ctrl+C means "really quit". */
const DOUBLE_INTERRUPT_MS = 1500;
/** Short prompt-frame transition after an explicit model/effort change. */
const PLAN_BLOCKED_TOOLS = new Set([
  'write_file',
  'edit_file',
  'apply_patch',
  'run_command',
  'shell_command',
  'create_profile',
  'create_skill',
  'resolve_edit_conflict',
  'activate_profile',
  'update_config',
  'remember',
  'start_task',
  'cancel_task',
]);

type AgentTurnMode = 'normal' | 'plan';
type GoalState = Pick<PlifGoalState, 'condition' | 'status' | 'revision' | 'rounds' | 'maxRounds' | 'armed' | 'blockedReason'>;
/**
 * Rows kept in the live frame behind the newest one.
 *
 * One, and the reason it is not four is the whole point of the mechanism.
 * Anything still in the live frame is erased and redrawn on every repaint, so
 * when it scrolls out of the budget it is *gone* — never printed, nowhere to
 * scroll back to. With a tail of four, a two-message exchange committed nothing
 * at all: every row stayed live, and the conversation could not be scrolled up
 * to because it had never been written to the terminal as ordinary output.
 *
 * `isSettled` is what actually protects a row from being retired too early —
 * a row that can still change is never settled. The tail is only there to keep
 * the newest row live while the reducer's `gate` action can still insert an
 * approval above it.
 */
const LIVE_TAIL = 8;
type PastedDraft =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'image';
      readonly path: string;
      readonly mediaType: string;
      readonly bytes: number;
    };

interface PastedTextPopup {
  readonly text: string;
}

/**
 * An image the developer pasted, waiting to be sent with their message.
 *
 * The file stays on disk after sending. It costs nothing in the temp
 * directory, and "let me look at that screenshot again" is a thing people ask
 * an hour later.
 */
/** True once nothing can change this row again. */
function isSettled(item: { status?: string }): boolean {
  return item.status === undefined || item.status === 'done' || item.status === 'failed';
}

/** Move inside a multiline draft before giving the arrows to shell history. */
function verticalCursor(text: string, cursor: number, delta: -1 | 1): number | null {
  if (!text.includes('\n')) return null;
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  let line = 0;
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index]! > cursor) break;
    line = index;
  }
  const lineStart = starts[line]!;
  const column = cursor - lineStart;
  const target = line + delta;
  if (target < 0 || target >= starts.length) return null;
  const targetStart = starts[target]!;
  const targetEnd = text.indexOf('\n', targetStart);
  const targetLength = (targetEnd < 0 ? text.length : targetEnd) - targetStart;
  return targetStart + Math.min(column, targetLength);
}

export const BANNER_ROW_ID = 'plif:banner';

/**
 * The startup identity is append-only terminal chrome, not live conversation
 * state. Keeping a stable item in Ink's Static list prevents Ink from
 * printing the header again every time a settled turn moves into scrollback.
 */
const STATIC_HEADER_ITEM = { id: 'plif:header', kind: 'header' } as const;

/** A missing startup credential owns the keyboard before its question mounts. */
export function needsCredentialPrompt(problem: string | null): boolean {
  return problem !== null && /(?:api key|credential)/i.test(problem);
}

const BANNER_ROW: TimelineEntry = {
  id: BANNER_ROW_ID,
  kind: 'notice',
  title: '',
  at: 0,
};

/** The answer, short enough to sit in the row's right-hand tag column. */
function truncateAnswer(answer: string): string {
  const line = answer.split('\n')[0]?.trim() ?? '';
  return line.length > 24 ? line.slice(0, 23) + '…' : line;
}

/** Resolve the provider's encrypted/environment credential without crossing providers. */
async function providerCredential(
  credentials: CredentialBroker | undefined,
  provider: string,
  stored: GlobalConfig,
): Promise<string | undefined> {
  if (!credentials) return undefined;
  const variable = credentialVariableForProvider(provider, stored);
  // An anonymous provider must remain selectable even when an old/corrupt
  // credential-store record cannot be read. A paid provider will still fail
  // closed later at model validation and can then request a fresh key.
  try {
    return await credentials.lookup(variable);
  } catch {
    return undefined;
  }
}

/** Move legacy config credentials to the encrypted broker before saving a model selection. */
async function persistModelSelection(
  engine: Engine,
  stored: GlobalConfig,
  selection: ModelSelection,
  typedKey: string | undefined,
  credentials: CredentialBroker | undefined,
): Promise<{ readonly config: GlobalConfig; readonly apiKey?: string; readonly persisted: boolean }> {
  if (!credentials) {
    // App previews/tests can run without the production broker. Do not write a
    // newly typed key in that mode; keep the key transient for this provider.
    return {
      config: typedKey
        ? adoptProvider(stored, selection, undefined, { persistCredential: false })
        : adoptProvider(stored, selection),
      ...(typedKey ? { apiKey: typedKey } : {}),
      persisted: false,
    };
  }

  try {
    const migration = await migrateProviderCredentials(stored, credentials, selection.preset);
    const clean = migration.config;
    const variable = credentialVariableForProvider(selection.preset, clean);
    if (typedKey && typedKey !== 'local') {
      await credentials.remember(variable, typedKey);
    }
    const next = adoptProvider(clean, selection, undefined, { persistCredential: false });
    await saveStoredConfig(engine.paths, next, { preserveProviderKeys: false });
    const apiKey = typedKey ?? await providerCredential(credentials, selection.preset, next);
    return { config: next, ...(apiKey ? { apiKey } : {}), persisted: true };
  } catch {
    // A DPAPI failure must not turn into a plaintext fallback. The selected
    // key remains usable for this process only; the next run can retry.
    let apiKey = typedKey;
    if (!apiKey) {
      try {
        apiKey = await providerCredential(credentials, selection.preset, stored);
      } catch {
        // The caller still receives a transient, credential-free selection and
        // can report the failed secure persistence without leaking the cause.
      }
    }
    return {
      config: adoptProvider(stored, selection, undefined, { persistCredential: false }),
      ...(apiKey ? { apiKey } : {}),
      persisted: false,
    };
  }
}

/** Prepare an unrelated config mutation without re-emitting legacy secrets. */
async function migrateCredentialsForWrite(
  stored: GlobalConfig,
  credentials: CredentialBroker,
): Promise<GlobalConfig | undefined> {
  try {
    return (await migrateProviderCredentials(
      stored,
      credentials,
      providerIdForConfig(stored) ?? '',
    )).config;
  } catch {
    return undefined;
  }
}

export function App({
  engine,
  report,
  cwd,
  tempDir,
  session,
  replay,
  contextReplay = replay,
  version,
  provider,
  capabilityCache,
  providerProblem,
  effort: initialEffort,
  initialThemeId,
  tools,
  skillCatalogue,
  mcpCatalogue,
  // Defaulted, though the type requires them. The dev previewer constructs
  // this component outside the typechecked build and omitting one crashed the
  // whole render — an empty list is a worse preview, not a broken one.
  skills: initialSkills = [],
  skillRegistry,
  mcpStatuses: initialMcpStatuses = [],
  mcpRegistry,
  credentials,
  projectRootSetup = false,
  themeCatalogue,
}: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(
    sessionReducer,
    {
      replay,
      contextMax: provider?.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
    },
    initialSessionState,
  );
  const [composer, composerDispatch] = useReducer(composerReducer, initialComposerState);
  // Keyboard callbacks can run before React has committed the render that
  // contains the latest reducer result. Keep the reducer state itself as the
  // submission seam so Enter cannot send a previous render's draft.
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const [pastedTextPopup, setPastedTextPopup] = useState<PastedTextPopup | null>(null);
  const input = composer.draft;
  const cursor = composer.cursor;
  const pasted = composer.attachments;
  const hasTextPasteAttachment = needsPasteClickTracking(pasted);
  // Mouse reports are enabled only while there is an interaction that can use
  // them. This keeps wheel scrolling native in ordinary sessions while making
  // the textual question chooser clickable when it is actually on screen.
  const questionMouseTracking = state.question !== null;
  const mouseTrackingActive = hasTextPasteAttachment || questionMouseTracking;
  const completionIndex = composer.completion?.selected ?? 0;
  const queuedIndex = composer.queuedSelection;
  const setInput = (next: React.SetStateAction<string>): void => {
    const text = typeof next === 'function' ? next(composerRef.current.draft) : next;
    composerDispatch({ type: 'draft.set', text });
  };
  const setCursor = (next: React.SetStateAction<number>): void => {
    const value = typeof next === 'function' ? next(composerRef.current.cursor) : next;
    composerDispatch({ type: 'cursor.set', cursor: value });
  };
  const setPasted = (next: React.SetStateAction<PastedAttachment[]>): void => {
    const attachments = typeof next === 'function' ? next([...composerRef.current.attachments]) : next;
    composerDispatch({ type: 'attachments.set', attachments });
  };
  const setCompletionIndex = (next: React.SetStateAction<number>): void => {
    const index = typeof next === 'function' ? next(completionIndex) : next;
    composerDispatch({ type: 'completion.select', index });
  };
  const setQueuedIndex = (next: React.SetStateAction<number>): void => {
    const index = typeof next === 'function' ? next(queuedIndex) : next;
    composerDispatch({ type: 'queue.select', index });
  };
  const [choice, setChoice] = useState(0);
  const [credentialPromptPending, setCredentialPromptPending] = useState(
    needsCredentialPrompt(providerProblem),
  );
  const [projectRootSetupPending, setProjectRootSetupPending] = useState(projectRootSetup);
  const projectRootSetupStarted = useRef(false);
  const [codexLogin, setCodexLogin] = useState<{
    readonly status: CodexLoginStatus;
    readonly detail?: string;
    readonly userCode?: string;
  } | null>(null);
  const codexLoginFlow = useRef<CodexLoginFlow | null>(null);
  const [, setThemeRevision] = useState(0);
  const [emojiIndex, setEmojiIndex] = useState(0);
  /** Live MCP status and loaded skills, for the browser's first two tabs. */
  const [mcpStatuses, setMcpStatuses] = useState<readonly McpServerStatus[]>(initialMcpStatuses);
  const [skillList, setSkillList] = useState<readonly Skill[]>(initialSkills);
  const [turn, setTurn] = useState(() => countAgentTurns(replay));
  const [agentTurnStartedAt, setAgentTurnStartedAt] = useState<number | null>(null);
  const [plifActivation, setPlifActivation] = useState(false);
  const plifActivationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [interruptArmed, setInterruptArmed] = useState(false);
  const [effort, setEffortState] = useState<Effort | undefined>(initialEffort);
  const [activityHudMode, setActivityHudModeState] = useState<ActivityHudMode>(DEFAULT_ACTIVITY_HUD_MODE);
  const activityHudSaveQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => () => {
    if (plifActivationTimer.current) clearTimeout(plifActivationTimer.current);
  }, []);
  useEffect(() => () => {
    void codexLoginFlow.current?.cancel();
  }, []);
  useEffect(() => () => {
    btwAbort.current?.abort();
    btwAbort.current = null;
  }, []);
  useEffect(() => {
    applyEffortPalette(effort);
  }, [effort]);

  // The HUD mode is a presentation preference, not runtime state. Load it
  // once and serialize writes so rapid Ctrl+S presses cannot race two atomic
  // config renames against each other.
  useEffect(() => {
    let cancelled = false;
    void loadGlobalConfig()
      .then((config) => {
        if (!cancelled) setActivityHudModeState(activityHudModeOf(config));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setActivityHudMode = useCallback((mode: ActivityHudMode): void => {
    setActivityHudModeState(mode);
    activityHudSaveQueue.current = activityHudSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const config = await loadGlobalConfig();
        await saveGlobalConfig(
          {
            ...config,
            activityHud: { ...(config.activityHud ?? {}), mode },
          },
          globalConfigPath(),
          { preserveProviderKeys: false },
        );
      })
      .catch(() => undefined);
  }, []);

  // Provider catalogs evolve independently of PLIF releases. Warm the cache
  // once after startup, then refresh at a controlled low frequency. This is a
  // background cache operation: it deliberately publishes no React state and
  // therefore cannot remount the header, input, transcript, or spinner.
  useEffect(() => {
    let stop = (): void => undefined;
    let cancelled = false;
    const start = async (): Promise<void> => {
      const stored = await loadGlobalConfig().catch(() => ({} as GlobalConfig));
      const ids = [...new Set([
        ...MODEL_CATALOG.map((provider) => provider.id),
        ...userCatalog(stored).map((provider) => provider.id),
      ])];
      if (cancelled) return;
      stop = scheduleProviderDiscovery(ids, {
        stored,
        resolve: async (providerId) => {
          if (!credentials) return { stored };
          try {
            const apiKey = await credentials.lookup(credentialVariableForProvider(providerId, stored));
            return { stored, ...(apiKey ? { apiKey } : {}) };
          } catch {
            return { stored };
          }
        },
      });
    };
    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [credentials]);
  // Completion tokens live in loadingTelemetry, not App state. A fast stream
  // must not reconcile the whole Ink tree just to update one number.
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [lspStatuses, setLspStatuses] = useState<readonly LspStatus[] | null>(null);
  const taskOutputRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTasks = useCallback((): void => {
    setTasks(visibleTasks(taskManager.current?.list() ?? []));
  }, []);
  const scheduleTaskOutputRefresh = useCallback((): void => {
    if (taskOutputRefreshTimer.current !== null) return;
    const timer = setTimeout(() => {
      taskOutputRefreshTimer.current = null;
      refreshTasks();
    }, STREAM_FLUSH_MS);
    timer.unref?.();
    taskOutputRefreshTimer.current = timer;
  }, [refreshTasks]);
  const flushTaskOutputRefresh = useCallback((): void => {
    if (taskOutputRefreshTimer.current !== null) {
      clearTimeout(taskOutputRefreshTimer.current);
      taskOutputRefreshTimer.current = null;
    }
    refreshTasks();
  }, [refreshTasks]);
  /**
   * A once-a-second clock for the panels with elapsed counters on them.
   *
   * One timer for all of them, and only while something is actually counting.
   * A `useElapsed` per panel would be three intervals re-rendering the whole
   * frame on independent phases, which on a 200-row terminal is three full
   * repaints a second for two digits of change.
   */
  const [now, setNow] = useState(() => Date.now());
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { columns: width, rows } = useTerminalSize();
  const headerAvailableWidth = Math.max(1, width - layout.gutter * 2);
  const surface = terminalSurfaceLayout(
    width,
    rows,
    headerHeight(headerAvailableWidth),
  );
  // The header is an append-only Static item now. It occupies real terminal
  // rows before Ink's live canvas, so the dynamic surface must use the panel
  // height that remains below it instead of claiming the whole terminal again.
  const liveSurfaceHeight = pastedTextPopup ? surface.canvasHeight : surface.panelHeight;
  const transcript = useTranscriptController({ engine, workspace: cwd, session, replay });
  const [transcriptViewport, dispatchTranscriptViewport] = useReducer(
    viewportReducer,
    initialViewport,
  );
  const [thinkingViewport, dispatchThinkingViewport] = useReducer(
    viewportReducer,
    initialViewport,
  );

  // Kept in refs, not state: the keyboard handler needs the current values, and
  // re-creating the handler on every keystroke would drop input under load.
  const current = useRef<Container | null>(null);
  const history = useRef(new ComposerHistory());
  const completionMeterRef = useRef<CompletionMeter>(initialCompletionMeter);
  /** approval id -> the timeline row showing it, so answers resolve in place. */
  const approvalRows = useRef<Map<string, string>>(new Map());
  /** question id -> its timeline row, for the same reason. */
  const questionRows = useRef<Map<string, string>>(new Map());
  /** When the current compaction pass began, held across its stages. */
  const compactionSince = useRef<number | null>(null);
  /** The one row all of a turn's retry attempts update, rather than ten rows. */
  const retryRow = useRef<string | null>(null);
  /** Numbers the compact paste tokens for this session. */
  const pasteCount = useRef(0);
  /** Three clicks on a pasted-text token open its readable clipboard modal. */
  const pastedClick = useRef(EMPTY_CLICK_SEQUENCE);
  const mouseReader = useRef(new SgrMouseReader());
  /**
   * The live queue, for the loop's drain callback.
   *
   * A ref beside the reducer state because `runAgent` closes over its variables
   * once, at the start of the turn — reading `state.queue` from there would see
   * an empty array for the entire run, which is exactly the window the queue
   * exists to cover.
   */
  const queueRef = useRef<readonly QueuedMessage[]>([]);
  /** Cancels the exec currently in flight, without stopping the container. */
  const execAbort = useRef<AbortController | null>(null);
  const taskManager = useRef<TaskManager | null>(null);
  const lspManager = useRef<LspManager | null>(null);
  const subagents = useRef(new SubagentCoordinator());
  const interruptTimer = useRef<NodeJS.Timeout | null>(null);
  const sessionStartedAt = useRef(Date.now());
  const usage = useRef<SessionUsage>(emptySessionUsage);
  const turnCompletionTokens = useRef(0);
  const subagentTokens = useRef(new Map<string, number>());
  /** Identity for the loading line; late events from an older turn are ignored. */
  const loadingOperationRef = useRef<{ id: number; turnId: string } | null>(null);
  /** Aggregated, redacted timing for the optional Plif end-of-turn report. */
  const turnMetricsRef = useRef<{
    turnId: string;
    startedAt: number;
    reasoningMs: number;
    toolsMs: number;
    compactionMs: number;
  } | null>(null);
  const loadingSequence = useRef(0);
  const loadingMetricPaintAt = useRef(0);
  const updatePromptPending = useRef(false);

  const beginLoading = useCallback((turnId: string): number => {
    const id = ++loadingSequence.current;
    loadingOperationRef.current = { id, turnId };
    turnMetricsRef.current = {
      turnId,
      startedAt: Date.now(),
      reasoningMs: 0,
      toolsMs: 0,
      compactionMs: 0,
    };
    loadingMetricPaintAt.current = 0;
    activityModel.start(id, turnId);
    setAgentTurnStartedAt(Date.now());
    return id;
  }, []);

  const isCurrentLoadingTurn = useCallback((turnId: string): boolean => {
    return loadingOperationRef.current?.turnId === turnId;
  }, []);

  const updateLoadingPhase = useCallback((turnId: string, phase: LoadingPhase): void => {
    const active = loadingOperationRef.current;
    if (!active || active.turnId !== turnId) return;
    if (phase === 'reasoning') activityModel.reasoningStart(active.id);
    else if (phase === 'cancelling') activityModel.phase(active.id, 'cancelling');
    else activityModel.phase(active.id, phase as Exclude<LoadingPhase, 'idle' | 'done' | 'error'>);
  }, []);

  useEffect(() => () => {
    // The UI can unmount while the provider is being torn down. Drop the
    // subscription source as well, so a late stream event cannot repaint a new
    // session's loading line.
    activityModel.reset();
    loadingOperationRef.current = null;
  }, []);

  // --- live output plumbing ---
  // Chunks arrive far faster than the terminal can usefully repaint, so they
  // accumulate in a ref and are flushed on a timer. Dispatching per chunk would
  // re-render the whole frame for every few bytes of a build log.
  const stream = useRef<{ rowId: string | null; text: string; dirty: boolean }>({
    rowId: null,
    text: '',
    dirty: false,
  });
  /** One-shot drain: idle sessions must not keep a polling timer alive. */
  const streamFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleStreamFlush = useCallback((): void => {
    if (streamFlushTimer.current !== null) return;
    const timer = setTimeout(() => {
      streamFlushTimer.current = null;
      const live = stream.current;
      if (!live.dirty || !live.rowId) return;
      live.dirty = false;
      dispatch({ type: 'update', id: live.rowId, patch: { detail: live.text } });
    }, STREAM_FLUSH_MS);
    timer.unref?.();
    streamFlushTimer.current = timer;
  }, []);
  /** Row waiting to be bound to an execId by the next `exec.start`. */
  const pendingRow = useRef<string | null>(null);
  /**
   * Tool calls in flight, keyed by wire id.
   *
   * A map, not a single ref: parallel-safe calls now go out in batches, so four
   * reads can be open at once and matching an `end` to its `start` by tool name
   * would resolve the wrong row.
   */
  const toolRows = useRef<Map<string, string>>(new Map());
  /** The agent's answer row, so streamed text can land in it. */
  const agentRow = useRef<string | null>(null);
  const agentText = useRef<string>('');
  /**
   * The open thinking row and its text.
   *
   * Its own buffer rather than the shared `stream` one: reasoning and answer
   * text can both be live in the same turn — a model thinks, answers, thinks
   * again before a tool — and a single-slot buffer would write one into the
   * other's row.
   */
  const thinkRow = useRef<{ id: string; text: string; since: number; dirty: boolean } | null>(null);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const semanticStartedAt = useRef<number | null>(null);
  const paintedEpoch = useRef<number | null>(null);
  const semanticFrames = useRef<StreamFrameScheduler | null>(null);
  semanticFrames.current ??= new StreamFrameScheduler({
    frameMs: SEMANTIC_STREAM_FRAME_MS,
    onFrame: (frame: StreamFrame) => {
      if (frame.kind === 'reset') {
        semanticStartedAt.current = null;
        paintedEpoch.current = null;
        transcriptRef.current.resetStream();
        return;
      }

      if (frame.kind === 'data' && frame.lanes.length > 0 && paintedEpoch.current !== frame.epoch) {
        paintedEpoch.current = frame.epoch;
        const started = semanticStartedAt.current;
        if (started !== null) {
          engine.bus.emit('stream.timing', {
            phase: 'first-paint',
            elapsedMs: Date.now() - started,
            provider: redactedProviderId(provider?.info.endpoint ?? ''),
            model: provider?.info.id ?? 'unknown-model',
          });
        }
      }

      const patches: { id: string; patch: Partial<TimelineEntry> }[] = [];
      if (frame.lanes.includes('reasoning')) {
        const live = thinkRow.current;
        if (live) {
          live.text = frame.reasoning;
          live.dirty = false;
          patches.push({ id: live.id, patch: { detail: frame.reasoning } });
        }
      }
      if (frame.lanes.includes('answer')) {
        const id = agentRow.current;
        if (id) {
          agentText.current = frame.answer;
          patches.push({ id, patch: { detail: frame.answer } });
        }
      }
      if (patches.length > 0) dispatch({ type: 'stream.frame', patches });

      let meter = completionMeterRef.current;
      for (const change of frame.changes) {
        if (change.lane === 'completion') meter = appendCompletionDelta(meter, change.delta);
      }
      if (meter !== completionMeterRef.current) {
        completionMeterRef.current = meter;
        const active = loadingOperationRef.current;
        const now = monotonicNow();
        // Token text can arrive every 33ms. The loading metrics have a calm,
        // human-readable cadence; the stream itself remains fully batched.
        if (active && now - loadingMetricPaintAt.current >= 360) {
          loadingMetricPaintAt.current = now;
          activityModel.tokens(active.id, meter.tokens, meter.estimated);
        }
      }
      transcriptRef.current.applyStreamFrame(frame);
      if (frame.kind === 'complete' || frame.kind === 'dispose') {
        semanticStartedAt.current = null;
        paintedEpoch.current = null;
      }
    },
  });
  /** Everything said so far, minus the system prompt, carried across turns. */
  const conversation = useRef<Message[]>([]);
  /** Snapshot source for BTW while the primary agent is between turns. */
  const activeConversation = useRef<readonly Message[] | null>(null);
  /** BTW is a side channel: its lifecycle never enters SessionState. */
  const [btwView, setBtwView] = useState<BtwViewState | null>(null);
  const [btwInput, setBtwInput] = useState<{ readonly draft: string; readonly cursor: number } | null>(null);
  const btwAbort = useRef<AbortController | null>(null);
  const btwSequence = useRef(0);
  const providerRef = useRef<ModelProvider | null>(provider);
  const modelKeyPrompted = useRef(false);
  /** The empty-install picker opens once per session, not once per render. */
  const modelPickerPrompted = useRef(false);
  /** Decrypted values are held only for the active process/container. */
  const sessionEnvironment = useRef<Record<string, string>>({});
  /** Current transcript owner, used to reject stale async environment work. */
  const activeEnvironmentSession = useRef<string | null>(null);
  activeEnvironmentSession.current = transcript.session?.id ?? session?.id ?? null;
  const loadedEnvironmentSession = useRef<string | null>(null);
  const environmentQueue = useRef<Promise<void>>(Promise.resolve());
  const environmentStore = useMemo(() => new ProjectEnvironmentStore({
    passphrase: async () => (await engine.questions.ask({
      text: 'Project environment passphrase',
      secret: true,
      context: 'This passphrase unlocks the encrypted project environment. It is never stored.',
    })) ?? undefined,
  }), [engine]);
  const environmentScope = useCallback(
    (_sessionId?: string) => ({ workspace: cwd }),
    [cwd],
  );
  const effortRef = useRef<Effort | undefined>(initialEffort);
  const [planMode, setPlanModeState] = useState(false);
  const planModeRef = useRef(false);
  const goalRef = useRef<GoalState | null>(null);
  const goalControllerRef = useRef<GoalController | null>(null);
  if (!goalControllerRef.current) {
    goalControllerRef.current = new GoalController(engine.paths.root, cwd);
  }
  const syncGoalRef = (): void => {
    const state = goalControllerRef.current?.get();
    goalRef.current = state
      ? {
          condition: state.condition,
          status: state.status,
          revision: state.revision,
          rounds: state.rounds,
          maxRounds: state.maxRounds,
          armed: state.armed,
          blockedReason: state.blockedReason,
        }
      : null;
  };
  useEffect(() => {
    const controller = goalControllerRef.current;
    if (!controller) return;
    void controller.ready().then(syncGoalRef).catch(() => undefined);
  }, [cwd, engine]);
  const activeThemeId = useRef(initialThemeId ?? themeCatalogue.themes[0]?.id ?? 'minimal');
  const [configSnapshot, setConfigSnapshot] = useState<GlobalConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configProblem, setConfigProblem] = useState<string | null>(null);

  const loadConfigSnapshot = useCallback(async (): Promise<void> => {
    setConfigLoading(true);
    setConfigProblem(null);
    try {
      setConfigSnapshot(await loadGlobalConfig());
    } catch (error) {
      const { title } = formatError(error);
      setConfigSnapshot(null);
      setConfigProblem(title);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const openStatusScreen = useCallback((): void => {
    setConfigSnapshot(null);
    setConfigProblem(null);
    dispatch({ type: 'screen.open', screen: 'status' });
    void loadConfigSnapshot();
  }, [loadConfigSnapshot]);

  const openConfigScreen = useCallback((): void => {
    setConfigSnapshot(null);
    setConfigProblem(null);
    dispatch({ type: 'screen.open', screen: 'config' });
    void loadConfigSnapshot();
  }, [loadConfigSnapshot]);

  useEffect(() => {
    void loadGlobalConfig().then(setConfigSnapshot).catch(() => undefined);
  }, []);

  const localAssistance: LocalAssistanceSettings = {
    ...DEFAULT_LOCAL_ASSISTANCE_SETTINGS,
    ...(configSnapshot?.composer ?? {}),
  };

  const push = useCallback(
    (item: ReturnType<typeof entry>) => dispatch({ type: 'append', entry: item }),
    [],
  );

  /**
   * Keep project-environment persistence and runtime injection on one queue.
   * The transcript controller has a similar lazy-session queue; this second
   * seam is what prevents a set/delete racing the session load or container
   * creation while still keeping secrets outside the transcript.
   */
  const enqueueEnvironmentOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = environmentQueue.current.catch(() => undefined).then(operation);
    environmentQueue.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);

  const applySessionEnvironment = useCallback((
    values: Readonly<Record<string, string>>,
    ownerSessionId?: string | null,
  ): boolean => {
    const activeSessionId = activeEnvironmentSession.current;
    if (ownerSessionId !== undefined && activeSessionId !== null && ownerSessionId !== activeSessionId) {
      return false;
    }
    const next = { ...values };
    sessionEnvironment.current = next;

    // Runtime-only injection is intentionally available only after the Plif
    // container is running. Never mutate ContainerSpec: Engine persists that
    // object and doing so would put decrypted values on disk.
    const target = current.current;
    if (target?.state !== 'running') return true;
    try {
      const names = target.runtimeEnvironmentStatus().names;
      if (names.length > 0) target.removeEnvironment(names);
      if (Object.keys(next).length > 0) target.applyEnvironment(next);
    } catch {
      // A container may exit between the state check and the call. The secure
      // store remains authoritative and the next running container reloads it.
    }
    return true;
  }, []);

  const loadSessionEnvironment = useCallback(async (activeSession: Session | null): Promise<void> => {
    const sessionId = activeSession?.id ?? null;
    if (loadedEnvironmentSession.current === sessionId) return;
    await enqueueEnvironmentOperation(async () => {
      if (loadedEnvironmentSession.current === sessionId) return;
      const activeSessionId = activeEnvironmentSession.current;
      if (activeSessionId !== null && activeSessionId !== sessionId) return;
      let values: Readonly<Record<string, string>> = {};
      if (sessionId) {
        // A broken platform credential store must fail closed: do not retain
        // the previous session's values and do not block the main turn.
        await environmentStore.migrateLegacySession(environmentScope(sessionId), sessionId).catch(() => false);
        values = await environmentStore.loadForExecution(environmentScope(sessionId)).catch(() => ({}));
      }
      if (activeEnvironmentSession.current !== null && activeEnvironmentSession.current !== sessionId) return;
      if (!applySessionEnvironment(values, sessionId)) return;
      loadedEnvironmentSession.current = sessionId;
    });
  }, [applySessionEnvironment, enqueueEnvironmentOperation, environmentScope, environmentStore]);

  const requirePersistentEnvironmentSession = useCallback(async (): Promise<Session> => {
    const activeSession = await transcript.resolveSession();
    if (!activeSession) {
      throw new PlifError('INVALID_ARGUMENT', '/env needs a persistent session', {
        hint: 'Start a normal conversation first; session-less runs cannot own secrets.',
      });
    }
    return activeSession;
  }, [transcript]);

  const environmentActions = useMemo<EnvCommandActions>(() => {
    return {
      status: async () => {
        const activeSession = await requirePersistentEnvironmentSession();
        await loadSessionEnvironment(activeSession);
        const status = await environmentStore.status(environmentScope(activeSession.id));
        const running = current.current?.state === 'running';
        return {
          sessionId: activeSession.id,
          storage: status.persistent ? 'encrypted' : 'memory',
          ...(status.warning ? { warning: status.warning } : {}),
          variables: status.names.map((name) => ({
            name,
            loaded: running && Object.prototype.hasOwnProperty.call(sessionEnvironment.current, name),
          })),
        };
      },
      set: async (rawName, suppliedValue) => {
        const activeSession = await requirePersistentEnvironmentSession();
        const name = normalizeEnvName(rawName);
        let value = suppliedValue;
        if (value === undefined) {
          const answer = await engine.questions.ask({
            text: `Secret value for ${name}`,
            secret: true,
            context: 'This value is masked, protected for the current project, and never shown, logged, or sent to the main transcript. Use /env when a secret is needed; do not ask the agent to repeat it.',
          });
          value = answer ?? undefined;
        }
        if (!value?.trim()) return { name, saved: false };
        const secret = value;
        await loadSessionEnvironment(activeSession);
        await enqueueEnvironmentOperation(async () => {
          await environmentStore.set(environmentScope(activeSession.id), { [name]: secret });
          applySessionEnvironment({ ...sessionEnvironment.current, [name]: secret }, activeSession.id);
        });
        return { name, saved: true };
      },
      importFile: async (file) => {
        const activeSession = await requirePersistentEnvironmentSession();
        if (!isDotEnvPath(file)) {
          throw new PlifError('INVALID_ARGUMENT', 'import expects a dotenv file', {
            hint: 'Use a file named .env, .env.local, or *.env.',
          });
        }
        await loadSessionEnvironment(activeSession);
        return await enqueueEnvironmentOperation(async () => {
          const imported = await environmentStore.importFile(environmentScope(activeSession.id), file);
          const values = await environmentStore.loadForExecution(environmentScope(activeSession.id));
          applySessionEnvironment(values, activeSession.id);
          return { names: imported.names };
        });
      },
      delete: async (rawName) => {
        const activeSession = await requirePersistentEnvironmentSession();
        const name = normalizeEnvName(rawName);
        await loadSessionEnvironment(activeSession);
        return await enqueueEnvironmentOperation(async () => {
          const before = await environmentStore.status(environmentScope(activeSession.id));
          await environmentStore.remove(environmentScope(activeSession.id), [name]);
          const values = await environmentStore.loadForExecution(environmentScope(activeSession.id));
          applySessionEnvironment(values, activeSession.id);
          return before.names.includes(name);
        });
      },
      clear: async () => {
        const activeSession = await requirePersistentEnvironmentSession();
        await loadSessionEnvironment(activeSession);
        return await enqueueEnvironmentOperation(async () => {
          const before = await environmentStore.status(environmentScope(activeSession.id));
          await environmentStore.clear(environmentScope(activeSession.id));
          applySessionEnvironment({}, activeSession.id);
          return before.names.length;
        });
      },
    };
  }, [
    applySessionEnvironment,
    engine,
    enqueueEnvironmentOperation,
    environmentScope,
    environmentStore,
    loadSessionEnvironment,
    requirePersistentEnvironmentSession,
  ]);

  const hasPersistentSession = useCallback(async (): Promise<boolean> => {
    return (await transcript.resolveSession()) !== null;
  }, [transcript]);

  /** Run BTW through the bounded core side-channel, never through the main loop. */
  const runBtw = useCallback((question: string): void => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) {
      setBtwInput({ draft: '', cursor: 0 });
      return;
    }

    btwAbort.current?.abort();
    const controller = new AbortController();
    btwAbort.current = controller;
    const id = ++btwSequence.current;
    const contextSnapshot = structuredClone(
      activeConversation.current ?? conversation.current,
    );
    const displayQuestion = redactBtwSecrets(cleanQuestion);
    setBtwInput(null);
    setBtwView({ id, question: displayQuestion, phase: 'working', startedAt: Date.now() });

    void (async () => {
      try {
        const activeProvider = providerRef.current;
        if (!activeProvider) throw new Error('BTW needs a configured model');
        const result = await runEphemeralBtw({
          provider: activeProvider,
          snapshot: { messages: contextSnapshot },
          question: cleanQuestion,
          signal: controller.signal,
          execution: {
            cwd,
            workspaceRoots: [cwd],
          },
          maxTokens: 800,
        });
        if (result.status === 'cancelled') {
          setBtwView((previous) => previous?.id === id
            ? { ...previous, phase: 'cancelled', error: 'cancelled' }
            : previous);
        } else if (result.status === 'timeout') {
          setBtwView((previous) => previous?.id === id
            ? { ...previous, phase: 'error', error: 'BTW timed out; the active turn was not changed.' }
            : previous);
        } else if (result.status === 'error') {
          setBtwView((previous) => previous?.id === id
            ? { ...previous, phase: 'error', error: 'BTW could not answer; the active turn was not changed.' }
            : previous);
        } else {
          setBtwView((previous) => previous?.id === id
            ? { ...previous, phase: 'done', answer: result.text.trim() || '(no answer)' }
            : previous);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          setBtwView((previous) => previous?.id === id
            ? { ...previous, phase: 'cancelled', error: 'cancelled' }
            : previous);
          return;
        }
        const message = error instanceof Error ? error.message : 'BTW request failed';
        setBtwView((previous) => previous?.id === id
          ? { ...previous, phase: 'error', error: redactBtwSecrets(message) }
          : previous);
      } finally {
        if (btwAbort.current === controller) btwAbort.current = null;
      }
    })();
  }, [cwd]);

  const cancelBtw = useCallback((): void => {
    btwAbort.current?.abort();
    btwAbort.current = null;
    setBtwInput(null);
    setBtwView((previous) => previous?.phase === 'working'
      ? { ...previous, phase: 'cancelled', error: 'cancelled' }
      : previous);
  }, []);

  const openBtw = useCallback((): void => {
    setBtwInput({ draft: '', cursor: 0 });
  }, []);

  const openEnvironmentPicker = useCallback(async (): Promise<void> => {
    const status = await environmentActions.status();
    const storageDetail = status.storage === 'encrypted'
      ? 'encrypted at rest · not loaded into a container'
      : 'memory-only · secure persistence unavailable';
    const keyItems = status.variables.map((variable) => ({
      value: `key:${variable.name}`,
      label: variable.name,
      detail: variable.loaded
        ? 'active in container memory · value hidden'
        : storageDetail,
      state: variable.loaded ? 'on' as const : 'off' as const,
    }));
    const open = (): void => { void openEnvironmentPicker(); };
    const choose = async (value: string | ModelSelection): Promise<void> => {
      const selected = String(value);
      if (selected === 'set') {
        const answer = await engine.questions.ask({
          text: 'Environment name',
          context: 'Only the name is shown. The next prompt masks the value and stores it securely.',
        });
        const name = answer?.trim();
        if (!name) return;
        const result = await environmentActions.set(name);
        push(entry('notice', result.saved ? `env ${result.name} saved` : `env ${result.name} unchanged`, {
          tone: result.saved ? 'success' : 'muted',
          subtitle: result.saved ? 'stored through the session vault · active for future container processes' : 'no value entered',
        }));
        open();
        return;
      }
      if (selected === 'import') {
        const answer = await engine.questions.ask({
          text: 'Dotenv file path',
          context: 'The file is parsed privately; values are encrypted and never shown in the TUI or transcript.',
        });
        const file = answer?.trim();
        if (!file) return;
        const imported = await environmentActions.importFile(file);
        push(entry('notice', `imported ${imported.names.length} environment key(s)`, {
          tone: 'success',
          subtitle: 'stored through the session vault · nothing was copied to the timeline',
          detail: imported.names.join('\n') || '(no assignments found)',
          expand: true,
        }));
        open();
        return;
      }
      if (selected === 'clear') {
        const answer = await engine.questions.ask({
          text: 'Clear all project environment secrets?',
          options: [
            { value: 'clear', label: 'Clear all', description: 'Delete stored values for this project.' },
            { value: 'cancel', label: 'Cancel' },
          ],
          context: 'Values are never shown; this only removes the current project secrets.',
        });
        if (answer?.trim().toLowerCase() !== 'clear') return;
        const count = await environmentActions.clear();
        push(entry('notice', `cleared ${count} environment key(s)`, {
          tone: count > 0 ? 'success' : 'muted',
          subtitle: 'secure storage and the active container map are empty',
        }));
        open();
        return;
      }
      if (selected.startsWith('key:')) {
        const name = selected.slice(4);
        dispatch({
          type: 'picker.open',
          picker: {
            title: `Secret · ${name}`,
            hint: 'The value is never rendered. Choose an action for this project key.',
            countLabel: 'actions',
            items: [
              { value: 'update', label: 'Update value', detail: 'open a masked secret prompt' },
              { value: 'delete', label: 'Delete secret', detail: 'remove it from secure storage and future processes' },
            ],
            onBack: open,
            onPick: async (action) => {
              if (String(action) === 'update') {
                const result = await environmentActions.set(name);
                push(entry('notice', result.saved ? `env ${name} saved` : `env ${name} unchanged`, {
                  tone: result.saved ? 'success' : 'muted',
                  subtitle: result.saved ? 'stored through the session vault · active for future container processes' : 'no value entered',
                }));
              } else if (String(action) === 'delete') {
                const removed = await environmentActions.delete(name);
                push(entry('notice', removed ? `env ${name} deleted` : `env ${name} was not saved`, {
                  tone: removed ? 'success' : 'muted',
                  subtitle: removed ? 'removed from secure storage and the active container map' : 'nothing changed',
                }));
              }
              open();
            },
          },
        });
        return;
      }
    };

    dispatch({
      type: 'picker.open',
      picker: {
        title: 'Project environment',
        hint: 'Names and state only · values are encrypted and never rendered · changes apply without restart',
        countLabel: 'keys',
        items: [
          { value: 'set', label: 'Set a secret', detail: 'choose a name, then enter its masked value' },
          { value: 'import', label: 'Import dotenv', detail: 'parse a .env file privately through the project vault' },
          { value: 'clear', label: 'Clear all secrets', detail: 'remove every value from this project', state: status.variables.length > 0 ? 'on' : 'off' },
          ...keyItems,
        ],
        onPick: choose,
      },
    });
  }, [engine, environmentActions, push]);

  /**
   * Finish the answer being streamed, if there is one.
   *
   * Text stops being an answer-in-progress at two moments: the model calls a
   * tool, and the loop ends. Both close the row here so the accumulated text
   * becomes the row's title — settled, therefore committable to scrollback —
   * and so the stream buffer stops pointing at a row nothing will write to.
   */
  const closeAnswer = useCallback(() => {
    const finalFrame = semanticFrames.current?.flushAndComplete();
    const id = agentRow.current;
    if (!id) return;
    // The scheduler owns the complete output, including bytes that have not
    // reached a paint yet. Prefer its frozen completion snapshot over the last
    // React-visible frame so a fast provider cannot lose its tail.
    const text = (finalFrame?.answer ?? agentText.current).trim();
    agentRow.current = null;
    agentText.current = '';
    stream.current = { rowId: null, text: '', dirty: false };
    dispatch({
      type: 'update',
      id,
      patch: { title: text, detail: undefined, status: undefined },
    });
  }, []);

  const settlePreToolProse = useCallback((event: {
    readonly text: string;
    readonly visibility: 'transient' | 'activity';
  }) => {
    semanticFrames.current?.flushAndComplete();
    const id = agentRow.current;
    if (!id) return;
    agentRow.current = null;
    agentText.current = '';
    stream.current = { rowId: null, text: '', dirty: false };
    const compactReview = effortRef.current === 'plif'
      ? compactPlifReviewCheckpoint(event.text)
      : null;
    dispatch(preToolProseAction(
      id,
      compactReview ?? event.text,
      event.visibility,
      compactReview ? 'Review' : 'Preparing',
    ));
  }, []);

  /**
   * Settle the thinking row, if one is open.
   *
   * The row keeps the text — collapsed, expandable with Ctrl+R — rather than
   * discarding it. Reasoning is where a wrong turn is visible before the answer
   * papers over it, and throwing it away means the one time it matters it is
   * already gone.
   */
  /**
   * Settle the retry row once the endpoint answers again.
   *
   * Called from the first thing a successful attempt produces. A row left
   * saying "retrying in 15s" above an answer that arrived is worse than no row
   * at all — it makes a recovered turn look like a stuck one.
   */
  const settleRetry = useCallback((outcome: 'recovered' | 'gave up' | 'cancelled') => {
    const id = retryRow.current;
    if (!id) return;
    retryRow.current = null;
    dispatch({
      type: 'update',
      id,
      patch: {
        title:
          outcome === 'recovered'
            ? `${glyph.retry} Endpoint recovered`
            : outcome === 'cancelled'
              ? `${glyph.retry} Retry cancelled`
              : `${glyph.retry} Endpoint unavailable`,
        subtitle: undefined,
        status: outcome === 'recovered' ? 'done' : outcome === 'cancelled' ? 'done' : 'failed',
        tone: outcome === 'recovered' ? 'success' : outcome === 'cancelled' ? 'muted' : 'danger',
      },
    });
  }, []);

  const closeThinking = useCallback((durationMs?: number) => {
    semanticFrames.current?.flushAndComplete();
    const live = thinkRow.current;
    if (!live) return;
    thinkRow.current = null;
    dispatch({
      type: 'update',
      id: live.id,
      patch: {
        title: effortRef.current === 'plif' ? 'Plif Thought' : 'Thought',
        status: undefined,
        durationMs: durationMs ?? Date.now() - live.since,
        ...(live.text.trim() ? { detail: live.text.trim() } : {}),
      },
    });
  }, []);

  /**
   * Restore model context and leave a small resume marker after the durable
   * rows already seeded into Ink's normal scrollback by the reducer initializer.
   */
  useEffect(() => {
    if (replay.length === 0) return;

    conversation.current = conversationFromTranscript(contextReplay);
    const restored = estimateTokens(conversation.current);
    dispatch({ type: 'context', used: restored });
    push(
      entry('notice', `resumed ${session?.id ?? ''} — ${replay.length} stored events`, {
        tone: 'accent',
        subtitle: `${conversation.current.length} recent messages in context · ${replay.length} events visible · ~${formatCount(restored)} tokens`,
      }),
    );
  }, [contextReplay, replay, push, session]);

  // A resumed session's environment is loaded only after the transcript
  // pointer is known. The serialized loader also clears the previous session
  // map first, so a session switch cannot briefly expose another session's
  // secrets to a newly-created container.
  useEffect(() => {
    void loadSessionEnvironment(transcript.session ?? session).catch(() => undefined);
  }, [loadSessionEnvironment, session, transcript.session]);

  useEffect(() => {
    if (!transcript.persistenceWarning) return;
    push(entry('notice', transcript.persistenceWarning, { tone: 'warn' }));
  }, [push, transcript.persistenceWarning]);

  /**
   * Record a turn to the session.
   *
   * Fire-and-forget: a transcript write must never block the interface or fail
   * a command. If the disk is full the conversation still works; it just stops
   * being resumable, and that is the right thing to lose first.
   */
  // Canonical persistence is owned by useTranscriptController.

  // ---- engine → timeline -------------------------------------------------

  useEffect(() => {
    const offs = [
      engine.bus.on('approval.request', (request) => {
        dispatch({
          type: 'approval.push',
          approval: {
            id: request.id,
            containerId: request.containerId,
            action: request.action,
            target: request.target,
            argv: request.argv,
            reason: request.reason,
            rationale: request.rationale,
          },
        });

        // Log the question at the moment it is asked, then resolve this same
        // row in place. Appending the answer instead would file it after the
        // result of the action it gated, which reads backwards.
        const row = entry('approval', request.argv?.join(' ') ?? request.target, {
          status: 'blocked',
          subtitle: `awaiting approval · ${request.action}`,
        });
        approvalRows.current.set(request.id, row.id);
        dispatch({ type: 'gate', entry: row });
        setChoice(0);
      }),

      /**
       * The agent asking the developer something.
       *
       * Nothing listened for this before, and the consequence was not a missing
       * feature — it was a hang. `create_profile` asks for confirmation before
       * writing to the global config, the broker emitted this, nothing drew it,
       * and the tool sat there until the ten-minute timeout while the spinner
       * claimed to be working. Six minutes of "creating a profile" was six
       * minutes of the agent waiting for an answer nobody had been shown.
       */
      engine.bus.on('question.asked', (event) => {
        dispatch({
          type: 'question.push',
          question: {
            id: event.id,
            text: event.text,
            options: event.options,
            context: event.context,
            askedAt: Date.now(),
            ...(event.secret ? { secret: true } : {}),
          },
        });

        // The row is the record; the dialog is the detail. Putting the context
        // on both prints the whole proposal twice on one screen, and the copy
        // in the timeline is the one nobody can act on.
        const row = entry('question', event.text, {
          status: 'blocked',
          subtitle: 'waiting on you',
        });
        questionRows.current.set(event.id, row.id);
        dispatch({ type: 'gate', entry: row });
      }),

      /**
       * Resolve the row in place, however the question ended.
       *
       * Also fires on timeout and on `abandonAll`, which is the point: a
       * question that expired has to stop looking pending, or the log says the
       * agent is still waiting long after it gave up and moved on.
       */
      engine.bus.on('question.answered', (event) => {
        const rowId = questionRows.current.get(event.id);
        if (rowId) {
          questionRows.current.delete(event.id);
          // A redacted answer is a real answer whose value must not reach the
          // row — the timeline is scrollback, and scrollback is forever.
          const answered = event.redacted || event.answer !== null;
          dispatch({
            type: 'update',
            id: rowId,
            patch: {
              status: answered ? 'done' : 'failed',
              tone: answered ? 'success' : 'warn',
              subtitle: event.redacted
                ? 'received; the credential value is omitted from the transcript'
                : answered
                  ? 'answered'
                  : 'no answer — the agent picked a default',
              ...(event.answer !== null ? { tag: `[${truncateAnswer(event.answer)}]` } : {}),
            },
          });
        }
        dispatch({ type: 'question.resolve' });
      }),

      /**
       * Thinking, bracketed.
       *
       * The row opens here rather than on the first delta so that a model whose
       * thinking is slow to start still shows something immediately — and it
       * closes on the `end` phase, which is the only signal that distinguishes
       * "still thinking" from "thought, and is now doing something else".
       */
      engine.bus.on('agent.thinking', (event) => {
        const currentLoading = isCurrentLoadingTurn(event.turnId);
        if (event.phase === 'start') {
          if (currentLoading) updateLoadingPhase(event.turnId, 'reasoning');
          // Prose written before a thought is a finished thought of its own.
          closeAnswer();
          const row = entry('thinking', effortRef.current === 'plif' ? 'Plif Thinking' : 'Thinking', { status: 'active' });
          thinkRow.current = { id: row.id, text: '', since: Date.now(), dirty: false };
          push(row);
          return;
        }
        const active = loadingOperationRef.current;
        // The UI owns a monotonic start timestamp. Do not replace it with the
        // loop's wall-clock duration, which can jump when the system clock is
        // adjusted during a long request.
        if (currentLoading && active) activityModel.reasoningEnd(active.id);
        const metrics = turnMetricsRef.current;
        if (metrics?.turnId === event.turnId && event.durationMs) {
          metrics.reasoningMs += event.durationMs;
        }
        closeThinking(event.durationMs);
      }),

      // Deliberately not reported per cycle. A twenty-step task used to end up
      // with twenty "Worked for" rules through it, which turned one piece of
      // work into a stack of receipts. The total is reported once, when there
      // is genuinely nothing left running — see the run-summary effect below.
      engine.bus.on('agent.cycle', () => undefined),

      engine.bus.on('agent.reasoning', (event) => {
        if (isCurrentLoadingTurn(event.turnId)) updateLoadingPhase(event.turnId, 'reasoning');
        settleRetry('recovered');
        let live = thinkRow.current;
        if (!live) {
          // Some compatible providers emit the side-channel before the loop's
          // bracket event. Open the cell at the semantic boundary so reasoning
          // is never silently discarded just because event order was eager.
          closeAnswer();
          const row = entry(
            'thinking',
            effortRef.current === 'plif' ? 'Plif Thinking' : 'Thinking',
            { status: 'active' },
          );
          live = { id: row.id, text: '', since: Date.now(), dirty: false };
          thinkRow.current = live;
          push(row);
        }
        if (semanticStartedAt.current === null) semanticStartedAt.current = Date.now();
        semanticFrames.current?.appendBatch([
          { lane: 'reasoning', delta: event.delta },
          { lane: 'completion', delta: event.delta },
        ]);
      }),

      engine.bus.on('agent.reasoning_budget', (event) => {
        if (!isCurrentLoadingTurn(event.turnId)) return;
        push(entry('notice', '! 8min de reasoning neste turno — effort alto custa ~1min por ciclo. Baixe o effort (medium) para ~5x mais rápido.', {
          tone: 'warn',
          tag: formatDuration(event.totalMs),
        }));
      }),

      /**
       * The endpoint failed; another attempt is queued.
       *
       * One row, updated in place across the retry budget rather than one row per attempt.
       * The countdown is the point: a developer who can see "next attempt in
       * 15s (3/10)" waits, and one who sees an unchanging spinner kills it.
       */
      engine.bus.on('agent.retry', (event) => {
        if (isCurrentLoadingTurn(event.turnId)) updateLoadingPhase(event.turnId, 'waiting');
        const seconds = Math.round(event.waitMs / 1000);
        const patch = {
          title: `${glyph.retry} Retry in ${seconds}s`,
          subtitle: `attempt ${event.attempt + 1} of ${event.of}`,
          tone: 'warn' as const,
          status: 'active' as const,
          detail: event.reason,
        };
        if (retryRow.current) dispatch({ type: 'update', id: retryRow.current, patch });
        else {
          const row = entry('notice', patch.title, patch);
          retryRow.current = row.id;
          push(row);
        }
      }),

      engine.bus.on('agent.reset', (event) => {
        if (isCurrentLoadingTurn(event.turnId)) updateLoadingPhase(event.turnId, 'waiting');
        // The attempt that wrote these is being abandoned. Dropping the rows is
        // the only honest option: leaving half an answer above the retry would
        // read as text the model actually produced and stood by.
        const answer = agentRow.current;
        const think = thinkRow.current;
        semanticFrames.current?.discardAndReset();
        agentRow.current = null;
        agentText.current = '';
        thinkRow.current = null;
        stream.current = { rowId: null, text: '', dirty: false };
        completionMeterRef.current = discardCompletionEstimate(completionMeterRef.current);
        const active = loadingOperationRef.current;
        if (active) activityModel.tokens(active.id, completionMeterRef.current.tokens, completionMeterRef.current.estimated);
        if (answer) dispatch({ type: 'drop', id: answer });
        if (think) dispatch({ type: 'drop', id: think.id });
      }),

      engine.bus.on('agent.compacting', (event) => {
        dispatch({
          type: 'compaction.stage',
          stage: {
            stage: event.stage,
            step: event.step,
            steps: event.steps,
            before: event.before,
            target: event.target,
            // Held across stages so the counter measures the whole pass, not
            // the stage — the developer is waiting for the pass.
            since: compactionSince.current ?? (compactionSince.current = Date.now()),
          },
        });
      }),

      engine.bus.on('agent.compacted', (event) => {
        const metrics = turnMetricsRef.current;
        if (metrics && compactionSince.current !== null) {
          metrics.compactionMs += Math.max(0, Date.now() - compactionSince.current);
        }
        compactionSince.current = null;
        dispatch({ type: 'compaction.end' });
        if (event.failure) {
          const preserved = event.failure.fallback === 'raw history preserved';
          push(entry('notice', preserved
            ? 'compaction capsule rejected; raw history preserved'
            : 'compaction model failed; mechanical fallback applied', {
            tone: 'warn',
            subtitle: `${event.failure.message} (${event.failure.attempts} attempts; provider ${glyph.failed} unavailable for this turn)`,
          }));
        }
        // Only worth a row when it actually did something. A pass that ran the
        // first stage and found nothing to drop is not news.
        if (event.before === event.after) return;
        push(
          entry('notice', `compacted ${formatCount(event.before)} → ${formatCount(event.after)} tokens`, {
            tone: 'accent',
            subtitle: event.stages.join(', '),
            ...(event.summarised ? { tag: '[summarised]' } : {}),
          }),
        );
      }),

      /**
       * The context gauge in the header.
       *
       * `promptTokens` is the conversation as the endpoint counted it, which is
       * exactly what the gauge means: how full the window is right now. It is
       * not accumulated — each turn replaces the reading, and a compaction
       * makes the next one drop, which is the behaviour you want to see.
       */
      engine.bus.on('agent.usage', (event) => {
        const written = Math.max(0, event.completionTokens - turnCompletionTokens.current);
        turnCompletionTokens.current = Math.max(turnCompletionTokens.current, event.completionTokens);
        usage.current = {
          ...usage.current,
          requests: usage.current.requests + 1,
          inputTokens: usage.current.inputTokens + Math.max(0, event.promptTokens),
          outputTokens: usage.current.outputTokens + written,
        };
        dispatch({
          type: 'context',
          used: event.promptTokens,
          ...(event.budget > 0 ? { max: event.budget } : {}),
        });
        completionMeterRef.current = reconcileCompletionUsage(
          completionMeterRef.current,
          event.completionTokens,
        );
        const active = loadingOperationRef.current;
        if (active?.turnId === event.turnId) {
          loadingMetricPaintAt.current = monotonicNow();
          activityModel.tokens(active.id, completionMeterRef.current.tokens, completionMeterRef.current.estimated);
        }
      }),

      /**
       * The answer, as it is written.
       *
       * The row is opened by the first delta rather than by the turn starting,
       * because a turn that goes straight to a tool call produces no prose and
       * would otherwise leave an empty row above it. Everything after that is
       * the same drain-on-a-timer path command output uses.
       *
       * Waiting for the loop to finish and pushing `result.text` was the old
       * behaviour, and it threw away the entire point of a streaming API: the
       * developer watched a spinner for thirty seconds and then got a wall of
       * text that had been ready, a sentence at a time, the whole while.
       */
      engine.bus.on('agent.text', (event) => {
        if (isCurrentLoadingTurn(event.turnId)) updateLoadingPhase(event.turnId, 'streaming');
        // The endpoint is answering, so whatever it was retrying worked.
        settleRetry('recovered');
        if (!agentRow.current) {
          const row = entry('answer', '', { status: 'active' });
          agentRow.current = row.id;
          agentText.current = '';
          push(row);
        }
        if (semanticStartedAt.current === null) semanticStartedAt.current = Date.now();
        semanticFrames.current?.appendBatch([
          { lane: 'answer', delta: event.delta },
          { lane: 'completion', delta: event.delta },
        ]);
      }),

      engine.bus.on('agent.pre_tool_prose', (event) => {
        if (isCurrentLoadingTurn(event.turnId)) updateLoadingPhase(event.turnId, 'streaming');
        settlePreToolProse(event);
      }),

      /**
       * One row per tool call, opened when it starts and closed when it ends.
       *
       * Opening early is what makes a shell command readable *while* it runs:
       * `exec.output` needs a row to stream into, and binding `pendingRow` here
       * is the same mechanism the typed `!` path uses. Waiting for the end
       * meant a long build showed nothing at all until it was over, and then
       * showed only a duration — the output existed but had nowhere to go.
       */
      engine.bus.on('agent.tool', (event) => {
        if (event.phase === 'start') settleRetry('recovered');
        if (isCurrentLoadingTurn(event.turnId)) {
          updateLoadingPhase(event.turnId, event.phase === 'start' ? 'tool' : 'waiting');
          const active = loadingOperationRef.current;
          if (active) {
            if (event.phase === 'start') activityModel.toolStart(active.id, event.id, event.name);
            else activityModel.toolEnd(active.id, event.id, event.ok !== false);
          }
        }
        const described = describeToolCall(event.name, event.input);
        const lane = toolLane(event.name);
        const discoveryKind = event.name === 'read_file' ? 'Read' : event.name === 'list_dir' ? 'List' : null;
        const hiddenSubagent = lane === 'subagent';
        if (event.phase === 'start') {
          const delegationIntro = hiddenSubagent ? agentRow.current : null;
          // Prose written before a tool call is a finished thought, not the
          // first half of the answer that comes after it.
          closeAnswer();
          // Belt and braces. The loop closes the block when the stream ends,
          // which is before any tool runs — but a row left spinning would never
          // settle, and therefore never reach scrollback.
          closeThinking();
          // The child owns its own dock. Keeping both an announcement and a
          // parent tool row would say the same thing in three places.
          if (delegationIntro) dispatch({ type: 'drop', id: delegationIntro });
          if (discoveryKind) {
            dispatch({
              type: 'discovery.start',
              id: event.id,
              kind: discoveryKind,
              ...(described.target ? { target: described.target } : {}),
            });
            return;
          }
          if (hiddenSubagent) return;
          const row = entry('tool', described.label, {
            status: 'active',
            toolCategory: described.category,
            ...(described.target !== undefined ? { toolTarget: described.target } : {}),
            ...(described.summary ? { toolSummary: described.summary } : {}),
            ...(described.planItems ? { planItems: described.planItems } : {}),
          });
          toolRows.current.set(event.id, row.id);
          // Only a lone call can own the exec stream. `run_command` is never
          // batched, so whenever there is output to stream there is exactly one
          // candidate row — but binding unconditionally would hand the stream
          // to whichever read happened to start last.
          pendingRow.current = toolRows.current.size === 1 ? row.id : null;
          push(row);
          return;
        }

        usage.current = { ...usage.current, toolCalls: usage.current.toolCalls + 1 };
        const metrics = turnMetricsRef.current;
        if (metrics?.turnId === event.turnId && event.durationMs) {
          metrics.toolsMs += event.durationMs;
        }

        if (discoveryKind) {
          dispatch({
            type: 'discovery.finish',
            id: event.id,
            ok: event.ok !== false,
            output: event.output ?? '',
          });
          return;
        }
        if (hiddenSubagent) {
          return;
        }

        const id = toolRows.current.get(event.id) ?? null;
        toolRows.current.delete(event.id);
        if (toolRows.current.size === 0) {
          pendingRow.current = null;
          // Stop the drain timer overwriting the authoritative output below
          // with whatever the stream happened to have buffered.
          stream.current = { rowId: null, text: '', dirty: false };
        }

        const hits = (event.name === 'web_search' || event.name === 'research') && event.ok && event.output
          ? parseSearchResults(event.output)
          : [];
        const diagnostics = event.diff && event.output
          ? languageServerNote(event.output)
          : null;

        const patch = {
          status: (event.ok ? 'done' : 'failed') as 'done' | 'failed',
          ...(hits.length > 0 ? { searchResults: hits } : {}),
          // An edit describes itself with its own diff stats — "Added 9 lines,
          // removed 1 line" — rather than a byte count, because that is the
          // number a reviewer is actually looking for.
          toolSummary: event.diff
            ? (() => {
                const stats = diffStats(parseDiff(event.diff));
                return `(+${stats.added} -${stats.removed})`;
              })()
            : described.summary,
          ...(event.diff ? { diff: event.diff } : {}),
          ...(diagnostics
            ? { detail: diagnostics }
            : !event.diff && event.output?.trim()
              ? { detail: event.output }
              : {}),
          ...(described.planItems ? { planItems: described.planItems } : {}),
        };

        if (id) dispatch({ type: 'update', id, patch });
        else {
          push(
            entry('tool', described.label, {
              ...patch,
              toolCategory: described.category,
              ...(described.target !== undefined ? { toolTarget: described.target } : {}),
            }),
          );
        }
      }),

      /**
       * A delegated investigation ticking along.
       *
       * Updates the `subagent` call's own row rather than opening one of its
       * own — a second row for the same call was two rows for one thing. The
       * subagent's reads never reach this bus at all; only the count does.
       */
      engine.bus.on('subagent.progress', (event) => {
        const id = toolRows.current.get(event.callId);
        if (!id) return;
        dispatch({
          type: 'update',
          id,
          patch: {
            toolSummary:
              `${event.toolCalls} tool call${event.toolCalls === 1 ? '' : 's'}` +
              ` · ${event.lastTool}`,
          },
        });
      }),

      /**
       * A delegated agent opening its own tab.
       *
       * These used to be filed as background tasks, which was the wrong shape:
       * a task is a process with an exit code, and a subagent is a *session* —
       * it thinks, it uses tools, it reaches a conclusion. The task panel could
       * show none of that, so it showed a spinner and a name.
       */
      engine.bus.on('subagent.started', (event) => {
        usage.current = { ...usage.current, subagentRuns: usage.current.subagentRuns + 1 };
        dispatch({
          type: 'subagent.start',
          view: {
            taskId: event.taskId,
            title: event.title,
            model: event.model,
            startedAt: event.at,
            endedAt: null,
            status: 'running',
            summary: null,
            lines: [],
            thinkingSince: null,
            toolCalls: 0,
            contextUsed: 0,
            contextMax: event.contextMax,
            completionTokens: 0,
            ...(event.subagentId ? { subagentId: event.subagentId } : {}),
            ...(event.sessionId ? { sessionId: event.sessionId } : {}),
            ...(event.forkedFrom ? { forkedFrom: event.forkedFrom } : {}),
          },
        });
      }),

      engine.bus.on('subagent.activity', (event) => {
        const thinking =
          event.kind === 'thinking' ? (event.label as 'start' | 'end') : undefined;
        dispatch({
          type: 'subagent.activity',
          taskId: event.taskId,
          line: {
            kind: event.kind,
            label: event.kind === 'thinking' ? 'thought' : event.label,
            ...(event.ok !== undefined ? { ok: event.ok } : {}),
            ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          },
          ...(thinking ? { thinking } : {}),
        });
      }),

      engine.bus.on('subagent.usage', (event) => {
        subagentTokens.current.set(
          event.taskId,
          Math.max(subagentTokens.current.get(event.taskId) ?? 0, event.completionTokens),
        );
        usage.current = {
          ...usage.current,
          subagentTokens: [...subagentTokens.current.values()].reduce((total, value) => total + value, 0),
        };
        dispatch({ type: 'subagent.usage', ...event });
      }),

      engine.bus.on('subagent.finished', (event) => {
        dispatch({
          type: 'subagent.finish',
          taskId: event.taskId,
          status: event.status,
          at: event.at,
          summary: event.summary,
        });
      }),

      engine.bus.on('exec.start', () => {
        // Bind the row created just before the call to the exec now running.
        stream.current = { rowId: pendingRow.current, text: '', dirty: false };
        pendingRow.current = null;
      }),

      engine.bus.on('exec.output', (event) => {
        if (!stream.current.rowId) return;
        stream.current.text += event.chunk;
        stream.current.dirty = true;
        scheduleStreamFlush();
      }),

      engine.bus.on('container.state', (event) => {
        if (current.current?.id === event.containerId) {
          dispatch({ type: 'container', name: event.name, state: event.to });
        }
      }),

      engine.bus.on('limit.exceeded', (event) => {
        push(
          entry('notice', `limit exceeded: ${event.limit}`, {
            tone: 'warn',
            subtitle: `${event.actual} over a ceiling of ${event.ceiling}`,
          }),
        );
      }),

      engine.bus.on('log', (event) => {
        if (event.level === 'debug') return;
        // A log that already says why in prose says it in prose. Only a detail
        // with no `reason` of its own falls back to a JSON dump, which is what
        // used to put an entire HTML error page on screen.
        const fields = (event.detail ?? {}) as Record<string, unknown>;
        const reason = typeof fields['reason'] === 'string' ? fields['reason'] : null;
        const hint = typeof fields['hint'] === 'string' ? fields['hint'] : null;
        const detail = reason
          ? [reason, hint].filter(Boolean).join('\n')
          : event.detail
            ? JSON.stringify(event.detail, null, 2)
            : null;
        push(
          entry('notice', event.message, {
            tone: event.level === 'error' ? 'danger' : event.level === 'warn' ? 'warn' : 'muted',
            ...(detail ? { detail } : {}),
          }),
        );
      }),
      engine.bus.on('auth.required', (event) => {
        const notice = authNotice(event);
        push(entry('notice', notice.title, {
          subtitle: notice.subtitle,
          ...(notice.detail ? { detail: notice.detail, expand: true } : {}),
          tone: notice.tone === 'success' ? 'accent' : notice.tone,
          status: notice.status === 'active' ? 'blocked' : notice.status,
        }));
      }),
      engine.bus.on('mcp.status', (event) => {
        setMcpStatuses((current) => {
          const next = { ...event, name: event.server };
          const found = current.findIndex((item) => item.name === event.server);
          return found < 0 ? [...current, next] : current.map((item, index) => index === found ? next : item);
        });
      }),
      engine.bus.on('task.created', () => {
        refreshTasks();
        setTasksOpen(true);
      }),
      engine.bus.on('task.started', () => {
        refreshTasks();
        setTasksOpen(true);
      }),
      engine.bus.on('task.output', scheduleTaskOutputRefresh),
      engine.bus.on('task.finished', flushTaskOutputRefresh),
      engine.bus.on('task.blocked', flushTaskOutputRefresh),
    ];
    return () => offs.forEach((off) => off());
  }, [
    engine,
    push,
    closeAnswer,
    closeThinking,
    settleRetry,
    settlePreToolProse,
    isCurrentLoadingTurn,
    updateLoadingPhase,
    flushTaskOutputRefresh,
    refreshTasks,
    scheduleTaskOutputRefresh,
  ]);

  // First launch asks once, through the normal QuestionBroker, so the choice
  // appears in the same Ink input instead of spawning a native dialog or
  // stopping the session. This effect intentionally lives after the engine
  // event subscription above: QuestionBroker emits question.asked
  // synchronously, so registering it earlier would lose the first-run prompt
  // and leave the normal composer blocked forever.
  useEffect(() => {
    if (!projectRootSetup || projectRootSetupStarted.current) return;
    projectRootSetupStarted.current = true;
    void (async () => {
      try {
        const selected = await engine.questions.ask({
          text: 'Choose the default local projects folder for PLIF.',
          context: 'This is saved in ~/.plif/config.toml and used only when PLIF starts outside an existing project. Use --workspace/-C to override it for a run.',
          options: projectRootChoices(cwd),
        });
        if (!selected) {
          push(entry('notice', 'project folder setup cancelled', {
            tone: 'muted',
            subtitle: 'Launch PLIF again to choose it, or use -C/--workspace for this run.',
          }));
          return;
        }
        const typed = selected === '__custom__'
          ? await engine.questions.ask({
              text: 'Type the full path for your local projects folder.',
              context: 'PLIF creates the folder if it does not exist and keeps using it as the default project root.',
            })
          : selected;
        if (!typed?.trim()) {
          push(entry('notice', 'project folder setup cancelled', { tone: 'muted' }));
          return;
        }
        const projectRoot = await ensureProjectRoot(typed);
        const config = await loadGlobalConfig();
        await saveGlobalConfig(
          { ...config, projectRoot },
          globalConfigPath(),
          { preserveProviderKeys: false },
        );
        push(entry('notice', 'project folder saved', {
          tone: 'success',
          subtitle: projectRoot,
        }));
      } catch (error) {
        const { title, detail } = formatError(error);
        push(entry('notice', 'could not save project folder', {
          tone: 'danger',
          detail: detail ? `${title}: ${detail}` : title,
        }));
      } finally {
        setProjectRootSetupPending(false);
      }
    })();
  }, [cwd, engine, projectRootSetup, push]);

  /**
   * The MCP configuration with its credentials filled in.
   *
   * Parsing reports which variables it wanted and did not get; the broker finds
   * them in the environment, in the encrypted store, or by asking. Only then is
   * the configuration parsed again, so a header whose key was missing is built
   * with the real value rather than dropped.
   */
  const resolveMcpConfigs = useCallback(async (): Promise<Record<string, McpServerConfig>> => {
    const stored = await loadStoredConfig(engine.paths);
    const raw = mcpServersOf(stored as GlobalConfig);
    return credentials ? resolveServerConfigs(raw, credentials) : parseServerConfigs(raw);
  }, [credentials, engine]);

  const loginMcp = useCallback(
    async (server: string): Promise<TimelineEntry> => {
      if (!mcpRegistry) {
        return entry('notice', 'no MCP registry in this session', { tone: 'warn', status: 'failed' });
      }
      try {
        const { status, authenticated, unsetVariables } = await mcpRegistry.login(server);
        setMcpStatuses(mcpRegistry.statuses());

        if (!status.connected) {
          return entry('notice', `${status.name} did not connect`, {
            tone: 'warn',
            status: 'failed',
            subtitle: status.detail,
          });
        }
        if (authenticated) {
          return entry('notice', `${status.name} authenticated`, {
            tone: 'accent',
            subtitle: status.detail,
          });
        }
        return entry('notice', `${status.name} connected without authenticating`, {
          tone: 'warn',
          subtitle: unsetVariables.length
            ? `${unsetVariables.join(' and ')} not set, so no credential was sent`
            : 'the server served this session anonymously and never asked for a login',
          expand: true,
          detail: unsetVariables.length
            ? [
                `${status.detail} — but as an anonymous caller.`,
                '',
                `Set ${unsetVariables.join(' and ')} in your environment and run this again.`,
              ].join('\n')
            : `${status.detail} — but as an anonymous caller. Nothing here uses OAuth.`,
        });
      } catch (error) {
        setMcpStatuses(mcpRegistry.statuses());
        const { title, detail } = formatError(error);
        return entry('notice', title, {
          tone: 'danger',
          status: 'failed',
          ...(detail ? { detail, expand: true } : {}),
        });
      }
    },
    [mcpRegistry],
  );

  const cancelCodexLogin = useCallback(async (): Promise<void> => {
    const flow = codexLoginFlow.current;
    if (!flow) {
      setCodexLogin(null);
      return;
    }
    await flow.cancel();
  }, []);

  const loginCodex = useCallback(async (): Promise<boolean> => {
    if (codexLoginFlow.current) return false;
    setCodexLogin({ status: 'starting' });
    try {
      const flow = await startCodexLogin();
      codexLoginFlow.current = flow;
      if (flow.alreadyAuthenticated) {
        setCodexLogin(null);
        return true;
      }

      setCodexLogin({
        status: 'waiting',
        ...(flow.userCode ? { userCode: flow.userCode } : {}),
      });
      const loginUrl = flow.authUrl ?? flow.verificationUrl;
      if (!loginUrl) throw new Error('the Codex sign-in URL was empty');
      try {
        await openOAuthBrowser(new URL(loginUrl));
      } catch (error) {
        await flow.cancel();
        const { title } = formatError(error);
        setCodexLogin({ status: 'error', detail: `Could not open ChatGPT sign-in: ${title}` });
        return false;
      }

      const result = await flow.wait();
      if (result.ok) {
        setCodexLogin(null);
        return true;
      }
      if (result.cancelled) {
        setCodexLogin(null);
        return false;
      }
      setCodexLogin({
        status: 'error',
        detail: result.detail ?? 'ChatGPT sign-in was not completed',
      });
      return false;
    } catch (error) {
      const { title, detail } = formatError(error);
      setCodexLogin({
        status: 'error',
        detail: [title, detail].filter(Boolean).join(' · '),
      });
      return false;
    } finally {
      codexLoginFlow.current = null;
    }
  }, []);

  const runMcpBrowserAction = useCallback(
    async (action: 'connect' | 'disconnect' | 'authenticate' | 'test', server: string): Promise<void> => {
      if (!mcpRegistry) {
        push(entry('notice', 'no MCP registry in this session', { tone: 'warn', status: 'failed' }));
        return;
      }

      if (action === 'authenticate') {
        push(await loginMcp(server));
        setMcpStatuses(mcpRegistry.statuses());
        return;
      }

      try {
        const status = action === 'connect'
          ? await mcpRegistry.connectServer(server)
          : action === 'disconnect'
            ? await mcpRegistry.disconnect(server)
            : await mcpRegistry.testConnection(server);
        setMcpStatuses(mcpRegistry.statuses());
        const healthy = action === 'test' ? status.connected : action === 'connect' ? status.connected : true;
        push(entry(
          'notice',
          action === 'test'
            ? `${status.name} connection ${healthy ? 'healthy' : 'failed'}`
            : `${status.name} ${action === 'disconnect' ? 'disconnected' : 'connected'}`,
          {
            tone: healthy ? 'accent' : 'warn',
            status: healthy ? 'done' : 'failed',
            subtitle: status.detail,
          },
        ));
      } catch (error) {
        setMcpStatuses(mcpRegistry.statuses());
        const { title, detail } = formatError(error);
        push(entry('notice', `${server} ${action} failed`, {
          tone: 'danger',
          status: 'failed',
          subtitle: title,
          ...(detail ? { detail, expand: true } : {}),
        }));
      }
    },
    [loginMcp, mcpRegistry, push],
  );

  const reconnectMcp = useCallback(
    async (added: readonly string[]): Promise<void> => {
      if (!mcpRegistry) return;
      push(entry('notice', `connecting ${added.join(', ')}`, { tone: 'accent' }));
      try {
        await mcpRegistry.start(await resolveMcpConfigs());
        setMcpStatuses(mcpRegistry.statuses());
        for (const status of mcpRegistry.statuses()) {
          if (!added.includes(status.name)) continue;
          push(
            entry('notice', `${status.name} ${status.connected ? 'connected' : 'unavailable'}`, {
              tone: status.connected ? 'accent' : 'warn',
              ...(status.connected ? {} : { status: 'failed' as const }),
              subtitle: status.detail,
            }),
          );
        }
      } catch (error) {
        const { title, detail } = formatError(error);
        push(entry('notice', title, { tone: 'danger', status: 'failed', ...(detail ? { detail } : {}) }));
      }
    },
    [mcpRegistry, push, resolveMcpConfigs],
  );

  /**
   * Ask the registry whether there is a newer plif.
   *
   * Started here and never awaited by anything that draws. A version check that
   * can delay the first frame is a hang waiting for a bad network, and the
   * answer is worth nothing if it costs the developer a second of staring at a
   * blank terminal. It resolves to null for every uninteresting reason.
   */
  useEffect(() => {
    let active = true;
    const check = async (): Promise<void> => {
      if (!active || updatePromptPending.current) return;
      const update = await checkForUpdate({ current: version, cacheFile: engine.paths.updateCheck });
      if (!active || !update) return;
      const preferences = await readUpdatePreferences(engine.paths.updatePreferences);
      if (!preferences.enabled || preferences.disabledVersions.includes(update.latest)) return;
      updatePromptPending.current = true;
      try {
        const changelog = update.changelog
          ? update.changelog.slice(0, 8_000)
          : 'The published package did not include a readable CHANGELOG.md section.';
        const choice = await engine.questions.ask({
          text: `Plif ${update.latest} is available`,
          context: [
            `You are running ${update.current}. Updates come from NPM only.`,
            '',
            'CHANGELOG.md',
            changelog,
          ].join('\n'),
          options: [
            { value: 'update', label: 'Update now', description: 'Close safely, install the exact NPM version, verify it, and relaunch.' },
            { value: 'later', label: 'Later', description: 'Keep this version and ask again on a later check.' },
            { value: 'ignore', label: "Don't ask again", description: `Silence notifications for ${update.latest} only.` },
          ],
        });
        if (choice === 'ignore') {
          await disableVersion(engine.paths.updatePreferences, update.latest);
          return;
        }
        if (choice !== 'update') return;
        if (!launchUpdater(update)) {
          push(entry('notice', 'updater is unavailable in this installation', {
            tone: 'warn',
            subtitle: `Install manually with ${update.command}.`,
          }));
          return;
        }
        push(entry('notice', `updating Plif to ${update.latest}`, {
          tone: 'accent',
          subtitle: 'The isolated updater will restart Plif after verification.',
        }));
        exit();
      } finally {
        updatePromptPending.current = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 6 * 60 * 60 * 1000);
    timer.unref?.();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [engine, exit, push, version]);

  useEffect(() => {
    if (!mcpRegistry) return;
    let active = true;
    void resolveMcpConfigs()
      .then((configs) => mcpRegistry.start(configs))
      .then(() => {
        if (active) setMcpStatuses(mcpRegistry.statuses());
      })
      .catch((error: unknown) => {
        if (!active) return;
        const { title, detail } = formatError(error);
        push(entry('notice', title, { tone: 'danger', status: 'failed', ...(detail ? { detail } : {}) }));
      });
    return () => {
      active = false;
    };
  }, [mcpRegistry, push, resolveMcpConfigs]);

  /**
   * Tick the elapsed counters, and only while something is counting.
   *
   * An interval that runs when the screen is idle is a full frame repaint every
   * second for nothing — and on a terminal at the height budget, that is the
   * repaint path this whole layout exists to stay off.
   */
  const counting =
    agentTurnStartedAt !== null ||
    tasks.length > 0 ||
    state.question !== null ||
    state.compaction !== null ||
    state.subagents.some((view) => view.status === 'running') ||
    btwView?.phase === 'working';

  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [counting]);

  useEffect(() => () => {
    semanticFrames.current?.flushAndDispose();
    void taskManager.current?.stopAll();
    void lspManager.current?.stop();
  }, []);

  useEffect(() => {
    writeTerminalTitle(state.busy ? titleForWorking('') : completedTitle());
  }, [state.busy]);

  useEffect(() => {
    if (tasks.length === 0) setTasksOpen(false);
  }, [tasks.length]);

  useEffect(() => {
    // Mouse tracking also captures wheel reports (button 64/65). Keeping it
    // enabled for the whole session made the parser discard the wheel bytes
    // before the terminal could scroll. Only paste tokens and live questions
    // need reports, so ordinary sessions leave the wheel entirely native.
    if (!stdout.isTTY || !mouseTrackingActive) return;
    stdout.write(
      `\u001B[?1000l\u001B[?1002l\u001B[?1003l${questionMouseTracking ? '\u001B[?1003h' : '\u001B[?1000h'}\u001B[?1006h`,
    );
    return () => {
      stdout.write('\u001B[?1000l\u001B[?1002l\u001B[?1003l\u001B[?1006l');
    };
  }, [mouseTrackingActive, questionMouseTracking, stdout]);

  // Mirror the queue into a ref so the running turn's drain callback sees the
  // current list rather than the one that existed when it started.
  useEffect(() => {
    queueRef.current = state.queue;
  }, [state.queue]);

/**
   * Turn whichever tab is open into rows the list can draw.
   *
   * Done here rather than in the component so the reducer owns the selection
   * index and the renderer stays a pure function of state — a list that
   * computed its own rows would have to re-derive them to know what the
   * selection points at, and the two copies would drift.
   */
  const browserRows = useCallback(
    (browser: BrowserState): BrowserRow[] => {
      const needle = browser.filter.trim().toLowerCase();

      if (browser.tab === 'mcp') {
        return sortMcpStatuses(mcpStatuses)
          .filter((server) => !needle || server.name.toLowerCase().includes(needle))
          .map((server) => {
            const kind = mcpStatusKind(server);
            return {
              id: server.name,
              title: `${server.name}  ${server.connected ? `${server.toolCount} tools` : kind}`,
              mark: kind === 'connected' ? glyph.done : kind === 'error' ? glyph.failed : glyph.pending,
              tone: kind === 'connected'
                ? ('success' as const)
                : kind === 'error' ? ('danger' as const) : ('muted' as const),
            };
          });
      }

      if (browser.tab === 'skills') {
        return skillList
          .filter(
            (skill) =>
              !needle ||
              skill.name.toLowerCase().includes(needle) ||
              skill.description.toLowerCase().includes(needle),
          )
          .map((skill) => ({
            id: skill.name,
            title: `${skill.name}  ${skill.scope}`,
            mark: glyph.step,
            tone: 'accent' as const,
          }));
      }

      if (browser.tab === 'sessions') {
        const currentId = transcript.session?.id;
        return browser.sessions
          .filter((session) => {
            const haystack = `${session.id} ${session.title} ${session.workspace}`.toLowerCase();
            return !needle || haystack.includes(needle);
          })
          .map((session) => ({
            id: session.id,
            title: `${session.title || '(no title)'}  ${sessionAge(session.updatedAt)}`,
            mark: session.id === currentId ? glyph.done : glyph.step,
            tone: session.id === currentId ? ('accent' as const) : ('muted' as const),
          }));
      }

      const plugins = browser.catalog
        ? searchPlugins(browser.catalog.plugins, browser.filter, 400)
        : [];
      return plugins.map((plugin) => ({
        id: plugin.name,
        title: plugin.displayName ?? plugin.name,
        // Official entries are marked, community ones are not. Which list a
        // plugin came from is the single most useful thing to know at a glance,
        // and it is the one thing the catalogue always states.
        mark: plugin.origin === 'official' ? glyph.done : glyph.pending,
        tone: plugin.origin === 'official' ? ('success' as const) : ('ghost' as const),
      }));
    },
    [mcpStatuses, skillList, transcript.session?.id],
  );

  /**
   * Rows are a pure projection of factual MCP/skill/catalog state. Keeping
   * them out of the session reducer removes the old effect-driven
   * `browser.rows` dispatch and its guaranteed second reconciliation after
   * every filter, tab, or status change.
   */
  const browserRowsForView = useMemo(
    () => state.browser ? browserRows(state.browser) : [],
    [browserRows, state.browser],
  );
  const browserView = useMemo(
    () => state.browser
      ? {
          ...state.browser,
          rows: browserRowsForView,
          selected: Math.min(state.browser.selected, Math.max(0, browserRowsForView.length - 1)),
        }
      : null,
    [browserRowsForView, state.browser],
  );

  /**
   * Fetch the catalogue when the marketplace tab first needs it.
   *
   * Once per session, not once per open: it is a megabyte and a half and it
   * does not change between two keystrokes. The disk cache handles the rest.
   */
  const openCatalog = useCallback(
    async (refresh: boolean) => {
      dispatch({ type: 'browser.loading', loading: true });
      try {
        const catalog = await loadCatalog({
          cacheFile: path.join(engine.paths.root, 'marketplace.json'),
          refresh,
        });
        dispatch({ type: 'browser.catalog', catalog });
      } catch (error) {
        const { title } = formatError(error);
        dispatch({ type: 'browser.catalog', catalog: null, problem: title });
      }
    },
    [engine],
  );

  const openSessions = useCallback(async () => {
    try {
      const sessions = await engine.sessions.list(cwd);
      dispatch({ type: 'browser.sessions', sessions });
    } catch (error) {
      const { title } = formatError(error);
      dispatch({ type: 'browser.sessions', sessions: [], problem: title });
    }
  }, [cwd, engine]);

  useEffect(() => {
    if (state.browser?.tab !== 'marketplace') return;
    if (state.browser.catalog || state.browser.problem) return;
    void openCatalog(false);
  }, [state.browser?.tab, state.browser?.catalog, state.browser?.problem, openCatalog]);

  useEffect(() => {
    if (state.browser?.tab !== 'sessions' || !state.browser.loading || state.browser.sessionsLoaded) return;
    void openSessions();
  }, [state.browser?.tab, state.browser?.loading, state.browser?.sessionsLoaded, openSessions]);


  /**
   * Retire settled rows into scrollback.
   *
   * A row can still change while it is the newest thing on screen — output
   * streams into it, its status resolves, an approval is inserted above it — so
   * only unsettled work remains in the live frame. A completed turn stays live
   * until the next user input; that prevents the final answer from triggering
   * a fresh native-scrollback batch and jumping the terminal at completion.
   * The next input establishes the older-turn boundary and promotes it to
   * `<Static>` in one ordered batch.
   */
  useEffect(() => {
    // Committing prints settled rows to native terminal scrollback. Plif does
    // not inspect or reposition the terminal viewport while doing so.
    const boundary = scrollbackCommitEnd(state.entries, LIVE_TAIL);
    let end = 0;
    for (let index = 0; index < boundary; index += 1) {
      const item = state.entries[index]!;
      // Order is the constraint: scrollback is append-only, so a row can only
      // be committed once everything before it already has been.
      if (!isSettled(item)) break;
      end = index + 1;
    }
    if (end > 0) {
      dispatch({
        type: 'commit',
        upTo: end,
        ids: state.entries.slice(0, end).map((entry) => entry.id),
      });
    }
  }, [state.entries]);

  useEffect(() => () => {
    if (streamFlushTimer.current !== null) {
      clearTimeout(streamFlushTimer.current);
      streamFlushTimer.current = null;
    }
    if (taskOutputRefreshTimer.current !== null) {
      clearTimeout(taskOutputRefreshTimer.current);
      taskOutputRefreshTimer.current = null;
    }
  }, []);

  const requestModelKey = useCallback(async (modelName: string, hint?: string): Promise<string | null> => {
    const answer = await engine.questions.ask({
      text: `API key required for ${modelName}. Paste it below.`,
      secret: true,
      context: hint ?? 'This model is marked NeedKey. Esc cancels; the key is stored in the encrypted Plif credential store.',
    });
    const key = answer?.trim();
    if (key) return key;
    push(
      entry('notice', 'model key was not entered', {
        tone: 'warn',
        subtitle: 'Use /models to choose the model again and reopen this credential popup.',
      }),
    );
    return null;
  }, [engine, push]);

  const recoverModelAuth = useCallback(async (error: unknown): Promise<boolean> => {
    if (!PlifError.is(error) || error.code !== 'MODEL_AUTH') return false;
    const stored = await loadStoredConfig(engine.paths);
    const preset = providerIdForConfig(stored) ?? '';
    const model = providerRef.current?.info.id ?? resolveConfig(stored).model;
    let cleared = forgetProviderKey(stored, preset);
    if (credentials) await credentials.forget(credentialVariableForProvider(preset, stored));
    if (credentials) {
      cleared = (await persistModelSelection(
        engine,
        cleared,
        { preset, model },
        undefined,
        credentials,
      )).config;
    } else {
      await saveGlobalConfig(cleared, globalConfigPath(), { preserveProviderKeys: false });
    }
    const key = await requestModelKey(model, [
      `${preset || 'This provider'} rejected the saved API key.`,
      'The old credential was removed from this provider only.',
      'Paste a new API key to save it in the encrypted credential store, or press Esc to keep the model unconfigured.',
    ].join('\n'));
    if (!key) return true;
    const persisted = await persistModelSelection(
      engine,
      cleared,
      { preset, model },
      key,
      credentials,
    );
    providerRef.current = createModelProvider(resolveConfig(persisted.config, {
      model,
      preset,
      ...(persisted.apiKey ? { apiKey: persisted.apiKey } : {}),
    }), { capabilityCache, bus: engine.bus });
    dispatch({
      type: 'context',
      max: providerRef.current.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
    });
    push(entry('notice', persisted.persisted ? 'provider credential updated' : 'credential active for this run', {
      tone: persisted.persisted ? 'accent' : 'warn',
      subtitle: persisted.persisted
        ? 'Retry the message to use the new key.'
        : 'Secure persistence failed; retry after fixing the credential store.',
    }));
    return true;
  }, [capabilityCache, engine, push, requestModelKey]);

  // ---- command execution -------------------------------------------------

  const context: CommandContext = {
    engine,
    supportedEfforts: () => supportedEfforts(
      providerRef.current?.info.endpoint ?? '',
      providerRef.current?.info.id ?? '',
      { providerId: providerRef.current?.info.providerId },
    ),
    modelCompletionValues: () => providerRef.current?.info.id ? [providerRef.current.info.id] : [],
    current: current.current,
    setCurrent: (container) => {
      current.current = container;
      if (container) applySessionEnvironment(sessionEnvironment.current);
      dispatch({
        type: 'container',
        name: container?.name ?? null,
        state: container?.state ?? null,
      });
    },
    clear: () => dispatch({ type: 'clear' }),
    exit: () => {
      dispatch({ type: 'exit' });
      void engine.shutdown('user exit').finally(() => exit());
    },
    cwd,
    tempDir,
    model: providerRef.current,
    modelProblem: providerProblem,
    credentials,
    switchModel: async (requested: ModelSelection | string) => {
      const stored = await loadStoredConfig(engine.paths);
      const selection: ModelSelection =
        typeof requested === 'string'
          // A known catalog id carries an unambiguous provider. This is what
          // keeps a bare free model on OpenCode instead of inheriting a stale
          // paid provider and prompting for its unrelated key.
          ? { preset: providerForModel(requested) ?? providerIdForConfig(stored) ?? '', model: requested }
          : requested;
      const savedKey = await providerCredential(credentials, selection.preset, stored);
      let config = resolveConfig(stored, {
        model: selection.model,
        preset: selection.preset,
        ...(selection.protocol ? { protocol: selection.protocol } : {}),
        ...(selection.streamSemantics ? { streamSemantics: selection.streamSemantics } : {}),
        ...(savedKey ? { apiKey: savedKey } : {}),
      });
      // resolveConfig applies the same capability policy used by the effort
      // menu. Carry that normalized value into the next persisted selection so
      // switching away from Claude cannot leave Ultra/UltraCode in config.
      let selectionStored: GlobalConfig = stored;
      const rememberNormalizedEffort = (resolved: typeof config): void => {
        const normalized = normalizeEffort(
          stored.effort,
          supportedEfforts(resolved.baseURL, resolved.model, { providerId: resolved.providerId }),
        );
        if (normalized === stored.effort) return;
        if (normalized === undefined) {
          const next = { ...stored };
          delete next.effort;
          selectionStored = next;
        } else {
          selectionStored = { ...stored, effort: normalized };
        }
      };
      rememberNormalizedEffort(config);
      let check = validateModelConfig(config);
      let typedKey: string | undefined;
      if (!check.ok) {
        if (!config.apiKey && config.needKey) {
          const providerLabel =
            userCatalog(stored).find((entryProvider) => entryProvider.id === selection.preset)?.label ??
            findCatalogProvider(selection.preset)?.label ?? (selection.preset || 'This provider');
          const keyEnv = credentialVariableForProvider(selection.preset, stored);
          const key = await requestModelKey(selection.model, [
            `${providerLabel} serves this model from ${config.baseURL}.`,
            `The same value can live in ${keyEnv} instead, if you prefer.`,
            'Paste its API key to save it in the encrypted credential store, or press Esc to cancel.',
          ].filter(Boolean).join('\n'));
          if (!key) return;
          typedKey = key;
          config = resolveConfig(stored, {
            model: selection.model,
            preset: selection.preset,
            ...(selection.protocol ? { protocol: selection.protocol } : {}),
            ...(selection.streamSemantics ? { streamSemantics: selection.streamSemantics } : {}),
            apiKey: key,
          });
          rememberNormalizedEffort(config);
          check = validateModelConfig(config);
          if (!check.ok) {
            push(entry('notice', `cannot switch to ${selection.model}`, {
              tone: 'danger',
              detail: [check.problem, check.hint].filter(Boolean).join('\n'),
            }));
            return;
          }
          // The key is what discovery was missing. Drop the cached "this
          // provider lists nothing" answer so the next /model shows the real
          // catalogue instead of the curated stand-in.
          forgetDiscoveredModels(selection.preset);
        } else {
          push(
            entry('notice', `cannot switch to ${selection.model}`, {
              tone: 'danger',
              detail: [check.problem, check.hint].filter(Boolean).join('\n'),
            }),
          );
          return;
        }
      }

      const persisted = await persistModelSelection(
        engine,
        selectionStored,
        selection,
        typedKey,
        credentials,
      );
      config = resolveConfig(persisted.config, {
        model: selection.model,
        preset: selection.preset,
        ...(selection.protocol ? { protocol: selection.protocol } : {}),
        ...(selection.streamSemantics ? { streamSemantics: selection.streamSemantics } : {}),
        ...(persisted.apiKey ? { apiKey: persisted.apiKey } : {}),
      });
      check = validateModelConfig(config);
      if (!check.ok) {
        push(entry('notice', `cannot switch to ${selection.model}`, {
          tone: 'danger',
          detail: [check.problem, check.hint].filter(Boolean).join('\n'),
        }));
        return;
      }

      const previousPreset = providerIdForConfig(stored) ?? '';
      providerRef.current = createModelProvider(config, { capabilityCache, bus: engine.bus });
      const previousEffort = effortRef.current;
      const normalizedEffort = config.effort;
      if (normalizedEffort !== previousEffort) {
        effortRef.current = normalizedEffort;
        setEffortState(normalizedEffort);
        applyEffortPalette(normalizedEffort);
      }
      if (selection.preset !== previousPreset) {
        conversation.current = withoutReasoning(conversation.current);
      }
      dispatch({
        type: 'context',
        used: estimateTokens(conversation.current),
        max: providerRef.current.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
      });
      // Configuration and discovery are separate concerns: switching can be
      // acknowledged immediately, while the provider catalog warms in the
      // background for the next /models opening. The discovery layer dedupes
      // this with startup and periodic refreshes.
      void discoverProviderModels(selection.preset, {
        stored: persisted.config,
        ...(persisted.apiKey ? { apiKey: persisted.apiKey } : {}),
      });
      push(
        entry('notice', `${glyph.done}  model    ${selection.model}`, {
          tone: persisted.persisted ? 'accent' : 'warn',
          subtitle: persisted.persisted
            ? conversation.current.length > 0
              ? 'the conversation so far carries over'
              : undefined
            : 'active for this run; secure persistence failed',
        }),
      );
    },
    setEffort: async (effort) => {
      const loaded = await loadStoredConfig(engine.paths);
      const migrated = credentials
        ? await migrateCredentialsForWrite(loaded, credentials)
        : Object.keys(storedProviderCredentials(loaded, providerIdForConfig(loaded) ?? '')).length > 0
          ? undefined
          : loaded;
      if (!migrated) {
        throw new PlifError('INTERNAL', 'effort was not saved because credential migration failed', {
          hint: 'Fix the encrypted credential store and retry; config.toml was left untouched.',
        });
      }
      const stored = migrated;
      const next = { ...stored, ...(effort ? { effort } : {}) };
      if (!effort) delete next.effort;
      const providerId = providerIdForConfig(next) ?? '';
      const savedKey = await providerCredential(credentials, providerId, next);
      const config = resolveConfig(next, savedKey ? { apiKey: savedKey } : {});
      const availableEfforts = supportedEfforts(config.baseURL, config.model, {
        providerId: config.providerId,
      });
      if (effort && !availableEfforts.includes(effort)) {
        throw new PlifError('INVALID_ARGUMENT', `${effort} is not supported by the current model.`, {
          hint: `Supported: ${availableEfforts.join(', ')}`,
        });
      }
      providerRef.current = createModelProvider(config, { capabilityCache, bus: engine.bus });
      await saveStoredConfig(engine.paths, next);
      dispatch({
        type: 'context',
        used: estimateTokens(conversation.current),
        max: providerRef.current.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
      });
      const previous = effortRef.current;
      const specialEffort = (value: Effort | undefined): boolean =>
        ['plif', 'max', 'ultra', 'ultracode'].includes(value ?? '');
      if (!specialEffort(effort) && specialEffort(previous) && previous !== 'plif') {
        const restored = themeCatalogue.themes.find((theme) => theme.id === activeThemeId.current)
          ?? themeCatalogue.themes[0]!;
        activateTheme(restored);
        setThemeRevision((value) => value + 1);
      }
      applyEffortPalette(effort);
      effortRef.current = effort;
      setEffortState(effort);
      if (effort === 'plif' && previous !== 'plif') {
        if (plifActivationTimer.current) clearTimeout(plifActivationTimer.current);
        setPlifActivation(true);
        plifActivationTimer.current = setTimeout(() => {
          plifActivationTimer.current = null;
          setPlifActivation(false);
        }, PLIF_ACTIVATION_DURATION_MS);
        plifActivationTimer.current.unref?.();
      } else if (effort !== 'plif' && plifActivation) {
        if (plifActivationTimer.current) clearTimeout(plifActivationTimer.current);
        plifActivationTimer.current = null;
        setPlifActivation(false);
      }
    },
    setPlanMode: async (enabled, description) => {
      planModeRef.current = enabled;
      setPlanModeState(enabled);
      if (enabled && description) {
        await runAgent(description, [], undefined, 'plan');
      }
    },
    startGoal: async (condition) => {
      // `/goal` is a session note, not a hidden submission. It must never
      // spend a model turn or start editing just because the user recorded
      // their desired outcome.
      await goalControllerRef.current?.setUserGoal(condition);
      syncGoalRef();
    },
    goalStatus: () => goalRef.current ? { ...goalRef.current } : null,
    clearGoal: async () => {
      await goalControllerRef.current?.clear();
      syncGoalRef();
    },
    switchProfile: async (name) => {
      const loaded = await loadStoredConfig(engine.paths);
      const stored = credentials
        ? await migrateCredentialsForWrite(loaded, credentials)
        : Object.keys(storedProviderCredentials(loaded, providerIdForConfig(loaded) ?? '')).length > 0
          ? undefined
          : loaded;
      if (!stored) throw new Error('profile was not saved because credential migration failed');
      const profile = profilesOf(stored)[name];
      if (!profile) throw new Error(`unknown profile ${name}`);
      const modelOptions = profile.model ? { model: profile.model } : {};
      const providerId = providerIdForConfig(stored, modelOptions) ?? '';
      const savedKey = await providerCredential(credentials, providerId, stored);
      const config = resolveConfig(stored, {
        ...modelOptions,
        ...(savedKey ? { apiKey: savedKey } : {}),
      });
      const check = validateModelConfig(config);
      if (!check.ok) throw new Error(check.problem ?? 'profile model is not usable');
      providerRef.current = createModelProvider(config, { capabilityCache, bus: engine.bus });
      await saveStoredConfig(engine.paths, { ...stored, activeProfile: name });
      if (stored.activeProfile !== name) {
        conversation.current = withoutReasoning(conversation.current);
        push(
          entry('notice', `profile ${name} is active`, {
            tone: 'accent',
            subtitle: conversation.current.length > 0
              ? 'the conversation so far carries over'
              : undefined,
          }),
        );
      }
      dispatch({
        type: 'context',
        used: estimateTokens(conversation.current),
        max: providerRef.current.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
      });
    },
    clearProfile: async () => {
      const loaded = await loadStoredConfig(engine.paths);
      const stored = credentials
        ? await migrateCredentialsForWrite(loaded, credentials)
        : Object.keys(storedProviderCredentials(loaded, providerIdForConfig(loaded) ?? '')).length > 0
          ? undefined
          : loaded;
      if (!stored) throw new Error('persona was not disabled because credential migration failed');
      if (stored.activeProfile === undefined) return;
      const { activeProfile: _activeProfile, ...withoutProfile } = stored;
      await saveStoredConfig(engine.paths, withoutProfile);
      conversation.current = withoutReasoning(conversation.current);
      push(entry('notice', 'base PLIF identity restored', {
        tone: 'accent',
        subtitle: 'the selected model and provider were preserved',
      }));
    },
    /**
     * `/compact`, over the conversation this component holds.
     *
     * Runs the same ladder and emits the same events as the loop's automatic
     * pass, so the progress bar, the summary row and the context gauge all
     * behave identically whether it was asked for or forced.
     *
     * The system prompt is not in `conversation.current` — it is rebuilt every
     * turn — so what goes in is exactly the exchange, and the summary comes
     * back pinned in its place.
     */
    compactNow: async (aggressive: boolean) => {
      const before = estimateTokens(conversation.current);
      const contextWindow = providerRef.current?.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS;
      const target = Math.floor(contextWindow * (aggressive ? 0.33 : 0.7));
      compactionSince.current = Date.now();
      try {
        const result = await runCompaction(conversation.current, {
          ...(providerRef.current ? { provider: providerRef.current } : {}),
          bus: engine.bus,
          target,
        });
        conversation.current = [...result.messages];
        dispatch({ type: 'context', used: result.after });
        return { before, after: result.after };
      } finally {
        compactionSince.current = null;
        dispatch({ type: 'compaction.end' });
      }
    },
    pasteImage: () => pasteImage(),
    openBrowser: (tab) => dispatch({ type: 'browser.open', tab }),
    loginMcp,
    loginCodex,
    mcpNames: mcpStatuses.map((server) => server.name),
    openPicker: (picker) => dispatch({ type: 'picker.open', picker }),
    openEnv: openEnvironmentPicker,
    openBtw,
    env: environmentActions,
    hasPersistentSession,
    containerEnvironment: () => sessionEnvironment.current,
    runBtw,
    cancelBtw,
    notify: (notice) => push(notice),
    copySession: async () => {
      try {
        const text = formatSessionExport({
          cells: transcript.state.finalized,
          active: transcript.state.active,
          workspace: cwd,
          ...(goalRef.current ? { goal: goalRef.current.condition } : {}),
        });
        await writeClipboardText(text);
        push(entry('notice', 'session copied to clipboard', {
          tone: 'success',
          subtitle: `${text.length.toLocaleString()} characters`,
        }));
      } catch (error) {
        const { title, detail } = formatError(error);
        push(entry('notice', title, { tone: 'danger', ...(detail ? { detail } : {}) }));
      }
    },
    saveSession: async () => {
      try {
        const text = formatSessionExport({
          cells: transcript.state.finalized,
          active: transcript.state.active,
          workspace: cwd,
          ...(goalRef.current ? { goal: goalRef.current.condition } : {}),
        });
        const target = path.join(cwd, sessionExportFileName());
        await fs.writeFile(target, text, { encoding: 'utf8', flag: 'wx' });
        push(entry('notice', 'session saved', {
          tone: 'success',
          subtitle: target,
        }));
      } catch (error) {
        const { title, detail } = formatError(error);
        push(entry('notice', title, { tone: 'danger', ...(detail ? { detail } : {}) }));
      }
    },
    sessionStatus: (): StatusInput => ({
      model: providerRef.current?.info.id ?? provider?.info.id ?? '',
      provider: redactedProviderId(providerRef.current?.info.endpoint ?? provider?.info.endpoint ?? ''),
      effort: effortRef.current,
      contextUsed: state.contextUsed,
      contextMax: state.contextMax,
      elapsedMs: Date.now() - sessionStartedAt.current,
      usage: { ...usage.current, turns: turn },
      workspace: cwd,
      container: current.current?.name ?? state.container,
      containerState: state.containerState,
      planMode: planModeRef.current,
      goal: goalRef.current?.condition ?? null,
      mcpConnected: mcpStatuses.filter((server) => server.connected).length,
      mcpServers: mcpStatuses.length,
      skills: skillList.length,
      queued: state.queue.length,
      sessionId: transcript.session?.id ?? null,
      sessionName: transcript.session?.meta.title ?? null,
    }),
    themes: themeCatalogue.themes,
    openStatus: openStatusScreen,
    openConfig: openConfigScreen,
    switchTheme: async (id) => {
      const theme = themeCatalogue.themes.find((entry) => entry.id === id);
      if (!theme) throw new Error(`unknown theme ${id}`);
      activateTheme(theme);
      applyEffortPalette(effortRef.current);
      activeThemeId.current = id;
      const stored = await loadGlobalConfig();
      let safe = stored;
      if (credentials) {
        const migrated = await migrateCredentialsForWrite(stored, credentials);
        if (!migrated) {
          push(entry('notice', 'theme was not saved', {
            tone: 'danger',
            subtitle: 'Could not move the existing model credential into the encrypted store.',
          }));
          return;
        }
        safe = migrated;
      } else if (Object.keys(storedProviderCredentials(stored, providerIdForConfig(stored) ?? '')).length > 0) {
        push(entry('notice', 'theme was not saved', {
          tone: 'danger',
          subtitle: 'An encrypted credential store is required before changing this config.',
        }));
        return;
      }
      await saveGlobalConfig({ ...safe, theme: id }, globalConfigPath(), { preserveProviderKeys: false });
      setThemeRevision((value) => value + 1);
    },
  };

  const updateGlobalConfig = useCallback(async (patch: Record<string, unknown>): Promise<void> => {
    const loaded = await loadGlobalConfig();
    const safe = credentials
      ? await migrateCredentialsForWrite(loaded, credentials)
      : Object.keys(storedProviderCredentials(loaded, providerIdForConfig(loaded) ?? '')).length > 0
        ? undefined
        : loaded;
    if (!safe) {
      throw new PlifError('INTERNAL', 'setting was not saved because credential migration failed', {
        hint: 'Fix the encrypted credential store and retry; config.toml was left untouched.',
      });
    }
    const nextRecord: Record<string, unknown> = { ...safe };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete nextRecord[key];
      else nextRecord[key] = value;
    }
    const next = nextRecord as GlobalConfig;
    await saveGlobalConfig(next, globalConfigPath(), { preserveProviderKeys: false });
    setConfigSnapshot(next);
  }, [credentials]);

  const setPermissionFromConfig = useCallback(async (mode: 'ask' | 'auto-approve' | 'deny'): Promise<void> => {
    await updateGlobalConfig({ permissionMode: mode, autoApprove: mode === 'auto-approve' });
    context.engine.approvals.setPermissionMode(mode);
  }, [context.engine, updateGlobalConfig]);

  const openConfigCommand = useCallback(async (name: 'models' | 'providers'): Promise<void> => {
    dispatch({ type: 'screen.close' });
    const command = findCommand(name);
    if (!command) return;
    const result = await command.run([], context);
    result.entries.forEach(push);
  }, [context, push]);

  const configActions: ConfigActions = {
    setTheme: context.switchTheme,
    setEffort: context.setEffort,
    setPermissionMode: setPermissionFromConfig,
    updateGlobal: updateGlobalConfig,
    openModels: () => openConfigCommand('models'),
    openProviders: () => openConfigCommand('providers'),
    openMcp: () => {
      dispatch({ type: 'screen.close' });
      context.openBrowser('mcp');
    },
    openSkills: () => {
      dispatch({ type: 'screen.close' });
      context.openBrowser('skills');
    },
  };

  const configSettings = configSnapshot
    ? createConfigSettings({
        config: configSnapshot,
        activeThemeId: activeThemeId.current,
        themes: themeCatalogue.themes,
        provider: redactedProviderId(providerRef.current?.info.endpoint ?? provider?.info.endpoint ?? ''),
        model: providerRef.current?.info.id ?? provider?.info.id ?? '',
        effort: effortRef.current,
        supportedEfforts: supportedEfforts(
          providerRef.current?.info.endpoint ?? provider?.info.endpoint ?? '',
          providerRef.current?.info.id ?? provider?.info.id ?? '',
          { providerId: providerRef.current?.info.providerId },
        ),
        mcpConnected: mcpStatuses.filter((server) => server.connected).length,
        mcpServers: mcpStatuses.length,
        skills: skillList.length,
        workspace: cwd,
      }, configActions)
    : [];
  const filteredConfigSettings = state.screen?.kind === 'config'
    ? filterConfigSettings(configSettings, state.screen.state.filter)
    : [];
  const screenStatus = context.sessionStatus?.();

  const confirmSecretDraft = useCallback(async (text: string): Promise<boolean> => {
    const detection = detectDraftSecrets(text);
    if (detection.spans.length === 0) return true;

    const first = await engine.questions.ask({
      text: SECRET_FIRST_QUESTION,
      context: SECRET_FIRST_CONTEXT,
      options: [{
        value: SECRET_REVIEW_VALUE,
        label: 'Review warning',
        description: 'Continue to the final confirmation without sending the draft.',
      }],
    });
    if (first !== SECRET_REVIEW_VALUE) return false;

    const action = await engine.questions.ask({
      text: SECRET_FINAL_QUESTION,
      context: SECRET_FINAL_CONTEXT,
      options: [
        {
          value: 'cancel',
          label: 'Cancel and Edit',
          description: 'Keep the draft untouched so you can remove the credential.',
        },
        {
          value: SECRET_REDACT_VALUE,
          label: 'Save Redacted Prompt and Cancel',
          description: 'Replace detected credentials with a safe marker and copy that version.',
        },
        {
          value: SECRET_SEND_VALUE,
          label: 'Send Anyway',
          description: 'Send and persist the original prompt; PLIF cannot unsend or revoke it.',
        },
      ],
    });

    if (action === SECRET_REDACT_VALUE) {
      const safe = redactDetectedSecrets(text, detection);
      setInput(safe);
      setCursor(safe.length);
      setPasted([]);
      history.current.record(safe);
      try {
        await writeClipboardText(safe);
        push(entry('notice', 'redacted prompt saved', {
          tone: 'success',
          subtitle: 'The safe version was placed in clipboard and command history. The credential was not copied.',
        }));
      } catch {
        push(entry('notice', 'redacted prompt saved locally', {
          tone: 'success',
          subtitle: 'Clipboard was unavailable; the safe version remains in the prompt and command history.',
        }));
      }
    }
    return action === SECRET_SEND_VALUE;
  }, [engine, push]);

  const submit = useCallback(
    async (
      line: string,
      suppliedAttachments?: readonly PastedAttachment[],
      clearComposer = false,
      secretApproved = false,
    ) => {
      if (credentialPromptPending || projectRootSetupPending) return;
      const visibleLine = line.trim();
      if (!visibleLine) return;
      if (visibleLine.startsWith('/')) {
        // Slash commands are local actions. They must never carry an image that
        // was left in the composer from a previous prompt.
        if (suppliedAttachments === undefined) setPasted([]);
        const presentation = slashCommandPresentation(visibleLine);
        if (presentation.remember) history.current.record(presentation.display);
        await runSlash(visibleLine);
        return;
      }

      const carried = suppliedAttachments ?? composerRef.current.attachments;
      let materialized = materializePastedLine(visibleLine, carried);
      if (!secretApproved && !(await confirmSecretDraft(materialized.text))) return;
      const trimmed = materialized.text.trim();

      const privateShell = visibleLine.startsWith('!!');
      const submissionKind = classifySubmission(trimmed);
      const agentSubmission = submissionKind === 'agent';
      let agentText = trimmed;
      if (agentSubmission && !privateShell) {
        try {
          const brief = await askProjectBrief(
            (question) => engine.questions.ask(question),
            trimmed,
          );
          if (brief === null) {
            push(entry('notice', 'frontend brief cancelled', {
              tone: 'muted',
              subtitle: 'Choose the stack and visual direction before sending this request.',
            }));
            return;
          }
          if (brief) agentText = `${trimmed}\n\n${projectBriefInstruction(brief)}`;
        } catch (error) {
          const { title, detail } = formatError(error);
          push(entry('notice', 'could not prepare the frontend brief', {
            tone: 'danger',
            detail: detail ? `${title}: ${detail}` : title,
          }));
          return;
        }
      }
      if (clearComposer) {
        setInput('');
        setCursor(0);
        setPasted([]);
      }
      history.current.record(privateShell ? '!! [private command]' : visibleLine);
      if (agentSubmission) {
        setTurn((value) => value + 1);
        turnCompletionTokens.current = 0;
        completionMeterRef.current = initialCompletionMeter;
      }
      setCompletionIndex(0);
      dispatch({ type: 'discovery.reset' });

      // Keep the compact token in scrollback, but persist the actual text in
      // the durable conversation. This makes the editor cheap without ever
      // sending its visual placeholder to the model or transcript backend.
      push(entry('input', privateShell ? '!! [private command]' : visibleLine));
      const turnId = !privateShell && !trimmed.startsWith('/') && !trimmed.startsWith('!')
        ? transcript.appendUserTurn(agentText)
        : undefined;
      dispatch({
        type: 'busy',
        busy: true,
        label: trimmed.startsWith('/') ? trimmed.split(' ')[0] : 'running',
        since: Date.now(),
      });

      try {
        // Three input modes, and the default is the one that matters.
        //
        // Plain text goes to the *agent*, not to the shell. Sending it to the
        // shell was the original behaviour and it was plainly wrong the first
        // time someone typed a greeting: "opa" came back as `spawn opa ENOENT`.
        // This is an agent CLI; talking is the common case and running a raw
        // command is the special one, so `!` is what asks for a shell.
        if (trimmed.startsWith('/')) {
          await runSlash(trimmed);
        } else if (trimmed.startsWith('!')) {
          const isPrivate = trimmed.startsWith('!!');
          await runExec(trimmed.slice(isPrivate ? 2 : 1).trim(), !isPrivate);
        } else {
          await runAgent(
            agentText,
            await encodePasted(materialized.attachments),
            turnId,
            planModeRef.current ? 'plan' : 'normal',
          );
        }
      } catch (error) {
        if (turnId) {
          transcript.persist({
            ...eventBase('turn.failed', turnId),
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        const { title, detail } = formatError(error);
        push(
          entry('step', title, { status: 'failed', tone: 'danger', ...(detail ? { detail } : {}) }),
        );
      } finally {
        dispatch({ type: 'discovery.flush' });
        dispatch({ type: 'busy', busy: false });
      }
    },
    [confirmSecretDraft, credentialPromptPending, engine, projectRootSetupPending, push, transcript],
  );

  /**
   * Send anything the turn never got round to collecting.
   *
   * The tool-call boundary is the *earliest* delivery point, not the only one.
   * A turn that answers without touching another tool — which is most short
   * ones — reaches its end with the queue untouched, and leaving it there would
   * mean a message the developer watched themselves type simply never arrives.
   * Nothing about "queued" implies "conditional".
   *
   * Only fires once the agent is idle, so it starts a turn rather than racing
   * one, and the messages go as a single turn because they were written as one
   * train of thought.
   */
  useEffect(() => {
    if (state.busy || state.queue.length === 0) return;
    const leftover = state.queue;
    queueRef.current = [];
    dispatch({ type: 'queue.clear' });
    void (async () => {
      for (const message of leftover) await submit(message.text, message.attachments, false, true);
    })();
  }, [state.busy, state.queue, submit]);

  async function runSlash(line: string): Promise<void> {
    const [name, ...argv] = tokenize(line.slice(1));
    const command = findCommand(name ?? '');
    if (!command) {
      const suggestions = matchCommands(name ?? '').slice(0, 5);
      push(
        entry('step', `unknown command /${name}`, {
          status: 'failed',
          tone: 'danger',
          detail: suggestions.length
            ? 'did you mean: ' + suggestions.map((s) => '/' + s.name).join(', ')
            : 'Run /help for the full list.',
        }),
      );
      return;
    }
    const result = await command.run(argv, context);
    result.entries.forEach(push);
  }

  /**
   * Talk to the agent.
   *
   * Ensures a container exists first. Requiring `/new` before you can say
   * anything is a ritual with no purpose — the agent needs somewhere to work,
   * so make one and say that you did.
   */
  /**
   * Read the pasted files back as base64, for the wire.
   *
   * Done here rather than at paste time so an image the developer removed from
   * the line before sending is never encoded, and so a failed read costs the
   * attachment rather than the whole turn — an unreadable temp file is worth a
   * warning, not a dead message.
   */
  async function encodePasted(attachments: readonly PastedAttachment[]): Promise<Attachment[]> {
    const encoded: Attachment[] = [];
    for (const attachment of attachments) {
      if (attachment.kind === 'text') {
        encoded.push({ kind: 'text', name: attachment.token, text: attachment.text });
        continue;
      }
      try {
        const data = await fs.readFile(attachment.path);
        encoded.push({
          kind: 'image',
          mediaType: attachment.mediaType,
          data: data.toString('base64'),
          name: attachment.token,
        });
      } catch {
        push(
          entry('notice', `could not read ${attachment.token}`, {
            tone: 'warn',
            subtitle: attachment.path,
          }),
        );
      }
    }
    return encoded;
  }

  async function runAgent(
    text: string,
    attachments: readonly Attachment[] = [],
    turnId?: string,
    mode: AgentTurnMode = 'normal',
  ): Promise<void> {
    const durableTurnId = turnId ?? transcript.appendUserTurn(text);
    if (!providerRef.current) {
      await transcript.persist({
        ...eventBase('turn.failed', durableTurnId),
        reason: providerProblem ?? 'no model provider is configured',
      });
      push(
        entry('step', 'no model configured', {
          status: 'failed',
          tone: 'danger',
          detail:
            (providerProblem ?? 'no model provider is configured') +
            "\n\nRun 'plif model' to see the whole resolved configuration." +
            '\nOr run a command directly with a leading "!", e.g. !npm test',
        }),
      );
      transcript.finishTurn(durableTurnId);
      return;
    }

    // These reads do not depend on the container and are required to assemble
    // the first prompt. Start them beside image/container preparation so a
    // slow memory store or instruction file cannot add its latency to the
    // model's first request.
    const existingContainer = current.current;
    const snapshotPromise = engine.memory.snapshot(cwd);
    const instructionsPromise = readAgentInstructions(cwd);
    const configPromise = loadStoredConfig(engine.paths);
    // The transcript queue may create the session lazily on the first user
    // event. Resolve it in parallel with normal turn setup so native
    // providers can recover their pointer without creating a second source of
    // truth for conversation history.
    // Resolve the durable session once and make both environment loading and
    // container creation depend on that same promise. This is the critical
    // startup/resume ordering: no container can start with a previous session
    // or before its encrypted environment has been resolved.
    const activeSessionPromise = transcript.resolveSession();
    const conversationStatePromise = activeSessionPromise.then(async (activeSession) => {
      return activeSession?.loadConversationState() ?? null;
    });
    const environmentPromise = activeSessionPromise.then((activeSession) => loadSessionEnvironment(activeSession));
    const containerPromise: Promise<Container> = environmentPromise.then(async () => {
      if (existingContainer) return existingContainer;
      const image = await engine.ensureBaseImage();
      const container = await engine.run({
        image: image.reference,
        mounts: [containerMount(cwd), containerTempMount(tempDir)],
        workdir: containerWorkdir(cwd),
        // Network is granted at the ceiling and gated per host by policy,
        // which falls through to "ask". It costs a permission prompt the
        // first time a search runs, and nothing when auto-approve is on.
        capabilities: { hostWrite: true, network: true },
      });
      // The container is running now. Injecting through the runtime-only API
      // keeps decrypted values out of Engine's persisted ContainerSpec.
      if (Object.keys(sessionEnvironment.current).length > 0) {
        container.applyEnvironment(sessionEnvironment.current);
      }
      return container;
    });

    const [container, snapshot, agentInstructions, profileConfig, conversationState, activeSession] = await Promise.all([
      containerPromise,
      snapshotPromise,
      instructionsPromise,
      configPromise,
      conversationStatePromise,
      activeSessionPromise,
    ]);
    await goalControllerRef.current?.ready();
    goalControllerRef.current?.setMaxRounds(plifModeOf(profileConfig).maxGoalRounds);
    syncGoalRef();
    if (!existingContainer) {
      // Deliberately silent. The container's name is already in the header and
      // on the prompt badge.
      context.setCurrent(container);
    }

    agentRow.current = null;
    agentText.current = '';
    thinkRow.current = null;
    // Last turn's subagents are finished work; the panel is a live view, and
    // carrying four settled tabs into a new question is four tabs of clutter
    // over whatever this turn delegates.
    dispatch({ type: 'subagent.reset' });

    const abort = new AbortController();
    execAbort.current = abort;

    if (!taskManager.current || taskManager.current.container.id !== container.id) {
      await taskManager.current?.stopAll();
      const previousLsp = lspManager.current;
      if (previousLsp) {
        // Stop the old manager before exposing a new root. `stop()` also waits
        // for in-flight warmup starts, so a late probe cannot spawn a server in
        // the container we just left.
        await previousLsp.stop();
        if (lspManager.current === previousLsp) lspManager.current = null;
      }
      setLspStatuses(null);
      taskManager.current = new TaskManager({
        container,
        bus: engine.bus,
        approvals: engine.approvals,
        sessionId: activeSession?.id ?? transcript.session?.id ?? 'interactive',
      });
      setTasks(visibleTasks(taskManager.current.list()));
      const nextLsp = new LspManager({
        root: await container.hostPathFor(container.workdir),
        tempRoot: tempDir,
        bus: engine.bus,
      });
      lspManager.current = nextLsp;
      // LSP is useful to later tool calls but is not a prerequisite for the
      // first model request. Its client manager initializes lazily if a tool
      // asks for a language server before this warmup completes.
      void nextLsp.warmup()
        .then(async () => {
          if (lspManager.current !== nextLsp) return;
          setLspStatuses(await nextLsp.statuses());
        })
        .catch(() => undefined);
    }
    const activeProfileName = typeof profileConfig.activeProfile === 'string' ? profileConfig.activeProfile : undefined;
    const activeProfile = activeProfileName ? profilesOf(profileConfig)[activeProfileName] : undefined;
    // The subagent inherits the LSP tools but not the parent's own subagent
    // tool — that is what stops recursion, and it is enforced here rather than
    // trusted to the prompt.
    const lspForAgent = lspManager.current ? lspTools(lspManager.current) : [];
    const edits = new EditCoordinator();
    const storedConfig = profileConfig;
    const configuredConversationState = process.env['PLIF_CONVERSATION_STATE'] ?? storedConfig.conversationState;
    const conversationStateMode = configuredConversationState === 'native' || configuredConversationState === 'replay'
      ? configuredConversationState
      : 'auto';
    const directImageSupport = modelSupportsImages(storedConfig, {
      model: providerRef.current.info.id,
      preset: providerIdForConfig(storedConfig),
    });
    const wireAttachments = attachmentsForPrimaryModel(attachments, directImageSupport);
    if (hasImageAttachments(attachments) && !directImageSupport) {
      push(entry('notice', 'image held for vision inspection', {
        tone: 'muted',
        subtitle: 'the active model is text-only; raw pixels stay available to inspect_image instead of being sent to an unsupported endpoint',
      }));
    }
    const planOnly = mode === 'plan';
    const goalInstructions = goalRef.current?.status === 'active'
      ? `SESSION GOAL: ${goalRef.current.condition}\nGoal state: ${goalRef.current.armed ? 'armed for autonomous rounds' : 'context only; not armed'}, round ${goalRef.current.rounds}/${goalRef.current.maxRounds}. Read this goal to understand the user's final desired outcome. Do not start autonomous work unless the user armed it with /goal.`
      : "No session goal is set. Do not invent a final objective silently. If the user's end goal is unclear, use ask_user first; when the Galileo skill is available, use it after clarification to help structure the objective.";
    const turnInstructions = [
      agentInstructions,
      'PROJECT SECRETS: Project environment values may already be injected into container processes, but they are never part of the chat context. If a secret is missing, guide the developer to use `/env set NAME` or `/env import .env`; never ask them to paste a secret into chat, never inspect or print environment values, and never repeat or echo a credential.',
      planOnly
        ? 'PLAN MODE: inspect files and run read-only discovery only. Do not write, edit, delete, move, install, commit, or otherwise mutate the workspace. Return a concrete implementation plan and wait for /plan off before making changes.'
        : undefined,
      goalInstructions,
    ].filter(Boolean).join('\n\n');
    const carried = conversation.current;
    // Native Codex app-server turns cannot execute PLIF's host-only `skill`
    // tool. Preload only the mandatory skills for that provider; other
    // providers keep the existing lazy skill-tool path.
    const codexMandatoryNames = mandatorySkillsForEffort(effortRef.current);
    const codexSkillBootstrap = providerRef.current.info.providerId === 'codex'
      ? codexMandatoryNames
          .map((name) => skillRegistry?.get(name))
          .filter((skill): skill is Skill => skill !== undefined)
          .map((skill) => ({ name: skill.name, instructions: skill.instructions }))
      : [];
    const loadedSkillsForPrompt = [...new Set([
      ...loadedSkillNames(carried),
      ...codexSkillBootstrap.map((skill) => skill.name),
    ])];
    const childOptions = {
      provider: providerRef.current,
      isolation: report.isolation,
      stored: storedConfig,
      resolveCredential: async (providerId: string, childStored: GlobalConfig) =>
        await providerCredential(credentials, providerId, childStored),
      agents: agentsOf(storedConfig),
      agentAutoLaunch: storedConfig.agentAutoLaunch !== false,
      extraTools: [
        ...(skillRegistry ? [skillTool(skillRegistry)] : []),
        ...lspForAgent,
        ...WEB_TOOLS,
      ],
      skillCatalogue: skillRegistry?.catalogue() ?? skillCatalogue,
      edits,
      coordinator: subagents.current,
      ...(turnInstructions ? { agentInstructions: turnInstructions } : {}),
      sessions: engine.sessions,
      memory: engine.memory,
      parentSession: activeSession ?? undefined,
      parentContext: () => activeConversation.current ?? carried,
      continuable: plifModeOf(storedConfig).continuableSubagents !== false,
      skillBootstrap: codexSkillBootstrap,
    };
    const allAgentTools = [
      ...tools,
      ...(planOnly ? [] : mcpRegistry?.tools() ?? []),
      ...lspForAgent,
      ...WEB_TOOLS,
      ...(planOnly ? [] : visionTools(childOptions)),
      ...(planOnly ? [] : [subagentTool(childOptions)]),
      ...(planOnly || plifModeOf(storedConfig).continuableSubagents === false
        ? []
        : [sendMessageTool(childOptions)]),
    ];
    const agentTools = planOnly
      ? allAgentTools.filter((tool) => !PLAN_BLOCKED_TOOLS.has(tool.spec.name))
      : allAgentTools;

    const outgoing: Message[] = [
      ...carried,
      { role: 'user', content: text, ...(wireAttachments.length ? { attachments: wireAttachments } : {}) },
    ];
    // BTW invoked during this turn should see the current user request as well
    // as the prior transcript. Keep this projection separate from the loop's
    // mutable message array so the side channel can never alter primary state.
    activeConversation.current = structuredClone(outgoing);

    const loadingOperationId = beginLoading(durableTurnId);
    let loadingResult: 'done' | 'error' | 'cancelled' = 'done';
    let goalRoundEligible = false;
    // Token Split configuration is read once at turn start. A command can
    // change it safely for the next turn, never halfway through this request.
    const tokenSplitConfig = await loadTokenSplitConfig();

    try {
      const result = await runLoop(
        [
          {
            role: 'system',
            content: buildSystemPrompt({
              workspace: cwd,
              containerName: container.name,
              workdir: container.workdir,
              tempWorkdir: '/temp',
              capabilities: container.capabilities,
              isolation: report.isolation,
              contextTokens: providerRef.current.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
              tools: stableToolSpecs([
                ...agentTools.map((tool) => tool.spec),
                ...(planOnly ? [] : [RUN_SCRIPT_SPEC]),
              ]),
              skills: skillRegistry?.catalogue() ?? skillCatalogue,
              loadedSkills: loadedSkillsForPrompt,
              providerId: providerRef.current.info.providerId,
              modelId: providerRef.current.info.id,
              endpointRoute: providerRef.current.info.endpoint,
              mcpServers: mcpRegistry ? mcpRegistry.catalogue() : mcpCatalogue,
              guidance: snapshot.guidance,
              memory: summariseMemory(snapshot),
              notes: snapshot.notes,
              sandboxGaps: report.degradations,
              effort: effortRef.current,
              ...(turnInstructions ? { agentInstructions: turnInstructions } : {}),
              ...(planOnly ? { mode: 'explore' as const } : {}),
              ...(activeProfile
                ? {
                    profile: {
                      name: activeProfile.name ?? activeProfileName!,
                      ...(activeProfile.description ? { description: activeProfile.description } : {}),
                      systemPrompt: activeProfile.systemPrompt,
                    },
                  }
                : {}),
            }),
          },
          ...outgoing,
        ],
        {
          provider: providerRef.current,
          container,
          questions: engine.questions,
          bus: engine.bus,
          turnId: durableTurnId,
          signal: abort.signal,
          ...(conversationState ? { conversationState } : {}),
          conversationStateMode,
          tools: agentTools,
          skillBootstrap: codexSkillBootstrap,
          memory: engine.memory,
          workspace: cwd,
          execution: {
            cwd,
            workspaceRoots: [cwd],
            permissionMode: engine.approvals.permissionMode,
            ask: (question) => engine.questions.ask(question),
            approve: async (request: ModelApprovalRequest): Promise<'allow' | 'deny' | 'cancel'> => {
              const answer = await engine.approvals.ask({
                containerId: container.name,
                action: request.kind === 'execute'
                  ? 'exec'
                  : request.kind === 'permissions' && request.network
                    ? 'net.connect'
                    : 'fs.write',
                target: request.target,
                ...(request.argv ? { argv: request.argv } : {}),
                reason: request.reason ?? 'Codex requested approval through the shared PLIF permission broker.',
                rationale: 'The Codex app-server request is governed by the active PLIF permission mode.',
              }, abort.signal);
              return answer.decision === 'allow' ? 'allow' : 'deny';
            },
          } satisfies ModelExecutionContext,
          sessionId: transcript.session?.id ?? 'interactive',
          contextTokens: providerRef.current.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
          tokenSplit: {
            config: tokenSplitConfig,
            workspace: cwd,
            sessionId: transcript.session?.id ?? 'interactive',
          },
          enableHarnessCycle: effortRef.current === 'plif',
          runScript: !planOnly,
          runScriptMaxSteps: plifModeOf(storedConfig).runScriptMaxSteps,
          agentId: activeSession?.meta.uuid ?? 'primary',
          goal: goalControllerRef.current ?? undefined,
          sessions: engine.sessions,
          maxIterations: effortRef.current === 'plif' ? 50 : undefined,
          maxReviewReminders: effortRef.current === 'plif'
            ? plifModeOf(storedConfig as GlobalConfig).maxReviewReminders
            : undefined,
          plifTelemetry: effortRef.current === 'plif'
            ? {
                reviewPasses: plifModeOf(storedConfig as GlobalConfig).reviewPasses ?? 3,
                skillsLoaded: skillRegistry?.list().map((skill) => skill.name) ?? [],
              }
            : undefined,
          ...(attachments.length ? { attachments } : {}),
          ...(taskManager.current ? { tasks: taskManager.current } : {}),
          ...(lspManager.current ? { lsp: lspManager.current } : {}),
          edits,
          /**
           * Hand over anything typed since the turn started.
           *
           * Cleared as it is taken, so a turn with six tool calls delivers each
           * message once. The rows are logged as ordinary input so the
           * transcript reads in the order the model actually received things.
           */
          drainQueue: async () => {
            const pendingMessages = queueRef.current;
            if (pendingMessages.length === 0) return [];
            const isCommand = (message: QueuedMessage): boolean =>
              message.text.trim().startsWith('/');
            const forModel = pendingMessages.filter((message) => !isCommand(message));
            queueRef.current = pendingMessages.filter(isCommand);
            if (forModel.length === 0) return [];
            dispatch({ type: 'queue.deliver', ids: forModel.map((message) => message.id) });
            for (const message of forModel) {
              const materialized = materializePastedLine(message.text, message.attachments);
              push(entry('input', message.text, { tag: '[queued]' }));
              transcript.persist({
                ...eventBase('user.message', durableTurnId),
                text: materialized.text,
              });
            }
            return await Promise.all(
              forModel.map(async (message) => {
                const materialized = materializePastedLine(message.text, message.attachments);
                return {
                role: 'user' as const,
                content: materialized.text,
                attachments: await encodePasted(materialized.attachments),
                };
              }),
            );
          },
          activateProfile: async (name) => {
            const loaded = await loadStoredConfig(engine.paths);
            const stored = credentials
              ? await migrateCredentialsForWrite(loaded, credentials)
              : Object.keys(storedProviderCredentials(loaded, providerIdForConfig(loaded) ?? '')).length > 0
                ? undefined
                : loaded;
            if (!stored) throw new Error('profile was not saved because credential migration failed');
            const profile = profilesOf(stored)[name];
            if (!profile) throw new Error(`unknown profile ${name}`);
            const modelOptions = profile.model ? { model: profile.model } : {};
            const providerId = providerIdForConfig(stored, modelOptions) ?? '';
            const savedKey = await providerCredential(credentials, providerId, stored);
            const config = resolveConfig(stored, {
              ...modelOptions,
              ...(savedKey ? { apiKey: savedKey } : {}),
            });
            providerRef.current = createModelProvider(config, {
              capabilityCache,
              bus: engine.bus,
            });
            await saveStoredConfig(engine.paths, { ...stored, activeProfile: name });
            dispatch({
              type: 'context',
              used: estimateTokens(conversation.current),
              max: providerRef.current.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
            });
          },
          setGoal: async (condition) => {
            await goalControllerRef.current?.setModelGoal(condition);
            syncGoalRef();
            push(entry('notice', 'goal recorded by agent', {
              tone: 'accent',
              subtitle: condition,
            }));
          },
        },
      );

      // Carry the exchange forward so the next message has the context. The
      // system prompt is rebuilt each turn rather than stored, so a container
      // swap is reflected immediately.
      conversation.current = result.messages.slice(1);
      activeConversation.current = structuredClone(conversation.current);
      if (result.stop === 'cancelled') loadingResult = 'cancelled';
      else if (result.stop !== 'complete' || result.error) loadingResult = 'error';
      else goalRoundEligible = true;

      // conversation.event is emitted synchronously by the loop, but the
      // session append is real asynchronous I/O. Commit it before closing the
      // live stream; no sleep is needed because this waits on the actual write.
      await transcript.flushPersistence();
      if (result.stop === 'complete' && result.conversationState) {
        // The transcript remains canonical. This sidecar is only a provider
        // continuation pointer, so a failed optimization write must never
        // turn a successful model answer into a failed user turn.
        try {
          const activeSession = await transcript.resolveSession();
          await activeSession?.saveConversationState(result.conversationState);
        } catch {
          push(entry('notice', 'native conversation state was not saved; transcript replay remains available', {
            tone: 'warn',
          }));
        }
      }
      const streamed = agentRow.current !== null;
      closeAnswer();
      // Only as a fallback. A provider that streams has already put every word
      // on screen, and pushing `result.text` as well would print the answer a
      // second time — it is the concatenation of every turn, including the ones
      // already shown above their tool calls.
      if (!streamed && result.text.trim()) {
        push(entry('answer', result.text.trim()));
      }

      if (result.stop !== 'complete') {
        if (result.stop === 'cancelled') settleRetry('cancelled');
        push(
          entry('notice', `stopped: ${result.stop}`, {
            tone: result.stop === 'cancelled' ? 'muted' : 'warn',
          }),
        );
      }
      if (effortRef.current === 'plif' && result.stop === 'max_iterations') {
        push(entry('notice', 'PLIF turn limit reached', {
          tone: 'warn',
          subtitle: 'The turn was capped at 50 cycles to protect the session. Type /continue to resume from the saved transcript.',
        }));
      }
      if (effortRef.current === 'plif' && result.iterations > 3) {
        const metrics = turnMetricsRef.current?.turnId === durableTurnId
          ? turnMetricsRef.current
          : null;
        const timing = metrics
          ? ` · wall ${formatDuration(Date.now() - metrics.startedAt)} · reasoning ${formatDuration(metrics.reasoningMs)} · tools ${formatDuration(metrics.toolsMs)} · compaction ${formatDuration(metrics.compactionMs)}`
          : '';
        push(entry('notice', `PLIF turn report · ${result.iterations} cycles`, {
          tone: 'accent',
          subtitle: `${result.toolCalls} tool calls · ${result.retries} retries · ${formatCount(result.promptTokens)} input tokens · ${formatCount(result.completionTokens)} output tokens${timing}`,
        }));
      }
      if (result.error) {
        const recovered = await recoverModelAuth(result.error);
        if (!recovered) {
          const { title, detail } = formatError(result.error);
          push(entry('step', title, { status: 'failed', tone: 'danger', ...(detail ? { detail } : {}) }));
        }
      }
    } catch (error) {
      loadingResult = abort.signal.aborted ? 'cancelled' : 'error';
      if (conversation.current === carried) conversation.current = outgoing;
      activeConversation.current = structuredClone(conversation.current);
      const recovered = await recoverModelAuth(error);
      if (!recovered) {
        const { title, detail } = formatError(error);
        push(
          entry('step', title, { status: 'failed', tone: 'danger', ...(detail ? { detail } : {}) }),
        );
      }
    } finally {
      execAbort.current = null;
      if (loadingOperationRef.current?.id === loadingOperationId) {
        // Some OpenAI-compatible providers omit the final usage chunk. Flush
        // the real streamed delta estimate before hiding the loading row so a
        // short response is not reported as zero simply because it completed
        // before the 360ms low-rate metric sample.
        activityModel.tokens(
          loadingOperationId,
          completionMeterRef.current.tokens,
          completionMeterRef.current.estimated,
        );
        if (loadingResult === 'error') activityModel.fail(loadingOperationId, 'request failed');
        activityModel.finish(loadingOperationId, loadingResult);
        loadingOperationRef.current = null;
        setAgentTurnStartedAt(null);
      }
      // The final assistant event may still be on the persistence queue on an
      // error or cancellation path. Await that queue before any stream cleanup
      // and only then release the turn pointer.
      await transcript.flushPersistence();
      // Also on the error and cancel paths: whatever the model managed to say
      // before it broke is worth keeping on screen, and a row left `active`
      // would spin forever and never reach scrollback.
      closeAnswer();
      closeThinking();
      transcript.finishTurn(durableTurnId);
      activeConversation.current = null;
      if (abort.signal.aborted) {
        const goal = goalControllerRef.current?.get();
        if (goal?.status === 'active' && goal.armed) {
          await goalControllerRef.current?.pause('paused by user cancellation');
          syncGoalRef();
        }
      } else if (goalRoundEligible && mode === 'normal') {
        const next = await goalControllerRef.current?.startRound();
        syncGoalRef();
        if (next) {
          const roundPrompt =
            `[goal round ${next.rounds}/${next.maxRounds} — continue this objective: ${next.condition}\n` +
            'Read the current plan (.plif/plans/) and NOTES first. Do the single most useful next step. ' +
            'When the objective is genuinely achieved, call complete_goal with evidence (commands/results). ' +
            'When the same blocker has persisted for 3 rounds, call block_goal with the concrete reason. ' +
            'Do not recap past rounds.]';
          const timer = setTimeout(() => {
            const currentGoal = goalControllerRef.current?.get();
            if (currentGoal?.status === 'active' && currentGoal.armed) {
              void runAgent(roundPrompt, [], undefined, 'normal');
            }
          }, 25);
          timer.unref?.();
        }
      }
      // Still open here means the turn ended without the endpoint ever
      // answering — the retry budget ran out or the endpoint failed permanently.
      settleRetry('gave up');
      compactionSince.current = null;
      dispatch({ type: 'compaction.end' });
      // A skill the turn just wrote is already in the registry; this is what
      // puts it in the browser without waiting for a restart.
      if (skillRegistry) setSkillList(skillRegistry.list());
    }
  }

  async function runExec(line: string, shareWithAgent = false): Promise<void> {
    const container = current.current;
    if (!container) {
      push(
        entry('step', 'no active container', {
          status: 'failed',
          tone: 'danger',
          detail: 'Run /new to create one, then type commands to run inside it.',
        }),
      );
      return;
    }

    const argv = tokenize(line);
    const commandId = randomUUID();
    if (shareWithAgent) {
      await transcript.persist({
        ...eventBase('command.input', commandId),
        execId: commandId,
        argv,
        cwd: container.workdir,
        interactive: false,
      });
    }
    const running = entry('step', line, { status: 'active' });
    pendingRow.current = running.id;
    push(running);

    const abort = new AbortController();
    execAbort.current = abort;

    try {
      const result = await container.exec({
        argv,
        reason: 'typed at the plif prompt',
        signal: abort.signal,
      });
      dispatch({
        type: 'update',
        id: running.id,
        patch: {
          status: result.exitCode === 0 && !result.killedBy ? 'done' : 'failed',
          tag: formatExecTag(result),
          // Prefer the authoritative captured output over the streamed buffer:
          // it carries the stderr labelling and the truncation notice.
          detail: formatExecOutput(result),
        },
      });
      if (shareWithAgent) {
        const killedBy = result.killedBy === 'timeout' || result.killedBy === 'memory' ||
          result.killedBy === 'processes' || result.killedBy === 'cancelled'
          ? result.killedBy
          : undefined;
        await transcript.persist({
          ...eventBase('command.completed', commandId),
          execId: commandId,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
          durationMs: result.durationMs,
          ...(killedBy ? { killedBy } : {}),
        });
      }
      if (shareWithAgent) {
        await runAgent(
          `[user-executed-command]\n$ ${line}\n${formatExecOutput(result)}`,
        );
      }
    } catch (error) {
      // Resolve the row here rather than letting it bubble to `submit`. An
      // exec that is refused still has a row on screen, and leaving it spinning
      // as `active` forever is a worse lie than any error message.
      const { title, detail } = formatError(error);
      dispatch({
        type: 'update',
        id: running.id,
        patch: {
          status: 'failed',
          tone: 'danger',
          tag: '[denied]',
          detail: detail ? `${title}\n${detail}` : title,
        },
      });
      if (shareWithAgent) {
        const failure = container.redactSensitiveOutput([title, detail].filter(Boolean).join('\n'));
        await transcript.persist({
          ...eventBase('command.completed', commandId),
          execId: commandId,
          exitCode: 1,
          stdout: '',
          stderr: failure,
          truncated: false,
          durationMs: 0,
        });
      }
    } finally {
      execAbort.current = null;
      stream.current = { rowId: null, text: '', dirty: false };
    }
  }


  /**
   * Take a screenshot off the clipboard and attach it.
   *
   * The token goes into the text so the developer can see and position it, and
   * so the model has something to refer to — "the error in [Image Pasted #1]"
   * is a sentence; a bare picture appended to a message is not.
   */
  function addPasted(attachment: PastedDraft): void {
    const token = pastedContentToken(
      pasteCount.current += 1,
      attachment.kind === 'text' ? attachment.text : undefined,
    );
    composerDispatch({
      type: 'attachment.paste',
      attachment: { ...attachment, token } as PastedAttachment,
    });
  }

  async function attachImageFiles(paths: readonly string[]): Promise<number> {
    let attached = 0;
    for (const candidate of paths) {
      const stat = await fs.stat(candidate).catch(() => null);
      if (!stat?.isFile() || stat.size === 0) continue;
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        push(
          entry('notice', `${path.basename(candidate)} is too large to attach`, {
            tone: 'warn',
            subtitle: `${(stat.size / 1024 / 1024).toFixed(1)}MB, over the ${
              MAX_ATTACHMENT_BYTES / 1024 / 1024
            }MB limit`,
          }),
        );
        continue;
      }
      addPasted({
        kind: 'image',
        path: candidate,
        mediaType: mediaTypeOf(candidate),
        bytes: stat.size,
      });
      attached += 1;
    }
    return attached;
  }

  function acceptPastedText(text: string): void {
    if (!text) return;
    if (shouldAttachPastedText(text)) {
      addPasted({ kind: 'text', text });
      return;
    }
    composerDispatch({ type: 'insert', text });
  }

  async function receivePastedContent(text: string): Promise<void> {
    const images = imagePathsInPaste(text);
    if (images.length > 0 && (await attachImageFiles(images)) > 0) return;
    if (text) {
      acceptPastedText(text);
      return;
    }
    await pasteImage({ quiet: true });
  }

  async function pasteImage({ quiet = false }: { quiet?: boolean } = {}): Promise<void> {
    try {
      const image = await readClipboardImage(tempDir);
      if (image) {
        addPasted({ kind: 'image', path: image.path, mediaType: image.mediaType, bytes: image.bytes });
        return;
      }
      const raw = await readClipboardText();
      const text = raw ? sanitizePastedText(raw) : '';
      if (!text) {
        if (!quiet) {
          push(
            entry('notice', 'nothing to paste', {
              tone: 'muted',
              subtitle: 'the clipboard has no supported content',
            }),
          );
        }
        return;
      }
      const images = imagePathsInPaste(text);
      if (images.length > 0 && (await attachImageFiles(images)) > 0) return;
      acceptPastedText(text);
    } catch (error) {
      const { title, detail } = formatError(error);
      push(entry('notice', title, { tone: 'warn', ...(detail ? { detail } : {}) }));
    }
  }

  /** Remove the queued message the arrows are pointing at. */
  function dropQueued(): void {
    const target = state.queue[Math.min(queuedIndex, state.queue.length - 1)];
    if (!target) return;
    dispatch({ type: 'queue.drop', id: target.id });
    setQueuedIndex((value) => Math.max(0, Math.min(value, state.queue.length - 2)));
  }

  /** Stop the command in flight without tearing down the container. */
  function cancelRunning(): boolean {
    if (!execAbort.current) return false;
    const activeLoading = loadingOperationRef.current;
    if (activeLoading) activityModel.phase(activeLoading.id, 'cancelling');
    execAbort.current.abort();
    current.current?.cancelRunning();
    // An outstanding question belongs to the work being cancelled. Leaving it
    // on screen would ask the developer to answer for a turn that has already
    // stopped, and leave the broker holding a promise nothing will resolve.
    engine.questions.abandonAll();
    push(entry('notice', 'cancelled', { tone: 'warn' }));
    return true;
  }

  function armInterrupt(): void {
    setInterruptArmed(true);
    if (interruptTimer.current) clearTimeout(interruptTimer.current);
    interruptTimer.current = setTimeout(() => setInterruptArmed(false), DOUBLE_INTERRUPT_MS);
    interruptTimer.current.unref?.();
  }

  // ---- completions -------------------------------------------------------

  /**
   * The `::` emoji menu, if the cursor is inside an unclosed one.
   *
   * Suppressed while a dialog owns the keyboard, for the same reason the
   * command menu is: a list the keys do not reach is a list that lies about
   * what Tab will do.
   */
  const shortcode =
    !state.busy && !state.screen && !state.approval && !state.question && !state.picker
      ? openShortcode(input, cursor)
      : null;
  const emojiMatches = shortcode ? matchEmoji(shortcode.fragment) : [];
  const showEmoji = emojiMatches.length > 0;

  /** Put the chosen emoji where the `::…` was, and carry on typing. */
  function applyEmoji(entry: { emoji: string }): void {
    if (!shortcode) return;
    const next = input.slice(0, shortcode.start) + entry.emoji + input.slice(cursor);
    setInput(next);
    // Code units, not code points: every other index in the input handling is
    // a UTF-16 offset, and mixing the two put the cursor between the halves of
    // a surrogate pair — which the terminal drew as two replacement boxes.
    setCursor(shortcode.start + entry.emoji.length);
    setEmojiIndex(0);
  }

  const typedCommand = commandPrefix(input);
  const typedCommandName = typedCommand === null ? null : tokenize(input.slice(1))[0] ?? '';
  const argumentCompletion = typedCommandName && !state.approval
    ? matchArgumentCompletions(input, cursor, context)
    : null;
  const argumentMatches = argumentCompletion?.matches ?? [];
  const completions: Command[] =
    argumentCompletion
      ? []
      : typedCommand !== null && !state.approval
        ? matchCommands(typedCommand)
        : [];
  const typedCommandRunsNow = typedCommandName !== null && runsWhileWorking(typedCommandName);
  // Keep the selected command visible while its arguments are being typed.
  // The old space check made the menu vanish exactly when `/model ` or
  // `/mcp ` became useful, and made the prompt look like it had eaten input.
  const completionCount = argumentCompletion ? argumentMatches.length : completions.length;
  const showCompletions = completionCount > 0;
  // Prose prediction is deliberately a single inline ghost. It never adds
  // rows to the TUI and never competes with slash-command/emoji selectors.
  const localMatches: readonly LocalSuggestion[] = !showCompletions && !showEmoji && !state.screen && !state.browser && !state.approval && !state.question && !state.picker
    ? suggestLocal(input, cursor, {
        settings: localAssistance,
        history: history.current.recent(),
        commands: matchCommands('').map((command) => command.name),
        projectVocabulary: cwd.split(/[\\\/._-]+/g),
      })
    : [];
  const inlineSuggestion = localMatches[0];
  const inlineGhostText = inlineSuggestionSuffix(input, cursor, inlineSuggestion);
  const showInlineSuggestion = inlineGhostText.length > 0;
  // An exact command row is informational; there is no alternative for the
  // arrows to choose. Let Up/Down recall history in `/effort` and similar
  // states, while argument menus and ambiguous prefixes still own the keys.
  const completionOwnsArrows = showCompletions
    ? !(
        argumentCompletion === null &&
        completions.length === 1 &&
        typedCommandName !== null &&
        isExactCommandMatch(completions[0]!, typedCommandName)
      )
    : false;

  function applyCompletion(command: Command): void {
    const completed = `/${command.name} `;
    setInput(completed);
    setCursor(completed.length);
    setCompletionIndex(0);
  }

  function applyArgumentCompletion(value: string): void {
    if (!argumentCompletion) return;
    const completed = input.slice(0, argumentCompletion.tokenStart) + value + input.slice(argumentCompletion.tokenEnd);
    setInput(completed);
    setCursor(argumentCompletion.tokenStart + value.length);
    setCompletionIndex(0);
  }

  function applyArgumentCompletionWithTab(): void {
    if (!argumentCompletion) return;
    const value = tabArgumentCompletion(argumentCompletion);
    if (value) applyArgumentCompletion(value);
  }

  function applyInlineSuggestion(): void {
    if (!inlineSuggestion) return;
    const next = applyLocalSuggestion(input, cursor, inlineSuggestion);
    setInput(next.text);
    setCursor(next.cursor);
    setCompletionIndex(0);
  }

  // ---- keyboard ----------------------------------------------------------

  const pasteStream = useRef<PasteState>(IDLE_PASTE);
  const { internal_eventEmitter: inputEvents } = useStdin();
  const rawInputRef = useRef<string | null>(null);

  // Ink 5 exposes both the DEL byte (the normal Windows Backspace) and the
  // actual Delete escape sequence as key.delete. Capture the raw event before
  // Ink normalizes it so the editor can keep both directions correct.
  useEffect(() => {
    const captureRawInput = (data: unknown): void => {
      rawInputRef.current = typeof data === 'string' ? data : String(data);
    };
    inputEvents.on('input', captureRawInput);
    return () => {
      inputEvents.removeListener('input', captureRawInput);
    };
  }, [inputEvents]);

  function receivePastedText(raw: string): void {
    const text = sanitizePastedText(raw);
    const firstLine = text.split('\n')[0] ?? '';

    if (btwInput) {
      if (firstLine) {
        setBtwInput((previous) => previous
          ? {
              draft: previous.draft.slice(0, previous.cursor) + firstLine + previous.draft.slice(previous.cursor),
              cursor: previous.cursor + firstLine.length,
            }
          : previous);
      }
      return;
    }
    if (state.browser) {
      if (firstLine) dispatch({ type: 'browser.filter', filter: state.browser.filter + firstLine });
      return;
    }
    if (state.screen?.kind === 'config') {
      if (firstLine) dispatch({ type: 'config.filter', filter: state.screen.state.filter + firstLine });
      return;
    }
    if (state.screen?.kind === 'status') return;
    if (state.approval) return;
    if (state.question) {
      if (firstLine) dispatch({ type: 'question.draft', draft: state.questionDraft + firstLine });
      return;
    }
    if (state.picker) {
      if (firstLine) dispatch({ type: 'picker.filter', filter: state.picker.filter + firstLine });
      return;
    }
    void receivePastedContent(text);
  }

  const workDockOpen = tasksOpen || state.subagentsOpen;
  const transcriptOverlayOpen = transcriptViewport.open || thinkingViewport.open;
  // Stream frames still update the canonical transcript for Ctrl+R and the
  // transcript overlay, but the normal shell does not need to measure every
  // transcript cell while those overlays are closed. That projection used to
  // run for every 33 ms stream frame even though it could not affect the view.
  const transcriptCells = transcriptOverlayOpen
    ? allTranscriptCells(transcript.state)
    : EMPTY_TRANSCRIPT_CELLS;
  const transcriptBodyHeight = Math.max(1, surface.panelHeight - 2);
  const transcriptContentLines = transcriptOverlayOpen
    ? measureTranscriptCells(transcriptCells, width)
    : 0;
  const thinkingDoc = useMemo(
    () => thinkingViewport.open
      ? thinkingDocument(thoughtBlocks(transcriptCells), Math.max(16, width - 6))
      : emptyThinkingDocument,
    [thinkingViewport.open, transcriptCells, width],
  );
  const thinkingRows = thinkingBodyHeight(surface.panelHeight);
  const thinkingLines = thinkingDoc.lines.length;

  useEffect(() => {
    if (!thinkingViewport.open) return;
    dispatchThinkingViewport({
      type: 'content',
      contentLines: thinkingLines,
      height: thinkingRows,
    });
  }, [thinkingViewport.open, thinkingLines, thinkingRows]);

  useEffect(() => {
    if (!transcriptViewport.open) return;
    dispatchTranscriptViewport({
      type: 'resize',
      contentLines: transcriptContentLines,
      height: transcriptBodyHeight,
    });
  }, [
    transcriptViewport.open,
    transcriptContentLines,
    transcriptBodyHeight,
    width,
    rows,
  ]);

  function setWorkDockOpen(open: boolean): void {
    if (tasks.length > 0) setTasksOpen(open);
    if (state.subagents.length > 0 && state.subagentsOpen !== open) {
      dispatch({ type: 'subagent.toggle' });
    }
  }

  function cycleActivityHud(): void {
    const next: ActivityHudMode = activityHudMode === 'closed'
      ? 'compact'
      : activityHudMode === 'compact'
        ? 'expanded'
        : 'compact';
    setActivityHudMode(next);
    setWorkDockOpen(next === 'expanded');
  }

  function pastedTextAtMouse(mouse: { readonly column: number; readonly row: number }): string | null {
    if (pasted.length === 0) return null;

    const bodyRows = visiblePromptRows(
      layoutPrompt(input, cursor, Math.max(8, surface.contentWidth - 8)),
      promptRows,
    );
    const framePromptHeight = promptHeight({
      bodyRows: promptRows,
      footerRows: promptFooterRows,
      queueRows: promptQueueRows,
    });
    // The prompt is bottom-anchored inside the panel. Coordinates are one-based
    // in SGR, and the first body row follows the frame's top rule.
    const promptTop = surface.panelHeight - surface.panelPaddingY - footerRows - framePromptHeight + 1;
    const row = bodyRows[mouse.row - promptTop - 1];
    if (!row) return null;

    // Frame border + vertical rail + inner gutter + the two-cell prompt glyph.
    const draftColumn = surface.panelPaddingX + 5;
    for (const attachment of pasted) {
      if (attachment.kind !== 'text') continue;
      const tokenStart = input.indexOf(attachment.token);
      if (tokenStart < 0) continue;
      const tokenEnd = tokenStart + attachment.token.length;
      const overlapStart = Math.max(row.start, tokenStart);
      const overlapEnd = Math.min(row.end, tokenEnd);
      if (overlapStart >= overlapEnd) continue;
      const cellStart = draftColumn + displayWidth(input.slice(row.start, overlapStart));
      const cellEnd = draftColumn + displayWidth(input.slice(row.start, overlapEnd));
      if (mouse.column >= cellStart && mouse.column < cellEnd) return attachment.text;
    }
    return null;
  }

  function questionChoiceAtMouse(mouse: { readonly row: number }): number | null {
    const question = state.question;
    if (!question) return null;

    // The live surface follows the append-only header. Its top is therefore a
    // stable terminal row even after the transcript has scrolled above it.
    // Timeline and Question share the same row-budget helpers used to render
    // the frame, avoiding a second hand-written layout model for hit-testing.
    const transcriptRows = timelineVisibleHeight(
      state.entries,
      surface.contentWidth,
      timelineBudget,
    );
    const questionTop = headerHeight(headerAvailableWidth)
      + surface.panelPaddingY
      + transcriptRows;
    const localRow = mouse.row - questionTop - 1;
    return questionChoiceAtRow(question, localRow, compactDialogs, state.questionExpanded);
  }

  function handleMouse(mouse: { readonly button: number; readonly action: string; readonly column: number; readonly row: number }): void {
    if ((mouse.action !== 'press' && mouse.action !== 'move') || pastedTextPopup) return;
    if (mouse.action === 'move' && !state.question) return;
    if (state.screen || state.browser || state.approval || state.picker || credentialPromptPending || codexLogin) return;

    if (state.question) {
      if (mouse.action === 'move' && mouse.button !== 0) return;
      const selected = questionChoiceAtMouse(mouse);
      if (selected !== null) {
        dispatch({ type: 'question.select', selected });
      }
      return;
    }

    const sequence = nextClickSequence(pastedClick.current, mouse, Date.now());
    pastedClick.current = sequence.count >= 3 ? EMPTY_CLICK_SEQUENCE : sequence;
    if (sequence.count !== 3) return;

    const text = pastedTextAtMouse(mouse);
    if (text !== null) setPastedTextPopup({ text });
  }

  useInput((char, key) => {
    if (state.exiting) return;

    // Ink strips the leading ESC from unknown sequences. Classify SGR before
    // the paste/composer pipeline, and replay only candidates that proved to
    // be ordinary printable text.
    const mouseRead = mouseReader.current.read(char);
    if (mouseRead.handled) {
      if (mouseRead.event) handleMouse(mouseRead.event);
      if (mouseRead.text) handleKey(mouseRead.text, key);
      return;
    }

    if (!pasteStream.current.open && !hasPasteMarker(char)) {
      handleKey(char, key);
      return;
    }

    const read = readPasteChunk(pasteStream.current, char);
    pasteStream.current = read.state;
    for (const segment of read.segments) {
      if (segment.pasted) receivePastedText(segment.text);
      else handleKey(segment.text, key);
    }
  });

  function handleKey(char: string, key: Key): void {
    if (state.exiting) return;
    const rawInput = rawInputRef.current;
    rawInputRef.current = null;
    const deleteAction = editorDeleteAction(key, rawInput);

    if (pastedTextPopup) {
      if (key.escape || (key.ctrl && char === 'c')) setPastedTextPopup(null);
      return;
    }

    if (codexLogin) {
      if (key.escape || (key.ctrl && char === 'c')) void cancelCodexLogin();
      return;
    }

    if (state.screen) {
      handleConfigKey(char, key);
      return;
    }

    // The browser is a full-screen view and owns every key while it is up.
    // Letting the prompt underneath see them would type into a field nobody
    // can see, and Enter there would send it.
    if (state.browser) {
      handleBrowserKey(char, key);
      return;
    }

    // The approval dialog owns the keyboard while it is up. Routing keys to the
    // prompt underneath would let a stray Enter answer a security question.
    if (state.approval) {
      handleApprovalKey(char, key);
      return;
    }

    // And so does a question, for the same reason and one more: the answer is
    // free text, so every printable key belongs to it. Ctrl+E is the one
    // exception, because reading the full proposal is part of answering.
    if (state.question) {
      handleQuestionKey(char, key);
      return;
    }

    // Startup credential resolution is a modal gate even during the tiny
    // interval between asking the broker and rendering its question. Without
    // this guard, a greeting typed during that race becomes a normal turn and
    // Escape/cancel abandons the credential before it can be remembered.
    if (credentialPromptPending) return;

    if (state.picker) {
      handlePickerKey(char, key);
      return;
    }

    // BTW owns only its own draft. It is deliberately checked before the
    // busy/queue branch so Enter starts a side request rather than queuing or
    // cancelling the primary turn.
    if (btwInput) {
      handleBtwInputKey(char, key, deleteAction);
      return;
    }

    if (thinkingViewport.open) {
      const metrics = { contentLines: thinkingLines, height: thinkingRows };
      if (isControlShortcut(char, key, 'r') || key.escape) {
        dispatchThinkingViewport({ type: 'close' });
        return;
      }
      if (key.upArrow || key.downArrow) {
        dispatchThinkingViewport({ type: 'line', delta: key.upArrow ? -1 : 1, ...metrics });
        return;
      }
      if (key.pageUp || key.pageDown) {
        dispatchThinkingViewport({ type: 'page', delta: key.pageUp ? -1 : 1, ...metrics });
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        dispatchThinkingViewport({
          type: 'to',
          offset: blockJumpOffset(thinkingDoc, thinkingViewport.offset, key.rightArrow ? 1 : -1),
          ...metrics,
        });
        return;
      }
      if ((key.ctrl && char === 'end') || isControlShortcut(char, key, 'e')) {
        dispatchThinkingViewport({ type: 'end', ...metrics });
        return;
      }
      if (key.ctrl && char === 'a') {
        dispatchThinkingViewport({ type: 'home', ...metrics });
        return;
      }
      if (!(key.ctrl && char === 'c')) return;
    }

    if (transcriptViewport.open) {
      const metrics = {
        contentLines: transcriptContentLines,
        height: transcriptBodyHeight,
      };
      if (isControlShortcut(char, key, 't') || key.escape) {
        dispatchTranscriptViewport({ type: 'close' });
        return;
      }
      if (key.upArrow || key.downArrow) {
        dispatchTranscriptViewport({ type: 'line', delta: key.upArrow ? -1 : 1, ...metrics });
        return;
      }
      if (key.pageUp || key.pageDown) {
        dispatchTranscriptViewport({ type: 'page', delta: key.pageUp ? -1 : 1, ...metrics });
        return;
      }
      // Ink exposes Ctrl+End as the parsed key name `end` with ctrl=true.
      // Ctrl+E remains the short equivalent for terminals that do not emit a
      // distinct End sequence.
      if ((key.ctrl && char === 'end') || isControlShortcut(char, key, 'e')) {
        dispatchTranscriptViewport({ type: 'end', ...metrics });
        return;
      }
      if (key.ctrl && char === 'a') {
        dispatchTranscriptViewport({ type: 'home', ...metrics });
        return;
      }
      // Ctrl+C remains global; every other key belongs to the overlay.
      if (!(key.ctrl && char === 'c')) return;
    }

    if (isControlShortcut(char, key, 'e')) {
      dispatch({ type: 'toggleLastTool' });
      return;
    }
    if (isControlShortcut(char, key, 'r')) {
      dispatchThinkingViewport({
        type: 'open',
        contentLines: thinkingLines,
        height: thinkingRows,
      });
      return;
    }
    if (key.ctrl && char === 's' && (state.busy || tasks.length > 0 || state.subagents.length > 0)) {
      cycleActivityHud();
      return;
    }
    if (key.ctrl && char === 'x' && state.subagents.length > 0) {
      const selected = state.subagents[Math.min(state.subagentFocus, state.subagents.length - 1)];
      if (selected && subagents.current.cancel(selected.taskId)) return;
    }
    // The inline predictor owns Tab before any secondary navigation. This is
    // the only key that accepts a prose suggestion; Enter always submits.
    if (key.tab && showInlineSuggestion && !showCompletions && !showEmoji) {
      applyInlineSuggestion();
      return;
    }

    // Tab cycles subagent tabs whenever it is not completing a command. While
    // the agent is working there is nothing to complete, which is exactly when
    // there are subagents to look at.
    if (key.tab && state.subagents.length > 1 && !showCompletions) {
      dispatch({ type: 'subagent.focus', delta: key.shift ? -1 : 1 });
      return;
    }

    if (key.escape && (workDockOpen || (state.busy && activityHudMode !== 'closed'))) {
      setActivityHudMode('closed');
      setWorkDockOpen(false);
      return;
    }
    if (isControlShortcut(char, key, 't')) {
      dispatchTranscriptViewport({
        type: 'open',
        contentLines: transcriptContentLines,
        height: transcriptBodyHeight,
      });
      return;
    }

    if (key.ctrl && char === 'c') {
      // Interrupt means "stop what is running", the way it does in every other
      // shell. Only when there is nothing to stop does it become "quit", and
      // even then it asks for confirmation rather than dropping the session.
      if (cancelRunning()) return;
      if (interruptArmed) {
        context.exit();
      } else {
        armInterrupt();
      }
      return;
    }

    // Paste an image out of the clipboard. Works whether or not the agent is
    // busy, because a screenshot is often exactly what the queued follow-up is
    // about.
    if (key.ctrl && char === 'v') {
      void pasteImage();
      return;
    }

    // The emoji menu owns Tab, Enter and the arrows while it is open, in both
    // modes — a queued message deserves the same input as a sent one.
    if (showEmoji) {
      if (key.tab || key.return) {
        const picked = emojiMatches[emojiIndex];
        if (picked) {
          applyEmoji(picked);
          return;
        }
      }
      if (key.upArrow || key.downArrow) {
        setEmojiIndex((value) =>
          key.upArrow
            ? Math.max(0, value - 1)
            : Math.min(emojiMatches.length - 1, value + 1),
        );
        return;
      }
      if (key.escape) {
        // Close the menu without touching the text. The developer may well
        // have meant the colon.
        setEmojiIndex(-1);
        return;
      }
    }

    if (key.return && key.shift) {
      setInput(input.slice(0, cursor) + '\n' + input.slice(cursor));
      setCursor(cursor + 1);
      setCompletionIndex(0);
      return;
    }

    // Ctrl+A is an editor operation, not a terminal command. Keeping the
    // selection in the composer reducer makes Ctrl+A + Backspace and typing a
    // replacement mutate the same canonical draft that Enter will submit.
    if (key.ctrl && char === 'a') {
      composerDispatch({ type: 'select.all' });
      setCompletionIndex(0);
      return;
    }

    /*
      Working is not a reason to stop listening.

      The old behaviour swallowed every keystroke while the agent ran, which
      left one way to add something you had just remembered: Escape, killing
      work that was fine, and starting over. So typing carries on, and Enter
      files the line to be handed over at the next tool call rather than
      interrupting the turn.
    */
    if (state.busy) {
      if (key.escape) {
        // Two stages, and the order matters. Escape with something typed is
        // "scrap that line"; Escape on an empty prompt is "stop the agent".
        // One key that always cancelled the run would eventually eat a turn
        // because someone wanted to clear a typo.
        if (input) {
          setInput('');
          setCursor(0);
        } else {
          cancelRunning();
        }
        return;
      }
      if (key.ctrl && char === 'x') {
        dropQueued();
        return;
      }
      if (key.tab) {
        if (argumentCompletion) {
          applyArgumentCompletionWithTab();
          return;
        }
        const picked = completions[completionIndex];
        if (showCompletions && picked) applyCompletion(picked);
        return;
      }
      if ((key.upArrow || key.downArrow) && completionOwnsArrows) {
        const limit = completionCount;
        setCompletionIndex((value) =>
          key.upArrow
            ? Math.max(0, value - 1)
            : Math.min(limit - 1, value + 1),
        );
        return;
      }
      if (key.return) {
        if (showCompletions && completions.length > 0 && completionIndex >= 0) {
          const picked = completions[completionIndex];
          const sameCommand = picked && (
            picked.name === typedCommandName || picked.aliases?.includes(typedCommandName ?? '')
          );
          if (picked && !sameCommand) {
            applyCompletion(picked);
            return;
          }
        }
        submitCurrentComposer();
        return;
      }
      if ((key.upArrow || key.downArrow) && state.queue.length > 0) {
        // Arrows pick which queued line Ctrl+X will drop. There is no history
        // to recall into a queued message, so they are free.
        setQueuedIndex((value) =>
          key.upArrow
            ? Math.max(0, value - 1)
            : Math.min(state.queue.length - 1, value + 1),
        );
        return;
      }
      // Everything else falls through to the editing keys below.
    } else {
      if (interruptArmed) setInterruptArmed(false);

      if (key.return) {
        // Enter takes the highlighted completion rather than running a partial
        // command — the menu is on screen, so the highlight is what the user is
        // looking at.
        if (showCompletions && completions.length > 0 && completionIndex >= 0) {
          const picked = completions[completionIndex];
          const sameCommand = picked && (
            picked.name === typedCommandName || picked.aliases?.includes(typedCommandName ?? '')
          );
          if (picked && !sameCommand) {
            applyCompletion(picked);
            return;
          }
        }
        submitCurrentComposer();
        return;
      }

      if (key.tab) {
        if (argumentCompletion) {
          applyArgumentCompletionWithTab();
          return;
        }
        const picked = completions[completionIndex];
        if (showCompletions && picked) applyCompletion(picked);
        return;
      }

      if (key.upArrow || key.downArrow) {
        // Arrows drive the menu when it is open, and history when it is not.
        if (completionOwnsArrows) {
          const limit = completionCount;
          setCompletionIndex((value) =>
            key.upArrow
              ? Math.max(0, value - 1)
              : Math.min(limit - 1, value + 1),
          );
          return;
        }
        const movedWithinDraft = verticalCursor(input, cursor, key.upArrow ? -1 : 1);
        if (movedWithinDraft !== null) {
          setCursor(movedWithinDraft);
          return;
        }
        if (history.current.size === 0) return;
        const recalled = key.upArrow
          ? history.current.previous(input)
          : history.current.next(input);
        setInput(recalled);
        setCursor(recalled.length);
        return;
      }
    }

    // Arrows move by whole character, not by code unit. One press should cross
    // an emoji, not land inside it.
    if (key.leftArrow) {
      setCursor((value) => stepLeft(input, value));
      return;
    }
    if (key.rightArrow) {
      setCursor((value) => stepRight(input, value));
      return;
    }
    if (key.escape) {
      setInput('');
      setCursor(0);
      setCompletionIndex(0);
      return;
    }
    if (deleteAction === 'backward') {
      const current = composerRef.current;
      if (current.cursor === 0 && current.selection === null) return;
      // Read and mutate the reducer state as one operation. Computing the
      // deletion from render-local input/cursor values makes repeated
      // Backspace events reuse the previous render and stall after one key.
      composerDispatch({ type: 'delete.backward' });
      setCompletionIndex(0);
      setEmojiIndex(0);
      return;
    }
    if (deleteAction === 'forward') {
      const current = composerRef.current;
      if (current.cursor >= current.draft.length && current.selection === null) return;
      composerDispatch({ type: 'delete.forward' });
      setCompletionIndex(0);
      setEmojiIndex(0);
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const pastedText = sanitizePastedText(char);
      if (isTerminalPaste(char) || pastedText.length >= PASTE_ATTACHMENT_MIN_CHARS || pastedText.includes('\n')) {
        void receivePastedContent(pastedText);
        return;
      }
      // A paste arrives as one chunk, not as N keypresses, so this branch must
      // cope with arbitrary text — including embedded newlines and control
      // bytes. Inserting the chunk raw would put a literal CR in the buffer and
      // silently corrupt the command.
      const text = pastedText;
      if (imagePathsInPaste(text).length > 0) {
        void receivePastedContent(text);
        return;
      }
      const raw = input.slice(0, cursor) + text + input.slice(cursor);
      // Resolve any shortcode the keystroke just closed, so `:sob:` becomes the
      // glyph the moment the second colon lands rather than waiting for Enter.
      const next = expandShortcodes(raw);
      const shrank = raw.length - next.length;
      // Composer assistance is prediction-only. Nothing is rewritten while
      // the user types; a suggestion is accepted explicitly with Tab.
      setInput(next);
      setEmojiIndex(0);
      setCursor((value) => Math.max(0, value + text.length - shrank));
      setCompletionIndex(0);
    }
  }

  function runSlashNow(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    const presentation = slashCommandPresentation(trimmed);
    setInput('');
    setCursor(0);
    setCompletionIndex(0);
    setPasted([]);
    if (presentation.remember) history.current.record(presentation.display);
    if (presentation.timeline && presentation.display) push(entry('input', presentation.display));
    void runSlash(trimmed).catch((error: unknown) => {
      const { title, detail } = formatError(error);
      push(entry('step', title, { status: 'failed', tone: 'danger', ...(detail ? { detail } : {}) }));
    });
  }

  function submitCurrentComposer(): void {
    const current = composerRef.current;
    const submission = submissionFromComposer(current);
    if (!submission) return;
    const line = expandShortcodes(submission.text);
    const commandName = commandPrefix(line);
    const command = commandName === null ? '' : tokenize(line.slice(1))[0] ?? '';
    if (state.busy && runsWhileWorking(command)) {
      runSlashSafely(line);
      return;
    }
    if (!state.busy && line.trim().startsWith('/')) {
      runSlashSafely(line);
      return;
    }
    sendLine(line, submission.attachments);
  }

  function runSlashSafely(line: string): void {
    const name = tokenize(line.trim().slice(1))[0]?.toLowerCase() ?? '';
    if (name === 'env') {
      runSlashNow(line);
      return;
    }
    void confirmSecretDraft(line).then((approved) => {
      if (approved) runSlashNow(line);
    });
  }

  function sendLine(line: string, attachments = composerRef.current.attachments): void {
    if (!state.busy && line.trim().startsWith('/')) {
      runSlashSafely(line);
      return;
    }
    if (state.busy) {
      const queued = line.trim();
      if (!queued && attachments.length === 0) return;
      const materialized = materializePastedLine(queued, attachments);
      void confirmSecretDraft(materialized.text).then((approved) => {
        if (!approved) return;
        dispatch({
          type: 'queue.push',
          message: { id: `q${Date.now()}`, text: queued, attachments: [...attachments] },
        });
        setPasted([]);
        setInput('');
        setCursor(0);
        setQueuedIndex(queueRef.current.length);
      });
      return;
    }
    void submit(line, attachments, true);
  }

  async function resumeBrowserSession(id: string): Promise<void> {
    if (state.busy) {
      push(entry('notice', 'finish the current turn before switching sessions', { tone: 'warn' }));
      return;
    }
    try {
      const next = await engine.sessions.resolve(cwd, id);
      if (!next) throw new PlifError('INVALID_ARGUMENT', `session "${id}" was not found`);
      // Resolve the encrypted environment before moving the transcript
      // pointer. If loading fails/changes session, the old session remains
      // visible and no new turn can observe a half-switched environment.
      const [history, contextReplay] = await Promise.all([
        next.history(),
        next.replay(),
        loadSessionEnvironment(next),
      ]);
      transcript.switchSession(next, history);
      conversation.current = conversationFromTranscript(contextReplay);
      // Rebuild the ordinary Ink scrollback, not a transcript dialog. The
      // reducer bumps Static's epoch so the newly selected session is printed
      // as a fresh terminal history, exactly like rows produced live.
      dispatch({ type: 'restore', entries: timelineEntriesFromEvents(history) });
      dispatch({ type: 'context', used: estimateTokens(conversation.current) });
      setTurn(countAgentTurns(history));
      setAgentTurnStartedAt(null);
      usage.current = emptySessionUsage;
      sessionStartedAt.current = Date.now();
      dispatch({ type: 'browser.close' });
      push(entry('notice', `resumed ${next.id}`, {
        tone: 'success',
        subtitle: `${history.length} stored events visible · ${conversation.current.length} recent messages in context`,
      }));
    } catch (error) {
      const { title, detail } = formatError(error);
      push(entry('notice', `could not resume ${id}`, {
        tone: 'danger',
        ...(detail ? { detail: `${title}\n${detail}` } : { detail: title }),
      }));
    }
  }

  async function renameBrowserSession(id: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) {
      dispatch({ type: 'browser.rename.cancel' });
      return;
    }
    try {
      const target = await engine.sessions.resolve(cwd, id);
      if (!target) throw new PlifError('INVALID_ARGUMENT', `session "${id}" was not found`);
      await target.rename(clean);
      dispatch({ type: 'browser.loading', loading: true });
      await openSessions();
    } catch (error) {
      const { title: errorTitle, detail } = formatError(error);
      push(entry('notice', `could not rename ${id}`, {
        tone: 'danger',
        detail: [errorTitle, detail].filter(Boolean).join('\n'),
      }));
      dispatch({ type: 'browser.rename.cancel' });
    }
  }

  async function deleteBrowserSession(id: string): Promise<void> {
    if (transcript.session?.id === id) {
      dispatch({ type: 'browser.confirmDelete', id: null });
      push(entry('notice', 'the current session cannot be deleted while it is open', { tone: 'warn' }));
      return;
    }
    try {
      const target = await engine.sessions.resolve(cwd, id);
      if (!target) throw new PlifError('INVALID_ARGUMENT', `session "${id}" was not found`);
      if (loadedEnvironmentSession.current === target.id) {
        applySessionEnvironment({});
        loadedEnvironmentSession.current = null;
      }
      await engine.sessions.remove(target.meta);
      dispatch({ type: 'browser.loading', loading: true });
      await openSessions();
    } catch (error) {
      const { title, detail } = formatError(error);
      push(entry('notice', `could not delete ${id}`, {
        tone: 'danger',
        detail: [title, detail].filter(Boolean).join('\n'),
      }));
      dispatch({ type: 'browser.confirmDelete', id: null });
    }
  }

  async function applyConfigSetting(setting: (typeof configSettings)[number], value: string): Promise<void> {
    if (!setting.apply) return;
    try {
      await setting.apply(value);
      await loadConfigSnapshot();
      dispatch({ type: 'config.edit.cancel' });
      dispatch({ type: 'config.feedback', message: `${setting.label} updated` });
    } catch (error) {
      const { title, detail } = formatError(error);
      dispatch({
        type: 'config.feedback',
        message: [title, detail].filter(Boolean).join(' · '),
      });
    }
  }

  function handleConfigKey(char: string, key: Key): void {
    const screen = state.screen;
    if (!screen) return;
    if (screen.kind === 'status') {
      if (key.escape || (key.ctrl && char === 'c')) dispatch({ type: 'screen.close' });
      return;
    }

    const editing = screen.state.editing;
    const setting = editing
      ? configSettings.find((item) => item.id === editing.id)
      : filteredConfigSettings[screen.state.selected];

    if (editing && setting) {
      if (key.escape || (key.ctrl && char === 'c')) {
        dispatch({ type: 'config.edit.cancel' });
        return;
      }
      if (key.return) {
        void applyConfigSetting(setting, editing.value);
        return;
      }
      if (setting.options && (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow)) {
        const index = setting.options.findIndex((item) => item.value === editing.value);
        const delta = key.upArrow || key.leftArrow ? -1 : 1;
        const next = Math.max(0, Math.min(setting.options.length - 1, Math.max(0, index) + delta));
        dispatch({ type: 'config.edit.value', value: setting.options[next]?.value ?? editing.value });
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: 'config.edit.value', value: editing.value.slice(0, -1) });
        return;
      }
      if (char && !key.ctrl && !key.meta && !setting.options) {
        dispatch({ type: 'config.edit.value', value: editing.value + char });
      }
      return;
    }

    if (key.escape || (key.ctrl && char === 'c')) {
      if (screen.state.filter) dispatch({ type: 'config.filter', filter: '' });
      else dispatch({ type: 'screen.close' });
      return;
    }
    if (key.upArrow || key.downArrow) {
      dispatch({
        type: 'config.move',
        delta: key.upArrow ? -1 : 1,
        count: filteredConfigSettings.length,
      });
      return;
    }
    if (key.return || char === ' ') {
      if (!setting) return;
      if (setting.action) {
        dispatch({ type: 'screen.close' });
        void Promise.resolve(setting.action()).catch((error: unknown) => {
          const { title, detail } = formatError(error);
          push(entry('notice', title, { tone: 'danger', ...(detail ? { detail } : {}) }));
        });
        return;
      }
      if (setting.kind === 'boolean' && setting.apply) {
        void applyConfigSetting(setting, setting.inputValue === 'true' ? 'false' : 'true');
        return;
      }
      if (setting.apply) {
        dispatch({ type: 'config.edit.start', id: setting.id, value: setting.inputValue });
        return;
      }
      dispatch({ type: 'config.feedback', message: `${setting.label} is read-only` });
      return;
    }
    if (key.backspace || key.delete) {
      dispatch({ type: 'config.filter', filter: screen.state.filter.slice(0, -1) });
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const { text } = splitPaste(char);
      if (text) dispatch({ type: 'config.filter', filter: screen.state.filter + text });
    }
  }

  /**
   * Navigating the browser.
   *
   * Every printable key filters. That is the whole interaction model, and it is
   * chosen for the size of the thing: three thousand plugins have no useful
   * alphabetical browse, so the list is a search result and the search field is
   * always focused. Arrows move, Enter acts, Tab changes tab, Escape leaves.
   */
  function handleBrowserKey(
    char: string,
    key: {
      return?: boolean;
      escape?: boolean;
      upArrow?: boolean;
      downArrow?: boolean;
      leftArrow?: boolean;
      rightArrow?: boolean;
      pageUp?: boolean;
      pageDown?: boolean;
      tab?: boolean;
      shift?: boolean;
      backspace?: boolean;
      delete?: boolean;
      ctrl?: boolean;
      meta?: boolean;
    },
  ): void {
    const browser = state.browser;
    if (!browser) return;

    if (browser.renameId) {
      if (key.escape || (key.ctrl && char === 'c')) {
        dispatch({ type: 'browser.rename.cancel' });
        return;
      }
      if (key.return) {
        void renameBrowserSession(browser.renameId, browser.renameDraft);
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: 'browser.rename.input', draft: browser.renameDraft.slice(0, -1) });
        return;
      }
      if (char && !key.ctrl && !key.meta) {
        const { text } = splitPaste(char);
        if (text) dispatch({ type: 'browser.rename.input', draft: browser.renameDraft + text });
      }
      return;
    }

    if (browser.deleteConfirm) {
      if (key.escape || (key.ctrl && char === 'c')) {
        dispatch({ type: 'browser.confirmDelete', id: null });
        return;
      }
      if (browser.tab === 'sessions' && char === 'D') {
        void deleteBrowserSession(browser.deleteConfirm);
        return;
      }
    }

    if (key.escape || (key.ctrl && char === 'c')) {
      dispatch({ type: 'browser.close' });
      return;
    }
    if (key.tab) {
      dispatch({ type: 'browser.tab', delta: key.shift ? -1 : 1 });
      return;
    }
    if (key.upArrow) {
      dispatch({ type: 'browser.move', delta: -1, count: browserRowsForView.length });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'browser.move', delta: 1, count: browserRowsForView.length });
      return;
    }
    // A page at a time, because scrolling three thousand entries one row at a
    // time is not navigation.
    if (key.pageUp) {
      dispatch({ type: 'browser.move', delta: -10, count: browserRowsForView.length });
      return;
    }
    if (key.pageDown) {
      dispatch({ type: 'browser.move', delta: 10, count: browserRowsForView.length });
      return;
    }
    if (key.ctrl && char === 'r') {
      if (browser.tab === 'sessions') {
        dispatch({ type: 'browser.loading', loading: true });
        void openSessions();
      }
      else void openCatalog(true);
      return;
    }
    if (key.return) {
      if (browser.tab === 'sessions') {
        const row = browserView?.rows[browserView.selected];
        if (row) void resumeBrowserSession(row.id);
      } else {
        void actOnBrowserRow();
      }
      return;
    }
    // Uppercase action keys only. Lowercase belongs to the filter, and a
    // browser where typing a server's name starts a lifecycle action is a
    // trap. Actions stay in the browser so status changes are visible in
    // place; the resulting notice is also retained in the transcript.
    if (browser.tab === 'mcp' && !key.ctrl && !key.meta && /^[CDAT]$/.test(char)) {
      const row = browserView?.rows[browserView.selected];
      if (row) {
        const action = char === 'C'
          ? 'connect'
          : char === 'D'
            ? 'disconnect'
            : char === 'A' ? 'authenticate' : 'test';
        void runMcpBrowserAction(action, row.id);
      }
      return;
    }
    if (browser.tab === 'sessions' && !key.ctrl && !key.meta && char === 'R') {
      const row = browserView?.rows[browserView.selected];
      const session = row ? browser.sessions.find((item) => item.id === row.id) : undefined;
      if (row && session) dispatch({ type: 'browser.rename.start', id: row.id, draft: session.title });
      return;
    }
    if (browser.tab === 'sessions' && !key.ctrl && !key.meta && char === 'D') {
      const row = browserView?.rows[browserView.selected];
      if (row) dispatch({ type: 'browser.confirmDelete', id: row.id });
      return;
    }
    if (key.backspace || key.delete) {
      dispatch({ type: 'browser.filter', filter: browser.filter.slice(0, -1) });
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const { text } = splitPaste(char);
      if (text) dispatch({ type: 'browser.filter', filter: browser.filter + text });
    }
  }

  /**
   * Enter, on whatever is selected.
   *
   * Deliberately modest about what it claims to do. Installing a marketplace
   * plugin means cloning a repository and merging whatever it declares into the
   * local configuration, and a half-done install is worse than none — so this
   * reports what the plugin is and where it lives, and leaves the fetching to a
   * step that can be done properly. Saying "installed" when nothing was would
   * be the one unforgivable thing here.
   */
  async function actOnBrowserRow(): Promise<void> {
    const browser = state.browser;
    const row = browserView?.rows[browserView.selected];
    if (!browser || !row) return;

    if (browser.tab === 'marketplace') {
      const selectedPlugin = browser.catalog?.plugins.find((entry) => entry.name === row.id);
      if (!selectedPlugin) return;
      const plugin: CatalogPlugin = selectedPlugin;
      dispatch({ type: 'browser.close' });
      push(entry('notice', `installing ${plugin.displayName ?? plugin.name}`, { tone: 'accent' }));
      try {
        const installed = await installMarketplacePlugin(plugin, globalConfigPath());
        push(entry('notice', `installed ${plugin.displayName ?? plugin.name}`, {
          tone: installed.replaced.length ? 'warn' : 'accent',
          expand: true,
          detail: [
            `MCP: ${installed.mcpServers.join(', ')}`,
            installed.replaced.length
              ? `replaced your existing config for: ${installed.replaced.join(', ')}`
              : null,
            installed.skills.length
              ? `declares skills plif does not install: ${installed.skills.join(', ')}`
              : null,
            `config: ${installed.configFile}`,
          ].filter(Boolean).join('\n'),
        }));
        if (installed.mcpServers.length) await reconnectMcp(installed.mcpServers);
      } catch (error) {
        const { title, detail } = formatError(error);
        push(entry('step', `could not install ${plugin.name}`, {
          status: 'failed', tone: 'warn', detail: [title, detail].filter(Boolean).join('\n'),
        }));
      }
      return;
      const url = sourceUrl(plugin);
      dispatch({ type: 'browser.close' });
      push(
        entry('notice', `${plugin.displayName ?? plugin.name}`, {
          tone: 'accent',
          subtitle: `${plugin.origin === 'official' ? 'official' : 'community'}${
            plugin.author ? ` · ${plugin.author}` : ''
          }`,
          expand: true,
          detail: [
            plugin.description,
            '',
            url ? `source   ${url}` : `source   ${plugin.source.kind}`,
            plugin.homepage ? `homepage ${plugin.homepage}` : null,
            '',
            'To use it, add its MCP servers to the "mcp" block of',
            globalConfigPath() + ',',
            'or copy its skills into your skills directory.',
          ]
            .filter((line) => line !== null)
            .join('\n'),
        }),
      );
      return;
    }

    // The local tabs: show the full record in the timeline, where it can be
    // scrolled and copied, rather than in a pane that closes.
    const detail =
      browser.tab === 'mcp'
        ? mcpStatuses.find((server) => server.name === row.id)
        : skillList.find((skill) => skill.name === row.id);
    if (!detail) return;
    dispatch({ type: 'browser.close' });
    push(
      entry('notice', row.id, {
        tone: 'accent',
        expand: true,
        detail: JSON.stringify(detail, null, 2),
      }),
    );
  }

  function handlePickerKey(
    char: string,
    key: {
      return?: boolean;
      escape?: boolean;
      upArrow?: boolean;
      downArrow?: boolean;
      backspace?: boolean;
      delete?: boolean;
      tab?: boolean;
      ctrl?: boolean;
      meta?: boolean;
    },
  ): void {
    const picker = state.picker;
    if (!picker) return;

    if (key.escape) {
      const onBack = picker.onBack;
      dispatch({ type: 'picker.close' });
      onBack?.();
      return;
    }
    if (key.ctrl && char === 'c') {
      dispatch({ type: 'picker.close' });
      return;
    }
    // Upper-case F is reserved for the compact model filter menu; lower-case
    // input remains ordinary picker search text.
    if (char === 'F' && picker.onFilter && !key.ctrl && !key.meta) {
      picker.onFilter();
      return;
    }
    if (key.upArrow) {
      dispatch({ type: picker.groups ? 'picker.moveVisible' : 'picker.move', delta: -1 });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: picker.groups ? 'picker.moveVisible' : 'picker.move', delta: 1 });
      return;
    }
    if (key.return) {
      if (picker.groups) {
        const matches = visiblePickerRows(picker.groups, picker.expanded ?? [], picker.filter);
        const chosen = matches[picker.selected];
        if (!chosen) return;
        if (chosen.kind === 'group') {
          dispatch({ type: 'picker.toggle', id: chosen.group.id });
          return;
        }
        // "show N more" is an expansion, not a choice: it reveals the rest of
        // the provider and leaves the picker open on the same provider.
        if (chosen.kind === 'more') {
          dispatch({ type: 'picker.toggle', id: chosen.id });
          return;
        }
        const selection = catalogSelection(chosen.groupId, chosen.item.value);
        if (!selection) return;
        dispatch({ type: 'picker.close' });
        picker.onPick(selection);
        return;
      }

      const matches = filterItems(picker.items ?? [], picker.filter);
      const chosen = matches[picker.selected];
      dispatch({ type: 'picker.close' });
      if (chosen) picker.onPick(chosen.selection ?? chosen.value);
      return;
    }
    if (key.backspace || key.delete) {
      dispatch({ type: 'picker.filter', filter: picker.filter.slice(0, -1) });
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const { text } = splitPaste(char);
      if (text) dispatch({ type: 'picker.filter', filter: picker.filter + text });
    }
  }

  function handleBtwInputKey(
    char: string,
    key: Key,
    deleteAction: 'backward' | 'forward' | null,
  ): void {
    const active = btwInput;
    if (!active) return;
    if (key.escape || (key.ctrl && char === 'c')) {
      setBtwInput(null);
      return;
    }
    if (key.return) {
      if (active.draft.trim()) {
        runBtw(active.draft);
      }
      return;
    }
    if (key.leftArrow) {
      setBtwInput((previous) => previous
        ? { ...previous, cursor: stepLeft(previous.draft, previous.cursor) }
        : previous);
      return;
    }
    if (key.rightArrow) {
      setBtwInput((previous) => previous
        ? { ...previous, cursor: stepRight(previous.draft, previous.cursor) }
        : previous);
      return;
    }
    if (key.ctrl && char === 'a') {
      setBtwInput((previous) => previous ? { ...previous, cursor: 0 } : previous);
      return;
    }
    if (key.ctrl && char === 'e') {
      setBtwInput((previous) => previous ? { ...previous, cursor: previous.draft.length } : previous);
      return;
    }
    if (deleteAction) {
      setBtwInput((previous) => {
        if (!previous) return previous;
        const position = Math.max(0, Math.min(previous.cursor, previous.draft.length));
        if (deleteAction === 'backward') {
          if (position === 0) return previous;
          const nextCursor = stepLeft(previous.draft, position);
          return {
            draft: previous.draft.slice(0, nextCursor) + previous.draft.slice(position),
            cursor: nextCursor,
          };
        }
        if (position >= previous.draft.length) return previous;
        const nextCursor = stepRight(previous.draft, position);
        return {
          draft: previous.draft.slice(0, position) + previous.draft.slice(nextCursor),
          cursor: position,
        };
      });
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const text = sanitizePastedText(char);
      if (!text) return;
      setBtwInput((previous) => {
        if (!previous) return previous;
        const position = Math.max(0, Math.min(previous.cursor, previous.draft.length));
        const draft = previous.draft.slice(0, position) + text + previous.draft.slice(position);
        return { draft, cursor: position + text.length };
      });
    }
  }

  /**
   * Answering the agent.
   *
   * Free text is the primary path and the suggestions are a shortcut over it,
   * so the keys are arranged that way round: everything printable types, the
   * arrows move to a suggestion, and Enter sends whichever of the two is
   * currently showing.
   *
   * There is no key that dismisses this without answering. Escape cancels the
   * whole turn — via the same path Ctrl+C takes — because a question the
   * developer has decided not to answer means the work behind it is not
   * wanted either, and silently returning "no answer" to the agent leaves it
   * guessing at a default nobody asked for.
   */
  function handleQuestionKey(
    char: string,
    key: {
      return?: boolean;
      escape?: boolean;
      upArrow?: boolean;
      downArrow?: boolean;
      backspace?: boolean;
      delete?: boolean;
      ctrl?: boolean;
      meta?: boolean;
    },
  ): void {
    const question = state.question;
    if (!question) return;

    if (isControlShortcut(char, key, 'e')) {
      dispatch({ type: 'question.expand' });
      return;
    }
    if (key.escape || (key.ctrl && char === 'c')) {
      if (question.text === SECRET_FIRST_QUESTION || question.text === SECRET_FINAL_QUESTION) {
        engine.questions.answer(question.id, 'cancel');
        return;
      }
      engine.questions.abandonAll();
      cancelRunning();
      return;
    }
    if (key.upArrow) {
      dispatch({ type: 'question.move', delta: -1 });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'question.move', delta: 1 });
      return;
    }
    if (key.return) {
      const chosen =
        state.questionChoice >= 0 ? question.options?.[state.questionChoice]?.value : undefined;
      const answer = (chosen ?? state.questionDraft).trim();
      // An empty Enter is a slip, not an answer. Sending it would resolve the
      // question with a blank string, which the agent has to interpret.
      if (!answer) return;
      engine.questions.answer(question.id, answer);
      return;
    }
    if (key.backspace || key.delete) {
      dispatch({ type: 'question.draft', draft: state.questionDraft.slice(0, -1) });
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      const { text, submitted } = splitPaste(char);
      const draft = state.questionDraft + text;
      if (submitted && draft.trim()) {
        engine.questions.answer(question.id, draft.trim());
        return;
      }
      dispatch({ type: 'question.draft', draft });
    }
  }

  function handleApprovalKey(
    char: string,
    key: { return?: boolean; upArrow?: boolean; downArrow?: boolean; escape?: boolean },
  ): void {
    const approval = state.approval;
    if (!approval) return;

    const answer = (index: number): void => {
      const selected = APPROVAL_CHOICES[index];
      if (!selected) return;
      engine.approvals.respond(approval.id, {
        decision: selected.decision,
        remember: selected.remember,
      });

      const rowId = approvalRows.current.get(approval.id);
      if (rowId) {
        approvalRows.current.delete(approval.id);
        dispatch({
          type: 'update',
          id: rowId,
          patch: {
            status: selected.decision === 'allow' ? 'done' : 'failed',
            tone: selected.decision === 'allow' ? 'success' : 'danger',
            subtitle: selected.label.toLowerCase(),
            tag: selected.remember ? '[session]' : '[once]',
          },
        });
      }

      dispatch({ type: 'approval.resolve' });
      setChoice(0);
    };

    const shortcut = APPROVAL_CHOICES.findIndex((option) => option.key === char.toLowerCase());
    if (shortcut >= 0) {
      answer(shortcut);
      return;
    }
    if (key.upArrow) {
      setChoice((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow) {
      setChoice((value) => Math.min(APPROVAL_CHOICES.length - 1, value + 1));
      return;
    }
    if (key.return) {
      answer(choice);
      return;
    }
    if (key.escape) {
      // Escape is the safe answer, always. A dialog where the reflexive key
      // grants permission is a dialog that will eventually grant it by accident.
      answer(APPROVAL_CHOICES.findIndex((option) => option.decision === 'deny'));
    }
  }

  /** Report one total only after the whole run, including queued work, is quiet. */
  const runQuiet =
    agentTurnStartedAt === null &&
    state.compaction === null &&
    state.queue.length === 0 &&
    !tasks.some((task) => task.status === 'running' || task.status === 'awaiting_approval') &&
    !state.subagents.some((view) => view.status === 'running');
  const runStartedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!runQuiet) {
      runStartedAt.current ??= Date.now();
      return;
    }
    const started = runStartedAt.current;
    runStartedAt.current = null;
    if (started === null) return;
    const elapsed = Date.now() - started;
    if (elapsed < 1_500) return;
    push(entry('separator', 'Worked', { durationMs: elapsed, tone: 'faint' }));
  }, [agentTurnStartedAt, runQuiet, push]);

  useEffect(() => {
    if (projectRootSetupPending || modelPickerPrompted.current || !providerProblem || !/no model/i.test(providerProblem)) return;
    modelPickerPrompted.current = true;
    push(
      entry('notice', 'no model configured yet', {
        tone: 'accent',
        subtitle: 'Plif ships empty. Pick a provider and model to get started.',
      }),
    );
    void findCommand('model')?.run([], context);
  }, [projectRootSetupPending, providerProblem, push]);

  useEffect(() => {
    if (projectRootSetupPending || modelKeyPrompted.current || !needsCredentialPrompt(providerProblem)) return;
    modelKeyPrompted.current = true;
    void (async () => {
      try {
        const stored = await loadStoredConfig(engine.paths);
        const currentConfig = resolveConfig(stored);
        const key = await requestModelKey(currentConfig.model, [
          'Plif could not start the configured model because its credential is missing.',
          'You can also set NeedKey = true in ~/.plif/config.toml and use /models later to reconfigure it.',
        ].join('\n'));
        if (!key) return;
        const selection = {
          preset: providerIdForConfig(stored) ?? '',
          model: currentConfig.model,
        };
        const persisted = await persistModelSelection(
          engine,
          stored,
          selection,
          key,
          credentials,
        );
        const ready = resolveConfig(persisted.config, {
          ...(selection.preset ? { preset: selection.preset } : {}),
          model: selection.model,
          ...(persisted.apiKey ? { apiKey: persisted.apiKey } : {}),
        });
        providerRef.current = createModelProvider(ready, { capabilityCache, bus: engine.bus });
        dispatch({
          type: 'context',
          used: 0,
          max: providerRef.current.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
        });
        push(entry('notice', persisted.persisted
          ? `credential saved for ${ready.model}`
          : `credential active for ${ready.model} this run`, {
          tone: persisted.persisted ? 'accent' : 'warn',
          subtitle: persisted.persisted
            ? 'The model is ready. The key is redacted from the transcript.'
            : 'The model is ready, but the encrypted credential store could not be updated.',
        }));
      } catch (error) {
        push(entry('notice', 'could not save the model credential', {
          tone: 'danger',
          detail: String(error),
        }));
      } finally {
        setCredentialPromptPending(false);
      }
    })();
  }, [engine, projectRootSetupPending, providerProblem, push, requestModelKey]);

  // ---- render ------------------------------------------------------------

  const liveStatus = deriveLiveStatus({
    approval: state.approval !== null,
    question: state.question !== null,
    agent: state.busy && state.compaction === null,
    compacting: state.compaction !== null,
    mcp: null,
    background: tasks.some((task) => task.status === 'running'),
    queued: state.queue.length,
  });
  const btwWidth = Math.max(1, surface.contentWidth - 2);
  const btwRows = btwPanelHeight(btwView, btwInput?.draft, btwWidth);
  const hints: Hint[] = state.screen?.kind === 'status'
    ? [{ key: 'Esc', label: 'close' }]
    : state.screen?.kind === 'config'
    ? state.screen.state.editing
      ? [{ key: '↑↓', label: 'choose' }, { key: 'Enter', label: 'apply' }, { key: 'Esc', label: 'cancel' }]
      : [{ key: 'type', label: 'search' }, { key: '↑↓', label: 'move' }, { key: 'Enter', label: 'edit' }, { key: 'Esc', label: 'clear / close' }]
    : state.browser
    ? [
        { key: 'type', label: 'filter' },
        { key: '↑↓', label: 'move' },
        { key: 'Tab', label: 'switch tab' },
        { key: 'Enter', label: 'details' },
        ...(state.browser.tab === 'mcp'
          ? [{ key: 'C', label: 'connect' }, { key: 'D', label: 'disconnect' }, { key: 'A', label: 'auth' }, { key: 'T', label: 'test' }]
          : []),
        ...(state.browser.tab === 'sessions'
          ? [{ key: 'R', label: 'rename' }, { key: 'D', label: 'delete' }]
          : []),
        ...(['marketplace', 'sessions'].includes(state.browser.tab) ? [{ key: 'Ctrl+R', label: 'refresh' }] : []),
        { key: 'Esc', label: 'close' },
      ]
    : state.question
    ? [
        { key: 'type', label: 'answer' },
        ...(state.question.options?.length ? [{ key: '↑↓', label: 'pick' }] : []),
        { key: 'Enter', label: 'send' },
        ...(state.question.context ? [{ key: 'Ctrl+E', label: 'details' }] : []),
        { key: 'Esc', label: 'cancel turn' },
      ]
    : state.picker
    ? [
        { key: 'type', label: 'filter' },
        { key: '↑↓', label: 'choose' },
        { key: 'Enter', label: 'select' },
        { key: 'Esc', label: 'cancel' },
      ]
    : btwInput
    ? [
        { key: 'type', label: 'side question' },
        { key: 'Enter', label: 'ask' },
        { key: 'Esc', label: 'close' },
      ]
    : state.approval
    ? [
        { key: 'y/a', label: 'allow' },
        { key: 'n/d', label: 'deny' },
        { key: '↑↓', label: 'choose' },
        { key: 'Esc', label: 'deny' },
      ]
    : showEmoji
      ? [
          { key: 'Tab', label: 'insert emoji' },
          { key: '↑↓', label: 'choose' },
          { key: 'Esc', label: 'dismiss' },
        ]
    : state.busy
      ? showCompletions
        ? [
            { key: 'Tab', label: 'accept' },
            { key: '↑↓', label: 'choose' },
            { key: 'Enter', label: typedCommandRunsNow ? 'run now' : 'queue for after' },
            { key: 'Esc', label: 'dismiss' },
          ]
        : [
          { key: 'Enter', label: 'queue' },
          ...(state.queue.length > 0 ? [{ key: 'Ctrl+X', label: 'drop queued' }] : []),
          ...(state.subagents.length > 1 ? [{ key: 'Tab', label: 'subagent' }] : []),
          ...(tasks.length > 0 ? [{ key: 'Ctrl+S', label: 'tasks' }] : []),
          { key: '/', label: 'commands' },
          { key: 'Ctrl+T', label: 'transcript' },
          { key: 'Esc', label: input ? 'clear' : 'cancel' },
        ]
      : showCompletions
        ? [
            { key: 'Tab', label: 'accept' },
            { key: '↑↓', label: 'choose' },
            { key: 'Enter', label: 'accept' },
            { key: 'Esc', label: 'dismiss' },
          ]
        : [
            { key: 'Enter', label: 'run' },
            { key: 'Ctrl+T', label: 'transcript' },
            ...(tasks.length || state.subagents.length ? [{ key: 'Ctrl+S', label: 'work' }] : []),
            { key: '/', label: 'commands' },
            { key: '↑↓', label: 'history' },
            { key: 'Ctrl+C', label: 'quit' },
          ];
  const showFooterHints = Boolean(
    state.screen ||
    state.browser ||
    state.question ||
    state.picker ||
    btwInput !== null ||
    state.approval ||
    showEmoji ||
    showCompletions,
  );
  // Provider/model/effort/context are useful during a decision or an active
  // turn, but they do not earn permanent space in the quiet idle shell.
  const showContextualFooter = state.busy || showFooterHints || interruptArmed;
  const footerRows = showContextualFooter ? FOOTER_HEIGHT : 0;

  // While the agent runs, the elapsed time and the token count live on the
  // working line directly above the prompt, where the eye already is. Repeating
  // them in the footer was the same three facts twice on one screen.
  const status = interruptArmed ? 'press Ctrl+C again to quit' : undefined;
  const working =
    agentTurnStartedAt !== null && loadingOperationRef.current !== null ? (
      <LoadingStatus
        active
        operationId={loadingOperationRef.current.id}
        width={surface.contentWidth}
      />
    ) : undefined;
  const promptStatus = planMode ? (
    <Text color={color('accent')}>plan mode · read-only · /plan off to work</Text>
  ) : undefined;
  const queuedPrompt = useMemo(
    () => state.queue.length > 0
      ? (
        <Queue
          messages={state.queue}
          selected={queuedIndex}
          width={Math.max(1, surface.contentWidth - 4)}
        />
      )
      : undefined,
    [state.queue, queuedIndex, surface.contentWidth],
  );

  // A dialog is the only thing on screen worth attention, and the prompt line
  // already carries the elapsed time and "Esc to cancel". A spinner underneath
  // a permission prompt is noise that costs four lines nobody has to spare.
  //
  // Compaction takes it over too: both are "the agent is busy", but only one of
  // them can say what it is busy *with* and how far along it is, so the vaguer
  // one steps aside rather than the two stacking.
  // Activity is a live work surface, not a second copy of the transcript.
  // Keep the HUD alive for the whole active turn, including the short window
  // before the first tool/input row exists; once the turn ends, its history
  // remains in the transcript and the floating HUD retires.
  const activityOpen = state.busy;
  const dockEntries = activityOpen || workDockOpen ? state.entries : [];
  const activityWarnings = useMemo(
    () => [
      ...report.degradations,
      ...(providerProblem ? [providerProblem] : []),
    ],
    [providerProblem, report.degradations],
  );
  const workRows = workDockHeight(
    tasks,
    state.subagents,
    activityHudMode,
    dockEntries,
    {
      active: state.busy,
      warnings: activityWarnings,
      lspStatuses,
      mcpStatuses,
      width: surface.contentWidth,
    },
  );
  const expandedTool = useMemo(
    () => state.expandedToolId === null
      ? null
      : state.committed.find((item) => item.id === state.expandedToolId && item.kind === 'tool') ?? null,
    [state.committed, state.expandedToolId],
  );
  const toolExpansionRows = expandedTool
    ? Math.min(
        surface.contentHeight,
        estimateHeight({ ...expandedTool, expand: true }, Math.max(12, surface.contentWidth - 2)) + 3,
      )
    : 0;
  const discoveryRows = discoveryHeight(state.discovery.calls, state.discovery.open);

  // How many rows a list-style dialog may use. Shrinks with the window so the
  // dialog itself never becomes the thing that overflows it.
  const pickerRows = Math.max(3, Math.min(12, rows - 12));
  const compactDialogs = rows < 34;
  const suggestionRows = Math.max(1, Math.min(6, surface.contentHeight - 8));
  const completionHeadingRows = showCompletions && !argumentCompletion ? 2 : 0;
  const secretWarningStage = state.question?.text === SECRET_FIRST_QUESTION
    ? 'first'
    : state.question?.text === SECRET_FINAL_QUESTION
      ? 'final'
      : null;

  const workingRows = working ? 1 : 0;
  const promptFooterRows = promptStatus ? 1 : 0;
  const promptQueueRows = queueHeight(state.queue);
  const inputRows = promptBodyRows(input, cursor, surface.contentWidth);

  // Everything Ink has to repaint, other than the timeline. Prompt rows are
  // budgeted from the same frame geometry that Prompt renders; a long draft is
  // clipped to the rows that fit while its complete value remains editable.
  const fixedChrome =
    footerRows + // contextual bottom HUD; zero rows in quiet idle
    workingRows +
    workRows +
    toolExpansionRows +
    (showCompletions ? suggestionRows + (completionCount > suggestionRows ? 1 : 0) + 1 + completionHeadingRows : 0) +
    (showEmoji ? suggestionRows + (emojiMatches.length > suggestionRows ? 1 : 0) + 1 : 0) +
    (state.picker
      ? state.picker.countLabel === 'efforts'
        ? 12
        : pickerRows + 8
      : 0) +
    btwRows +
    (state.approval ? approvalHeight(compactDialogs) : 0) +
    (secretWarningStage ? 1 : 0) +
    (state.question ? questionHeight(state.question, compactDialogs, state.questionExpanded) : 0) +
    (state.compaction ? COMPACTION_HEIGHT + 1 : 0) +
    discoveryRows +
    (state.exiting ? 1 : 0) +
    // The comparison is `>=`, so a frame that exactly fills the window still
    // repaints. Three spare lines buy the difference between "fits" and "the
    // session prints twice".
    3;
  const promptOverhead = promptHeight({
    bodyRows: 1,
    footerRows: promptFooterRows,
    queueRows: promptQueueRows,
  }) - 1;
  const promptRows = Math.max(
    1,
    Math.min(inputRows, surface.contentHeight - fixedChrome - promptOverhead),
  );
  const chrome = fixedChrome + promptHeight({
    bodyRows: promptRows,
    footerRows: promptFooterRows,
    queueRows: promptQueueRows,
  });
  // Zero is a legitimate answer. On a short window with a dialog open there is
  // genuinely no room for history, and showing two orphaned rows at the cost of
  // duplicating the session is the wrong trade.
  const timelineBudget = Math.max(0, surface.contentHeight - chrome);
  const scrollback = useMemo(
    (): (TimelineEntry | typeof STATIC_HEADER_ITEM)[] => [
      STATIC_HEADER_ITEM,
      ...state.committed,
    ],
    [state.committed],
  );
  const animationActive = !state.screen && animationClockActive({
      effort,
    busy: state.busy || btwView?.phase === 'working',
    compacting: state.compaction !== null,
    browserLoading: state.browser?.loading === true,
    runningTask: tasks.some(
      (task) => task.status === 'running' || task.status === 'awaiting_approval',
    ),
    runningSubagent: state.subagents.some((view) => view.status === 'running'),
    runningDiscovery: state.discovery.calls.some((call) => call.ok === undefined),
      runningTimeline: state.entries.some((entry) => entry.status === 'active'),
    // Only the focused idle prompt may breathe on the shared slow clock. Open
    // selectors stay completely static; keyboard navigation must be the only
    // thing that changes them.
    ambientFocus: Boolean(stdout.isTTY) && (
      !state.approval && !state.question && !state.picker && !btwInput && !state.browser && !state.screen && !state.exiting
    ),
  });
  // The full travelling wave is reserved for actual work and bounded
  // transitions; an idle frame that waved as hard as a busy one would make
  // "waiting" and "working" the same visual.
  const frameActive = !state.screen && strongFrameActive({
    busy: state.busy || btwView?.phase === 'working',
    compacting: state.compaction !== null,
    browserLoading: state.browser?.loading === true,
    runningTask: tasks.some(
      (task) => task.status === 'running' || task.status === 'awaiting_approval',
    ),
    runningSubagent: state.subagents.some((view) => view.status === 'running'),
    runningDiscovery: state.discovery.calls.some((call) => call.ok === undefined),
    runningTimeline: state.entries.some((entry) => entry.status === 'active'),
  });

  return (
    /*
      The surface owns the physical terminal width and height. Visual children
      receive its computed content width, so the full-bleed background remains
      stable while nested rows stay inside the available cells.

      The reason is a resize race that produced the ugliest bug in the app. Ink
      re-lays-out the *existing* React tree synchronously when the terminal
      emits `resize`, before React has re-rendered with the new size. With a
      pixel width baked into the tree, that intermediate frame is laid out at
      the old, wider size: the terminal wraps every over-long line, Ink counts
      the lines it *thinks* it wrote, erases that many, and leaves the overflow
      behind. Each drag of the window left one more ghost copy of the
      conversation on screen — measured at three copies of the same prompt box
      at 144, 127 and 140 columns.

      The surface dimensions are derived from the current terminal size on each
      render, so the intermediate frame fits and the erase is exact.
    */
    <AnimationClockProvider
      active={animationActive}
      // The live activity glyphs use the calm 120ms clock. The 33ms clock is
      // started only for the bounded PLIF signature overlay, never for idle
      // work or the whole App tree.
      fastActive={plifActivation}
      plif={effort === 'plif'}
    >
    <Box flexDirection="column" width={width} height={liveSurfaceHeight}>
      {pastedTextPopup ? (
        <PastedTextDialog text={pastedTextPopup.text} width={width} height={surface.canvasHeight} />
      ) : (
        <>
          {!state.screen && (
            <PlifActivation
              active={plifActivation}
              width={surface.contentWidth}
              height={liveSurfaceHeight}
            />
          )}
          {/*
            Scrollback. Ink prints each item once, above the frame, and never again
            — which is both why history survives here and why the array behind it
            must only ever grow. The key is what makes /clear safe: a new key is a
            new component with a fresh count, rather than the same one being handed
            a shorter list it will misread. Static rows do not inherit the
            viewport width, so the header row supplies it explicitly; otherwise
            the header's centering box collapses to the card's intrinsic width.
          */}
          <Static key={state.epoch} items={scrollback}>
            {(item) => (
              item.kind === 'header'
                ? (
                  <Box key={item.id} width={width} paddingX={layout.gutter} flexShrink={0}>
                    <Header width={headerAvailableWidth} />
                  </Box>
                )
                : (
                  <Box key={item.id} paddingX={layout.gutter}>
                    <TimelineRow entry={item} width={width - layout.gutter * 2} />
                  </Box>
                )
            )}
          </Static>

          {thinkingViewport.open ? (
        <ThinkingOverlay
          document={thinkingDoc}
          viewport={thinkingViewport}
          width={width}
          height={surface.panelHeight}
        />
      ) : transcriptViewport.open ? (
        <TranscriptOverlay
          cells={transcript.state.finalized}
          active={transcript.state.active}
          viewport={transcriptViewport}
          width={width}
          height={surface.panelHeight}
        />
      ) : state.screen ? (
        <Box
          flexDirection="column"
          {...{ height: surface.panelHeight, overflowY: 'hidden' as const }}
        >
          {state.screen.kind === 'status' && screenStatus ? (
            <StatusScreen
              snapshot={screenStatus}
              version={version}
              config={configSnapshot}
              configPath={globalConfigPath()}
              activeTheme={activeThemeId.current}
              providerProblem={providerProblem}
              configLoading={configLoading}
              configProblem={configProblem}
              width={width}
              rows={rows}
            />
          ) : state.screen.kind === 'config' ? (
            <ConfigScreen
              settings={filteredConfigSettings}
              filter={state.screen.state.filter}
              selected={state.screen.state.selected}
              editing={state.screen.state.editing}
              feedback={state.screen.state.feedback}
              loading={configLoading}
              problem={configProblem}
              width={width}
              rows={rows}
            />
          ) : null}
        </Box>
      ) : state.browser ? (
        /*
          Full-screen, replacing the normal panel rather than sitting above it.
          Browser and transcript views keep the physical terminal dimensions so
          their dense tables are not clipped by the quiet interactive shell.
        */
        <Box
          flexDirection="column"
          {...{ height: surface.panelHeight, overflowY: 'hidden' as const }}
        >
          <Browser
            state={browserView!}
            servers={mcpStatuses}
            skills={skillList}
            sessions={browserView?.sessions ?? []}
            width={width}
            rows={rows}
          />
        </Box>
      ) : (
        <Box
          flexDirection="column"
          width={surface.panelWidth}
          height={surface.panelHeight}
          paddingX={surface.panelPaddingX}
          paddingY={surface.panelPaddingY}
        >
          <Box flexDirection="column" width={surface.contentWidth} flexGrow={1}>
            <Box flexDirection="column">
              <Timeline
                entries={state.entries}
                width={surface.contentWidth}
                maxLines={timelineBudget}
              />
            </Box>

            {codexLogin && (
              <Box paddingX={1}>
                <CodexLoginDialog
                  status={codexLogin.status}
                  detail={codexLogin.detail}
                  userCode={codexLogin.userCode}
                  width={Math.max(1, surface.contentWidth - 2)}
                />
              </Box>
            )}

            {state.picker && (
              <Box paddingX={1}>
                <Picker
                  title={state.picker.title}
                  hint={state.picker.hint}
                  countLabel={state.picker.countLabel}
                  {...(state.picker.groups
                    ? { groups: state.picker.groups, expanded: state.picker.expanded }
                    : { items: filterItems(state.picker.items ?? [], state.picker.filter) })}
                  filter={state.picker.filter}
                  selected={state.picker.selected}
                  onFilter={state.picker.onFilter}
                  width={Math.max(1, surface.contentWidth - 2)}
                  rows={pickerRows}
                />
              </Box>
            )}

            {state.approval && (
              <Box paddingX={1}>
                <Approval
                  approval={state.approval}
                  selected={choice}
                  queued={state.approvalQueue.length}
                  width={Math.max(1, surface.contentWidth - 2)}
                  compact={compactDialogs}
                />
              </Box>
            )}

            {state.question && (
              <Box paddingX={1}>
                {secretWarningStage && (
                  <SecretWarning
                    stage={secretWarningStage}
                    width={Math.max(1, surface.contentWidth - 2)}
                  />
                )}
                <Question
                  question={state.question}
                  selected={state.questionChoice}
                  draft={state.questionDraft}
                  queued={state.questionQueue.length}
                  width={Math.max(1, surface.contentWidth - 2)}
                  expanded={state.questionExpanded}
                  compact={compactDialogs}
                  now={now}
                />
              </Box>
            )}

            {state.compaction && (
              <Box paddingX={1} marginTop={1}>
                <Compaction state={state.compaction} width={Math.max(1, surface.contentWidth - 2)} now={now} />
              </Box>
            )}

            <Discovery calls={state.discovery.calls} open={state.discovery.open} width={surface.contentWidth} />

            {(btwInput !== null || btwView !== null) && (
              <Box paddingX={1}>
                <BtwPanel
                  state={btwView}
                  {...(btwInput ? { draft: btwInput.draft, cursor: btwInput.cursor } : {})}
                  width={btwWidth}
                  now={now}
                />
              </Box>
            )}

            <Box flexGrow={1} />

            {expandedTool && (
              <ToolExpansion entry={expandedTool} width={surface.contentWidth} />
            )}

            {showCompletions && (
              <Completions
                matches={completions}
                argumentMatches={argumentCompletion ? argumentMatches : undefined}
                selected={completionIndex}
                maxRows={suggestionRows}
                width={Math.max(1, surface.contentWidth - 2)}
              />
            )}

            {showEmoji && (
              <EmojiMenu matches={emojiMatches} selected={emojiIndex} maxRows={suggestionRows} width={Math.max(1, surface.contentWidth - 2)} />
            )}

            <Box flexDirection="column" flexShrink={0}>
              <WorkDock
                tasks={tasks}
                subagents={state.subagents}
                subagentFocus={state.subagentFocus}
                mode={activityHudMode}
                active={state.busy}
                width={surface.contentWidth}
                now={activityHudMode === 'expanded' ? now : 0}
                entries={dockEntries}
                contextUsed={state.contextUsed}
                contextMax={state.contextMax}
                mcpStatuses={mcpStatuses}
                capabilities={report}
                lspStatuses={lspStatuses}
                sessionName={transcript.session?.meta.title ?? session?.meta.title ?? null}
                goal={goalRef.current?.condition ?? null}
                warnings={activityWarnings}
              />
              {working && (
                <Box paddingX={layout.gutter}>
                  {working}
                </Box>
              )}
              <Prompt
                value={input}
                cursor={cursor}
                placeholder={
                  // Short enough to survive a narrow terminal without being clipped
                  // mid-word, and honest about the two things a beginner can do
                  // from an empty line: talk to the agent, or open commands.
                  'describe a task, or / for commands'
                }
                // Focused while busy too: the field takes input the whole time, and
                // an unfocused-looking box that nonetheless accepts typing is a lie
                // about where the keystrokes are going.
                focused={!codexLogin && !state.approval && !state.question && !state.picker && !btwInput}
                busy={state.busy}
                busyLabel={state.busyLabel}
                width={surface.contentWidth}
                {...(showInlineSuggestion ? { inlineSuggestion: inlineGhostText } : {})}
                maxRows={promptRows}
                effort={effort}
                {...(promptStatus ? { status: promptStatus } : {})}
                frameActive={frameActive}
                plif={effort === 'plif'}
                {...(state.busySince !== null ? { busySince: state.busySince } : {})}
                {...(queuedPrompt ? { queue: queuedPrompt } : {})}
              />
              {showContextualFooter && (
                <Footer
                  hints={hints}
                  width={surface.contentWidth}
                  provider={providerRef.current?.info.endpoint ?? provider?.info.endpoint}
                  providerId={providerRef.current?.info.providerId ?? provider?.info.providerId}
                  model={providerRef.current?.info.id ?? provider?.info.id}
                  effort={effort}
                  codexFast={providerRef.current?.info.codexFast ?? provider?.info.codexFast}
                  contextUsed={state.contextUsed}
                  contextMax={state.contextMax}
                  showHints={showFooterHints}
                  {...(status ? { status } : {})}
                />
              )}
            </Box>

            {state.exiting && (
              <Box paddingX={1}>
                <Text color={color('muted')}>stopping containers…</Text>
              </Box>
            )}
          </Box>
        </Box>
          )}
        </>
      )}

    </Box>
    </AnimationClockProvider>
  );
}
