import path from 'node:path';
import fs from 'node:fs/promises';

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import type { Key } from 'ink';

import {
  adoptProvider,
  createModelProvider,
  forgetProviderKey,
  findCatalogProvider,
  forgetDiscoveredModels,
  PRESETS,
  buildSystemPrompt,
  catalogSelection,
  checkForUpdate,
  conversationFromTranscript,
  DEFAULT_CONTEXT_TOKENS,
  estimateTokens,
  eventBase,
  loadStoredConfig,
  mcpServersOf,
  parseServerConfigs,
  readAgentInstructions,
  resolveConfig,
  resolveServerConfigs,
  runCompaction,
  runLoop,
  subagentTool,
  SubagentCoordinator,
  visionTools,
  WEB_TOOLS,
  TaskManager,
  LspManager,
  lspTools,
  EditCoordinator,
  agentsOf,
  diffStats,
  parseDiff,
  profilesOf,
  saveStoredConfig,
  searchPlugins,
  loadCatalog,
  installMarketplacePlugin,
  sourceUrl,
  globalConfigPath,
  loadGlobalConfig,
  saveGlobalConfig,
  summariseMemory,
  validateModelConfig,
  PlifError,
  supportedEfforts,
  redactedProviderId,
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
  ModelProvider,
  ModelSelection,
  Session,
  Skill,
  SkillRegistry,
  Tool,
  ConversationEvent,
  TaskSnapshot,
  Effort,
  EffortCapabilityCache,
} from '@plif/core';
import type { SandboxCapabilityReport } from '@plif/sandbox';

import { Approval, APPROVAL_CHOICES, approvalHeight } from './components/Approval.js';
import { Browser, mcpStatusKind, sortMcpStatuses } from './components/Browser.js';
import { Compaction, COMPACTION_HEIGHT } from './components/Compaction.js';
import { Completions, EmojiMenu } from './components/Completions.js';
import { Discovery, discoveryHeight } from './components/Discovery.js';
import { Queue, queueHeight } from './components/Queue.js';
import { Question, questionHeight } from './components/Question.js';
import { Footer } from './components/Footer.js';
import type { Hint } from './components/Footer.js';
import { Header } from './components/Header.js';
import { Picker, filterItems, filterPickerGroups, flattenPickerGroups, pickerRows as visiblePickerRows } from './components/Picker.js';
import { Prompt } from './components/Prompt.js';
import { PlifDock, plifDockHeight } from './components/PlifDock.js';
import { terminalSurfaceLayout } from './components/TerminalSurface.js';
import { Working } from './components/Spinner.js';
import { visibleTasks } from './components/TaskIndicator.js';
import { WorkDock, workDockHeight } from './components/WorkDock.js';
import { Timeline, TimelineRow, estimateHeight } from './components/Timeline.js';
import { measureTranscriptCells } from './components/Timeline.js';
import { TranscriptOverlay } from './components/TranscriptOverlay.js';
import { commandPrefix, findCommand, matchCommands } from './commands.js';
import type { Command, CommandContext } from './commands.js';
import {
  formatError,
  formatExecOutput,
  formatExecTag,
  describeToolCall,
  isTerminalPaste,
  pastedContentToken,
  sanitizePastedText,
  splitPaste,
  summariseToolInput,
  toolLane,
  tokenize,
} from './format.js';
import { readClipboardImage, readClipboardText, writeClipboardText } from './clipboard.js';
import { IDLE_PASTE, hasPasteMarker, readPasteChunk } from './paste.js';
import type { PasteState } from './paste.js';
import { expandShortcodes, matchEmoji, openShortcode } from './emoji.js';
import { stepLeft, stepRight } from './text.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { AnimationClockProvider } from './hooks/useAnimationClock.js';
import { useTranscriptController } from './hooks/useTranscriptController.js';
import { entry, initialSession, sessionReducer } from './session.js';
import type { BrowserRow, BrowserState, QueuedMessage, TimelineEntry } from './session.js';
import { ComposerHistory } from './composer/history.js';
import { composerReducer, initialComposerState } from './composer/state.js';
import type { PastedAttachment } from './composer/state.js';
import { allTranscriptCells } from './transcript/reducer.js';
import { initialViewport, viewportReducer } from './transcript/scroll.js';
import { StreamFrameScheduler } from './stream-frame.js';
import type { StreamFrame } from './stream-frame.js';
import { deriveLiveStatus } from './live-status.js';
import {
  appendCompletionDelta,
  classifySubmission,
  countAgentTurns,
  discardCompletionEstimate,
  initialCompletionMeter,
  reconcileCompletionUsage,
} from './interaction-metrics.js';
import type { CompletionMeter } from './interaction-metrics.js';
import { preToolProseAction } from './pre-tool-prose.js';
import { applyEffortPalette, color, formatCount, formatDuration, glyph, layout } from './theme.js';
import { containerMount, containerWorkdir } from './container-paths.js';
import { authNotice } from './auth.js';
import { CREDENTIAL_USE_OPTIONS, credentialChoice, credentialProbeFailure, credentialPrompt } from './credentials.js';
import { completedTitle, titleForWorking, writeTerminalTitle } from './terminal-title.js';
import { sessionFrameHeight, terminalFrameRows } from './terminal-resize.js';
import { activateTheme } from './themes.js';
import type { ThemeCatalogue } from './themes.js';
import { formatSessionExport, sessionExportFileName } from './session-export.js';

export interface AppProps {
  readonly engine: Engine;
  readonly report: SandboxCapabilityReport;
  readonly cwd: string;
  /** The conversation this run belongs to. Null only if sessions are disabled. */
  readonly session: Session | null;
  /** Prior turns to replay on screen, from the last compaction boundary on. */
  readonly replay: readonly ConversationEvent[];
  readonly version: string;
  /** Null when no model is configured; the agent then refuses politely. */
  readonly provider: ModelProvider | null;
  /** Shared across profile switches so effort negotiation survives a turn. */
  readonly capabilityCache?: EffortCapabilityCache;
  readonly effort?: Effort;
  /** Theme active at startup; Plif may temporarily override it. */
  readonly initialThemeId?: string;
  /** User preference to restore after leaving Plif mode. */
  readonly preferredThemeId?: string;
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
  readonly themeCatalogue: ThemeCatalogue;
}

/** How often command output is flushed into the timeline. */
const STREAM_FLUSH_MS = 90;
/** Window in which a second Ctrl+C means "really quit". */
const DOUBLE_INTERRUPT_MS = 1500;
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
type GoalState = {
  condition: string;
  status: 'active';
};
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

/** The answer, short enough to sit in the row's right-hand tag column. */
function truncateAnswer(answer: string): string {
  const line = answer.split('\n')[0]?.trim() ?? '';
  return line.length > 24 ? line.slice(0, 23) + '…' : line;
}

export function App({
  engine,
  report,
  cwd,
  session,
  replay,
  version,
  provider,
  capabilityCache,
  providerProblem,
  effort: initialEffort,
  initialThemeId,
  preferredThemeId,
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
  themeCatalogue,
}: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  const [composer, composerDispatch] = useReducer(composerReducer, initialComposerState);
  const input = composer.draft;
  const cursor = composer.cursor;
  const pasted = composer.attachments;
  const completionIndex = composer.completion?.selected ?? 0;
  const queuedIndex = composer.queuedSelection;
  const setInput = (next: React.SetStateAction<string>): void => {
    const text = typeof next === 'function' ? next(composer.draft) : next;
    composerDispatch({ type: 'draft.set', text });
  };
  const setCursor = (next: React.SetStateAction<number>): void => {
    const value = typeof next === 'function' ? next(composer.cursor) : next;
    composerDispatch({ type: 'cursor.set', cursor: value });
  };
  const setPasted = (next: React.SetStateAction<PastedAttachment[]>): void => {
    const attachments = typeof next === 'function' ? next([...composer.attachments]) : next;
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
  const [, setThemeRevision] = useState(0);
  const [emojiIndex, setEmojiIndex] = useState(0);
  /** Live MCP status and loaded skills, for the browser's first two tabs. */
  const [mcpStatuses, setMcpStatuses] = useState<readonly McpServerStatus[]>(initialMcpStatuses);
  const [skillList, setSkillList] = useState<readonly Skill[]>(initialSkills);
  const [turn, setTurn] = useState(() => countAgentTurns(replay));
  const [agentTurnStartedAt, setAgentTurnStartedAt] = useState<number | null>(null);
  const [interruptArmed, setInterruptArmed] = useState(false);
  const [effort, setEffortState] = useState<Effort | undefined>(initialEffort);
  useEffect(() => {
    applyEffortPalette(effort);
  }, [effort]);
  const [completionMeter, setCompletionMeter] = useState<CompletionMeter>(initialCompletionMeter);
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [tasksOpen, setTasksOpen] = useState(false);
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
  const surface = terminalSurfaceLayout(width, rows);
  const transcript = useTranscriptController({ engine, workspace: cwd, session, replay });
  const [transcriptViewport, dispatchTranscriptViewport] = useReducer(
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

  // --- live output plumbing ---
  // Chunks arrive far faster than the terminal can usefully repaint, so they
  // accumulate in a ref and are flushed on a timer. Dispatching per chunk would
  // re-render the whole frame for every few bytes of a build log.
  const stream = useRef<{ rowId: string | null; text: string; dirty: boolean }>({
    rowId: null,
    text: '',
    dirty: false,
  });
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
        setCompletionMeter(meter);
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
  const providerRef = useRef<ModelProvider | null>(provider);
  const modelKeyPrompted = useRef(false);
  /** The empty-install picker opens once per session, not once per render. */
  const modelPickerPrompted = useRef(false);
  const effortRef = useRef<Effort | undefined>(initialEffort);
  const [planMode, setPlanModeState] = useState(false);
  const planModeRef = useRef(false);
  const goalRef = useRef<GoalState | null>(null);
  const activeThemeId = useRef(initialThemeId ?? themeCatalogue.themes[0]?.id ?? 'minimal');
  const themeBeforePlif = useRef(preferredThemeId ?? themeCatalogue.themes[0]?.id ?? 'minimal');

  const push = useCallback(
    (item: ReturnType<typeof entry>) => dispatch({ type: 'append', entry: item }),
    [],
  );

  /**
   * Finish the answer being streamed, if there is one.
   *
   * Text stops being an answer-in-progress at two moments: the model calls a
   * tool, and the loop ends. Both close the row here so the accumulated text
   * becomes the row's title — settled, therefore committable to scrollback —
   * and so the stream buffer stops pointing at a row nothing will write to.
   */
  const closeAnswer = useCallback(() => {
    semanticFrames.current?.flushAndComplete();
    const id = agentRow.current;
    if (!id) return;
    const text = agentText.current.trim();
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
    dispatch(preToolProseAction(id, event.text, event.visibility));
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
   * Seed the timeline from a resumed session.
   *
   * Replayed rows are visually dimmed and tagged, so it is never ambiguous
   * which part of the screen happened now and which is history being shown
   * back. A resume that looks identical to a live turn invites the developer to
   * believe a command just ran when it ran yesterday.
   */
  useEffect(() => {
    if (replay.length === 0) return;

    conversation.current = conversationFromTranscript(replay);
    const restored = estimateTokens(conversation.current);
    dispatch({ type: 'context', used: restored });
    push(
      entry('notice', `resumed ${session?.id ?? ''} — ${replay.length} earlier events`, {
        tone: 'accent',
        subtitle: `${conversation.current.length} messages back in context · ~${formatCount(restored)} tokens`,
      }),
    );
  }, [replay, push, session]);

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
        // A credential question can be raised by a picker selection. Keep one
        // interaction surface visible at a time so the provider/model context
        // and the masked field do not compete for the same terminal rows.
        dispatch({ type: 'picker.close' });
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
        if (event.phase === 'start') {
          // Prose written before a thought is a finished thought of its own.
          closeAnswer();
          const row = entry('thinking', effortRef.current === 'plif' ? 'Plif Thinking' : 'Thinking', { status: 'active' });
          thinkRow.current = { id: row.id, text: '', since: Date.now(), dirty: false };
          push(row);
          return;
        }
        closeThinking(event.durationMs);
      }),

      // Deliberately not reported per cycle. A twenty-step task used to end up
      // with twenty "Worked for" rules through it, which turned one piece of
      // work into a stack of receipts. The total is reported once, when there
      // is genuinely nothing left running — see the run-summary effect below.
      engine.bus.on('agent.cycle', () => undefined),

      engine.bus.on('agent.reasoning', (event) => {
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

      /**
       * The endpoint failed; another attempt is queued.
       *
       * One row, updated in place across the retry budget rather than one row per attempt.
       * The countdown is the point: a developer who can see "next attempt in
       * 15s (3/10)" waits, and one who sees an unchanging spinner kills it.
       */
      engine.bus.on('agent.retry', (event) => {
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

      engine.bus.on('agent.reset', () => {
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
        setCompletionMeter(completionMeterRef.current);
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
        compactionSince.current = null;
        dispatch({ type: 'compaction.end' });
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
        dispatch({
          type: 'context',
          used: event.promptTokens,
          ...(event.budget > 0 ? { max: event.budget } : {}),
        });
        completionMeterRef.current = reconcileCompletionUsage(
          completionMeterRef.current,
          event.completionTokens,
        );
        setCompletionMeter(completionMeterRef.current);
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

      engine.bus.on('agent.pre_tool_prose', settlePreToolProse),

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

        const patch = {
          status: (event.ok ? 'done' : 'failed') as 'done' | 'failed',
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
          ...(event.output?.trim() ? { detail: event.output } : {}),
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
            contextMax: DEFAULT_CONTEXT_TOKENS,
            completionTokens: 0,
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
        const next = visibleTasks(taskManager.current?.list() ?? []);
        setTasks(next);
        setTasksOpen(true);
      }),
      engine.bus.on('task.started', () => {
        const next = visibleTasks(taskManager.current?.list() ?? []);
        setTasks(next);
        setTasksOpen(true);
      }),
      engine.bus.on('task.output', () => setTasks(visibleTasks(taskManager.current?.list() ?? []))),
      engine.bus.on('task.finished', () => setTasks(visibleTasks(taskManager.current?.list() ?? []))),
      engine.bus.on('task.blocked', () => setTasks(visibleTasks(taskManager.current?.list() ?? []))),
    ];
    return () => offs.forEach((off) => off());
  }, [engine, push, closeAnswer, closeThinking, settleRetry, settlePreToolProse]);

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

  const connectMcp = useCallback(
    async (server: string): Promise<TimelineEntry> => {
      if (!mcpRegistry) return entry('notice', 'no MCP registry in this session', { tone: 'warn', status: 'failed' });
      try {
        const status = await mcpRegistry.connectServer(server);
        setMcpStatuses(mcpRegistry.statuses());
        return entry('notice', `${status.name} connected`, {
          tone: 'accent',
          subtitle: `${status.toolCount} tools available · ${status.transport}`,
        });
      } catch (error) {
        setMcpStatuses(mcpRegistry.statuses());
        const { title, detail } = formatError(error);
        return entry('notice', `${server} could not connect`, {
          tone: 'danger',
          status: 'failed',
          subtitle: title,
          ...(detail ? { detail, expand: true } : {}),
        });
      }
    },
    [mcpRegistry],
  );

  const disconnectMcp = useCallback(
    async (server: string): Promise<TimelineEntry> => {
      if (!mcpRegistry) return entry('notice', 'no MCP registry in this session', { tone: 'warn', status: 'failed' });
      try {
        const status = await mcpRegistry.disconnect(server);
        setMcpStatuses(mcpRegistry.statuses());
        return entry('notice', `${status.name} disconnected`, {
          tone: 'accent',
          subtitle: 'Its tools are hidden until you connect it again.',
        });
      } catch (error) {
        const { title, detail } = formatError(error);
        return entry('notice', `could not disconnect ${server}`, {
          tone: 'danger',
          status: 'failed',
          subtitle: title,
          ...(detail ? { detail, expand: true } : {}),
        });
      }
    },
    [mcpRegistry],
  );

  const testMcp = useCallback(
    async (server: string): Promise<TimelineEntry> => {
      if (!mcpRegistry) return entry('notice', 'no MCP registry in this session', { tone: 'warn', status: 'failed' });
      try {
        const status = await mcpRegistry.testConnection(server);
        setMcpStatuses(mcpRegistry.statuses());
        return entry('notice', `${status.name} connection is healthy`, {
          tone: 'accent',
          subtitle: `${status.toolCount} tools answered the test · ${status.transport}`,
        });
      } catch (error) {
        setMcpStatuses(mcpRegistry.statuses());
        const { title, detail } = formatError(error);
        return entry('notice', `${server} connection test failed`, {
          tone: 'danger',
          status: 'failed',
          subtitle: title,
          ...(detail ? { detail, expand: true } : {}),
        });
      }
    },
    [mcpRegistry],
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
    void checkForUpdate({ current: version, cacheFile: engine.paths.updateCheck }).then((update) => {
      if (!active || !update) return;
      push(
        entry('notice', `plif ${update.latest} is available`, {
          tone: 'accent',
          subtitle: `you are on ${update.current}`,
          detail: update.command,
          expand: true,
        }),
      );
    });
    return () => {
      active = false;
    };
  }, [engine, push, version]);

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
    state.subagents.some((view) => view.status === 'running');

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
    if (!stdout.isTTY) return;
    // Release modes that another TUI may have left enabled, then leave mouse
    // selection, wheel scrolling and viewport position entirely to the terminal.
    stdout.write('\u001B[?1000l\u001B[?1002l\u001B[?1003l\u001B[?1006l');
  }, [stdout]);

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
            const state = mcpStatusKind(server);
            return {
              id: server.name,
              title: `${state} · ${server.name}${server.connected ? ` · ${server.toolCount} tools` : ''}`,
              mark: state === 'connected' ? glyph.done : state === 'error' ? glyph.failed : glyph.pending,
              tone: state === 'connected'
                ? ('success' as const)
                : state === 'error' ? ('danger' as const) : ('muted' as const),
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

      const plugins = browser.catalog
        ? searchPlugins(browser.catalog.plugins, browser.filter, 120)
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
    [mcpStatuses, skillList],
  );

  /** Recompute the visible list whenever anything it derives from moves. */
  useEffect(() => {
    if (!state.browser) return;
    const nextRows = browserRows(state.browser);
    const unchanged = state.browser.rows.length === nextRows.length &&
      state.browser.rows.every((row, index) => {
        const next = nextRows[index];
        return next !== undefined && row.id === next.id && row.title === next.title &&
          row.mark === next.mark && row.tone === next.tone;
      });
    if (unchanged) return;
    dispatch({ type: 'browser.rows', rows: nextRows });
    // `rows` is intentionally not a dependency: this action sets it, and
    // depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.browser?.tab,
    state.browser?.filter,
    state.browser?.catalog,
    browserRows,
    state.browser !== null,
  ]);

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

  useEffect(() => {
    if (state.browser?.tab !== 'marketplace') return;
    if (state.browser.catalog || state.browser.problem) return;
    void openCatalog(false);
  }, [state.browser?.tab, state.browser?.catalog, state.browser?.problem, openCatalog]);


  /**
   * Retire settled rows into scrollback.
   *
   * A row can still change while it is the newest thing on screen — output
   * streams into it, its status resolves, an approval is inserted above it — so
   * it has to stay in the live frame until it cannot. Once `LIVE_TAIL` newer
   * rows exist and it is no longer running, nothing will touch it again, and it
   * belongs in `<Static>`: printed once, scrollable forever, and out of the
   * frame Ink has to repaint on every keystroke.
   */
  useEffect(() => {
    // Committing prints settled rows to native terminal scrollback. Plif does
    // not inspect or reposition the terminal viewport while doing so.
    let end = 0;
    for (let index = 0; index < state.entries.length; index += 1) {
      const item = state.entries[index]!;
      // Order is the constraint: scrollback is append-only, so a row can only
      // be committed once everything before it already has been.
      if (!isSettled(item)) break;
      const behindTheTail = index < state.entries.length - LIVE_TAIL;
      // A row taller than the window cannot be displayed live whatever the
      // budget says, and keeping it in the frame is what makes the frame
      // overflow. `/help` and `/policy` are the ones that hit this. In
      // scrollback it simply scrolls, which is what the developer wanted.
      const tallerThanTheScreen = estimateHeight(item, width - 2) > rows - 10;
      // Not a `break`: a short row inside the tail is happy to stay live, but
      // if something after it has to be committed then this one goes too —
      // scrollback is ordered, so a row cannot jump ahead of its predecessor.
      if (behindTheTail || tallerThanTheScreen) end = index + 1;
    }
    if (end > 0) {
      dispatch({
        type: 'commit',
        upTo: end,
        ids: state.entries.slice(0, end).map((entry) => entry.id),
      });
    }
  }, [state.entries, width, rows]);

  /** Drain accumulated command output into its active row on a fixed cadence. */
  useEffect(() => {
    const timer = setInterval(() => {
      const live = stream.current;
      if (!live.dirty || !live.rowId) return;
      live.dirty = false;
      dispatch({ type: 'update', id: live.rowId, patch: { detail: live.text } });
    }, STREAM_FLUSH_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }, []);

  const requestModelKey = useCallback(async (
    providerName: string,
    modelName: string,
    keyEnv: string | undefined,
    hint?: string,
  ): Promise<{ key: string; persist: boolean } | null> => {
    dispatch({ type: 'picker.close' });
    const prompt = credentialPrompt(providerName, modelName, keyEnv);
    const answer = await engine.questions.ask({
      text: prompt.text,
      secret: prompt.secret,
      context: [prompt.context, hint].filter(Boolean).join('\n'),
    });
    const key = answer?.trim();
    if (!key) {
      push(entry('notice', 'API key entry cancelled', {
        tone: 'warn',
        subtitle: 'The current model and session are unchanged.',
      }));
      return null;
    }

    const use = credentialChoice(await engine.questions.ask({
      text: `Use this key for ${providerName} / ${modelName}?`,
      secret: true,
      options: CREDENTIAL_USE_OPTIONS,
      context: 'Choose how this key should live. Esc cancels without changing the session.',
    }));
    if (use === 'cancel') {
      push(entry('notice', 'API key discarded', {
        tone: 'warn',
        subtitle: 'Nothing was saved and the current session is unchanged.',
      }));
      return null;
    }
    return { key, persist: use === 'save' };
  }, [engine, push]);

  const recoverModelAuth = useCallback(async (error: unknown): Promise<boolean> => {
    if (!PlifError.is(error) || error.code !== 'MODEL_AUTH') return false;
    const stored = await loadStoredConfig(engine.paths);
    const preset = stored.preset ?? '';
    const model = providerRef.current?.info.id ?? stored.model ?? 'the selected model';
    const providerName = findCatalogProvider(preset)?.label ?? (preset || 'This provider');
    const keyEnv = PRESETS[preset as keyof typeof PRESETS]?.keyEnv;
    const cleared = forgetProviderKey(stored, preset);
    await saveStoredConfig(engine.paths, cleared);
    const credential = await requestModelKey(providerName, model, keyEnv, [
      `${providerName} rejected the saved API key.`,
      'The old credential was removed from this provider only.',
      'Enter a replacement key, or press Esc to keep the model unconfigured.',
    ].join('\n'));
    if (!credential) return true;
    const next = adoptProvider(cleared, { preset, model }, credential.key);
    const ready = resolveConfig(next);
    const candidate = createModelProvider(ready);
    const probe = await candidate.probe();
    if (!probe.ok) {
      const failure = credentialProbeFailure(providerName, model, probe.detail);
      push(entry('notice', failure.title, {
        tone: 'danger',
        subtitle: failure.subtitle,
        detail: probe.detail,
      }));
      return true;
    }
    if (credential.persist) await saveStoredConfig(engine.paths, next);
    providerRef.current = candidate;
    push(entry('notice', 'provider credential updated', {
      tone: 'accent',
      subtitle: credential.persist
        ? 'Saved to ~/.plif/config.toml. Retry the message to use it.'
        : 'Used for this session only. Retry the message to use it.',
    }));
    return true;
  }, [engine, push, requestModelKey]);

  // ---- command execution -------------------------------------------------

  const context: CommandContext = {
    engine,
    supportedEfforts: () => supportedEfforts(
      providerRef.current?.info.id.toLowerCase().includes('claude') ? 'anthropic' : '',
      providerRef.current?.info.id ?? '',
    ),
    current: current.current,
    setCurrent: (container) => {
      current.current = container;
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
    model: providerRef.current,
    modelProblem: providerProblem,
    credentials,
    switchModel: async (requested: ModelSelection | string) => {
      const stored = await loadStoredConfig(engine.paths);
      const selection: ModelSelection =
        typeof requested === 'string'
          // A bare `/model <id>` keeps whatever provider is already configured.
          // There is no default to fall back on when none is.
          ? { preset: stored.preset ?? '', model: requested }
          : requested;
      let config = resolveConfig(stored, {
        model: selection.model,
        preset: selection.preset,
      });
      let storedSelection = adoptProvider(stored, selection);
      let check = validateModelConfig(config);
      if (!check.ok) {
        if (!config.apiKey && config.needKey) {
          const providerLabel =
            findCatalogProvider(selection.preset)?.label ?? (selection.preset || 'This provider');
          const keyEnv = PRESETS[selection.preset as keyof typeof PRESETS]?.keyEnv;
          const credential = await requestModelKey(providerLabel, selection.model, keyEnv, [
            `${providerLabel} serves this model from ${config.baseURL}.`,
            keyEnv ? `The same value can live in ${keyEnv} instead, if you prefer.` : '',
            'The key will be checked before the model is switched.',
          ].filter(Boolean).join('\n'));
          if (!credential) return;
          const next = adoptProvider(stored, selection, credential.key);
          config = resolveConfig(next, { model: selection.model, preset: selection.preset });
          check = validateModelConfig(config);
          if (!check.ok) {
            push(entry('notice', `cannot switch to ${selection.model}`, {
              tone: 'danger',
              detail: [check.problem, check.hint].filter(Boolean).join('\n'),
            }));
            return;
          }
          const candidate = createModelProvider(config);
          const probe = await candidate.probe();
          if (!probe.ok) {
            const failure = credentialProbeFailure(providerLabel, selection.model, probe.detail);
            push(entry('notice', failure.title, {
              tone: 'danger',
              subtitle: failure.subtitle,
              detail: probe.detail,
            }));
            return;
          }
          storedSelection = credential.persist ? next : adoptProvider(stored, selection);
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

      providerRef.current = createModelProvider(config);
      await saveStoredConfig(engine.paths, storedSelection);
      // A model swap changes what the assistant is; carrying the old exchange
      // into it would attribute the previous model's turns to the new one.
      conversation.current = [];
      push(
        entry('notice', `model is now ${selection.model}`, {
          tone: 'accent',
          subtitle: 'conversation reset for the new model',
        }),
      );
    },
    setEffort: async (effort) => {
      const stored = await loadStoredConfig(engine.paths);
      const next = { ...stored, ...(effort ? { effort } : {}) };
      if (!effort) delete next.effort;
      const config = resolveConfig(next);
      if (effort && !supportedEfforts(config.baseURL, config.model).includes(effort)) {
        throw new PlifError('INVALID_ARGUMENT', `${effort} is not supported by ${config.model}`);
      }
      providerRef.current = createModelProvider(config);
      await saveStoredConfig(engine.paths, next);
      conversation.current = [];
      const previous = effortRef.current;
      const specialEffort = (value: Effort | undefined): boolean =>
        ['plif', 'max', 'ultra', 'ultracode'].includes(value ?? '');
      if (effort === 'plif' && previous !== 'plif') {
        themeBeforePlif.current = activeThemeId.current === 'midnight'
          ? preferredThemeId ?? themeCatalogue.themes[0]?.id ?? 'minimal'
          : activeThemeId.current;
        const midnight = themeCatalogue.themes.find((theme) => theme.id === 'midnight');
        if (midnight) {
          activateTheme(midnight);
          activeThemeId.current = midnight.id;
          setThemeRevision((value) => value + 1);
        }
      } else if (effort !== 'plif' && previous === 'plif') {
        const restored = themeCatalogue.themes.find((theme) => theme.id === themeBeforePlif.current)
          ?? themeCatalogue.themes[0]!;
        activateTheme(restored);
        activeThemeId.current = restored.id;
        setThemeRevision((value) => value + 1);
      }
      if (!specialEffort(effort) && specialEffort(previous) && previous !== 'plif') {
        const restored = themeCatalogue.themes.find((theme) => theme.id === activeThemeId.current)
          ?? themeCatalogue.themes[0]!;
        activateTheme(restored);
        setThemeRevision((value) => value + 1);
      }
      applyEffortPalette(effort);
      effortRef.current = effort;
      setEffortState(effort);
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
      goalRef.current = { condition, status: 'active' };
    },
    goalStatus: () => goalRef.current ? { ...goalRef.current } : null,
    clearGoal: () => {
      goalRef.current = null;
    },
    switchProfile: async (name) => {
      const stored = await loadStoredConfig(engine.paths);
      const profile = profilesOf(stored)[name];
      if (!profile) throw new Error(`unknown profile ${name}`);
      const config = resolveConfig(stored, profile.model ? { model: profile.model } : {});
      const check = validateModelConfig(config);
      if (!check.ok) throw new Error(check.problem ?? 'profile model is not usable');
      providerRef.current = createModelProvider(config);
      await saveStoredConfig(engine.paths, { ...stored, activeProfile: name });
      conversation.current = [];
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
      const target = Math.floor(DEFAULT_CONTEXT_TOKENS * (aggressive ? 0.33 : 0.7));
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
    mcpNames: mcpStatuses.map((server) => server.name),
    openPicker: (picker) => dispatch({ type: 'picker.open', picker }),
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
    themes: themeCatalogue.themes,
    switchTheme: async (id) => {
      const theme = themeCatalogue.themes.find((entry) => entry.id === id);
      if (!theme) throw new Error(`unknown theme ${id}`);
      activateTheme(theme);
      activeThemeId.current = id;
      if (effortRef.current === 'plif' && id !== 'midnight') themeBeforePlif.current = id;
      const stored = await loadGlobalConfig();
      await saveGlobalConfig({ ...stored, theme: id });
      setThemeRevision((value) => value + 1);
    },
  };

  const submit = useCallback(
    async (line: string, suppliedAttachments?: readonly PastedAttachment[]) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Claim the pasted images for this message and clear the tray, so a
      // second message does not re-send the first one's screenshot.
      const carried = suppliedAttachments ?? pasted;
      if (suppliedAttachments === undefined) setPasted([]);

      const privateShell = trimmed.startsWith('!!');
      const submissionKind = classifySubmission(trimmed);
      const agentSubmission = submissionKind === 'agent';
      history.current.record(privateShell ? '!! [private command]' : trimmed);
      if (agentSubmission) {
        setAgentTurnStartedAt(Date.now());
        setTurn((value) => value + 1);
        completionMeterRef.current = initialCompletionMeter;
        setCompletionMeter(initialCompletionMeter);
      }
      setCompletionIndex(0);
      dispatch({ type: 'discovery.reset' });

      push(entry('input', privateShell ? '!! [private command]' : trimmed));
      const turnId = !privateShell && !trimmed.startsWith('/') && !trimmed.startsWith('!')
        ? transcript.appendUserTurn(trimmed)
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
            trimmed,
            await encodePasted(carried),
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
        if (agentSubmission) setAgentTurnStartedAt(null);
      }
    },
    [pasted, push, transcript],
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
      for (const message of leftover) await submit(message.text, message.attachments);
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
      transcript.persist({
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
    const containerPromise: Promise<Container> = existingContainer
      ? Promise.resolve(existingContainer)
      : (async () => {
          const image = await engine.ensureBaseImage();
          return await engine.run({
            image: image.reference,
            mounts: [containerMount(cwd)],
            workdir: containerWorkdir(cwd),
            // Network is granted at the ceiling and gated per host by policy,
            // which falls through to "ask". It costs a permission prompt the
            // first time a search runs, and nothing when auto-approve is on.
            capabilities: { hostWrite: true, network: true },
          });
        })();

    const [container, snapshot, agentInstructions, profileConfig] = await Promise.all([
      containerPromise,
      snapshotPromise,
      instructionsPromise,
      configPromise,
    ]);
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
      taskManager.current = new TaskManager({
        container,
        bus: engine.bus,
        approvals: engine.approvals,
      });
      setTasks(visibleTasks(taskManager.current.list()));
      lspManager.current = new LspManager({
        root: await container.hostPathFor(container.workdir),
        bus: engine.bus,
      });
      // LSP is useful to later tool calls but is not a prerequisite for the
      // first model request. Its client manager initializes lazily if a tool
      // asks for a language server before this warmup completes.
      void lspManager.current.warmup().catch(() => undefined);
    }
    const activeProfileName = typeof profileConfig.activeProfile === 'string' ? profileConfig.activeProfile : undefined;
    const activeProfile = activeProfileName ? profilesOf(profileConfig)[activeProfileName] : undefined;
    // The subagent inherits the LSP tools but not the parent's own subagent
    // tool — that is what stops recursion, and it is enforced here rather than
    // trusted to the prompt.
    const lspForAgent = lspManager.current ? lspTools(lspManager.current) : [];
    const edits = new EditCoordinator();
    const storedConfig = profileConfig;
    const planOnly = mode === 'plan';
    const goalInstructions = goalRef.current
      ? `SESSION GOAL (user-defined, guidance only): ${goalRef.current.condition}\nRead this goal to understand the user's final desired outcome across subsequent turns. Do not start work merely because the goal was recorded; act on the user's current request and use ask_user when scope or approval is unclear.`
      : "No session goal is set. Do not invent a final objective silently. If the user's end goal is unclear, use ask_user first; when the Galileo skill is available, use it after clarification to help structure the objective.";
    const turnInstructions = [
      agentInstructions,
      planOnly
        ? 'PLAN MODE: inspect files and run read-only discovery only. Do not write, edit, delete, move, install, commit, or otherwise mutate the workspace. Return a concrete implementation plan and wait for /plan off before making changes.'
        : undefined,
      goalInstructions,
    ].filter(Boolean).join('\n\n');
    const childOptions = {
      provider: providerRef.current,
      isolation: report.isolation,
      stored: storedConfig,
      agents: agentsOf(storedConfig),
      extraTools: [...lspForAgent, ...WEB_TOOLS],
      edits,
      coordinator: subagents.current,
      ...(turnInstructions ? { agentInstructions: turnInstructions } : {}),
    };
    const allAgentTools = [
      ...tools,
      ...(planOnly ? [] : mcpRegistry?.tools() ?? []),
      ...lspForAgent,
      ...WEB_TOOLS,
      ...(planOnly ? [] : visionTools(childOptions)),
      ...(planOnly ? [] : [subagentTool(childOptions)]),
    ];
    const agentTools = planOnly
      ? allAgentTools.filter((tool) => !PLAN_BLOCKED_TOOLS.has(tool.spec.name))
      : allAgentTools;

    try {
      const result = await runLoop(
        [
          {
            role: 'system',
            content: buildSystemPrompt({
              workspace: cwd,
              containerName: container.name,
              workdir: container.workdir,
              capabilities: container.capabilities,
              isolation: report.isolation,
              tools: agentTools.map((tool) => tool.spec),
              skills: skillRegistry?.catalogue() ?? skillCatalogue,
              mcpServers: mcpRegistry ? mcpRegistry.catalogue() : mcpCatalogue,
              guidance: snapshot.guidance,
              memory: summariseMemory(snapshot),
              notes: snapshot.notes,
              sandboxGaps: report.degradations,
              effort: effortRef.current,
              ...(turnInstructions ? { agentInstructions: turnInstructions } : {}),
              ...(planOnly ? { mode: 'explore' as const } : {}),
              ...(activeProfile ? { profile: { name: activeProfile.name ?? activeProfileName!, systemPrompt: activeProfile.systemPrompt } } : {}),
            }),
          },
          ...conversation.current,
          { role: 'user', content: text, ...(attachments.length ? { attachments } : {}) },
        ],
        {
          provider: providerRef.current,
          container,
          questions: engine.questions,
          bus: engine.bus,
          turnId: durableTurnId,
          signal: abort.signal,
          tools: agentTools,
          memory: engine.memory,
          workspace: cwd,
          sessionId: transcript.session?.id ?? 'interactive',
          contextTokens: DEFAULT_CONTEXT_TOKENS,
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
            queueRef.current = [];
            dispatch({ type: 'queue.clear' });
            for (const message of pendingMessages) {
              push(entry('input', message.text, { tag: '[queued]' }));
              transcript.persist({
                ...eventBase('user.message', durableTurnId),
                text: message.text,
              });
            }
            return await Promise.all(
              pendingMessages.map(async (message) => ({
                role: 'user' as const,
                content: message.text,
                attachments: await encodePasted(message.attachments),
              })),
            );
          },
          activateProfile: async (name) => {
            const stored = await loadStoredConfig(engine.paths);
            const profile = profilesOf(stored)[name];
            if (!profile) throw new Error(`unknown profile ${name}`);
            const config = resolveConfig(stored, profile.model ? { model: profile.model } : {});
            providerRef.current = createModelProvider(config, {
              capabilityCache,
              bus: engine.bus,
            });
            await saveStoredConfig(engine.paths, { ...stored, activeProfile: name });
            conversation.current = [];
          },
          setGoal: async (condition) => {
            goalRef.current = { condition, status: 'active' };
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
      if (result.error) {
        const recovered = await recoverModelAuth(result.error);
        if (!recovered) {
          const { title, detail } = formatError(result.error);
          push(entry('step', title, { status: 'failed', tone: 'danger', ...(detail ? { detail } : {}) }));
        }
      }
    } catch (error) {
      const recovered = await recoverModelAuth(error);
      if (!recovered) {
        const { title, detail } = formatError(error);
        push(
          entry('step', title, { status: 'failed', tone: 'danger', ...(detail ? { detail } : {}) }),
        );
      }
    } finally {
      execAbort.current = null;
      // Also on the error and cancel paths: whatever the model managed to say
      // before it broke is worth keeping on screen, and a row left `active`
      // would spin forever and never reach scrollback.
      closeAnswer();
      closeThinking();
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
    setPasted((existing) => [...existing, { ...attachment, token } as PastedAttachment]);
    const separator = input && !/\s$/.test(input.slice(0, cursor)) ? ' ' : '';
    const next = input.slice(0, cursor) + separator + token + input.slice(cursor);
    setInput(next);
    setCursor(cursor + separator.length + token.length);
  }

  async function pasteImage(): Promise<void> {
    try {
      const image = await readClipboardImage();
      if (image) {
        addPasted({ kind: 'image', path: image.path, mediaType: image.mediaType, bytes: image.bytes });
        return;
      }
      const raw = await readClipboardText();
      const text = raw ? sanitizePastedText(raw) : '';
      if (!text) {
        push(
          entry('notice', 'nothing to paste', {
            tone: 'muted',
            subtitle: 'the clipboard has no supported content',
          }),
        );
        return;
      }
      addPasted({ kind: 'text', text });
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
    !state.busy && !state.approval && !state.question && !state.picker
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
  const completions: Command[] =
    typedCommand !== null && !state.busy && !state.approval
      ? matchCommands(typedCommand)
      : [];
  // Keep the selected command visible while its arguments are being typed.
  // The old space check made the menu vanish exactly when `/model ` or
  // `/mcp ` became useful, and made the prompt look like it had eaten input.
  const showCompletions = completions.length > 0;

  function applyCompletion(command: Command): void {
    const completed = `/${command.name} `;
    setInput(completed);
    setCursor(completed.length);
    setCompletionIndex(0);
  }

  // ---- keyboard ----------------------------------------------------------

  const pasteStream = useRef<PasteState>(IDLE_PASTE);

  function receivePastedText(raw: string): void {
    const text = sanitizePastedText(raw);
    if (!text) return;
    const firstLine = text.split('\n')[0] ?? '';

    if (state.browser) {
      if (firstLine) dispatch({ type: 'browser.filter', filter: state.browser.filter + firstLine });
      return;
    }
    if (state.approval) return;
    if (state.question) {
      if (firstLine) dispatch({ type: 'question.draft', draft: state.questionDraft + firstLine });
      return;
    }
    if (state.picker) {
      if (firstLine) dispatch({ type: 'picker.filter', filter: state.picker.filter + firstLine });
      return;
    }
    addPasted({ kind: 'text', text });
  }

  const workDockOpen = tasksOpen || state.subagentsOpen;
  const transcriptCells = allTranscriptCells(transcript.state);
  const transcriptBodyHeight = Math.max(1, terminalFrameRows(rows) - 2);
  const transcriptContentLines = measureTranscriptCells(transcriptCells, width);

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

  useInput((char, key) => {
    if (state.exiting) return;

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

    if (state.picker) {
      handlePickerKey(char, key);
      return;
    }

    if (transcriptViewport.open) {
      const metrics = {
        contentLines: transcriptContentLines,
        height: transcriptBodyHeight,
      };
      if ((key.ctrl && char === 't') || key.escape) {
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
      if (key.ctrl && (char === 'end' || char === 'e')) {
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

    if (key.ctrl && char === 'e') {
      dispatch({ type: 'toggleLastTool' });
      return;
    }
    if (key.ctrl && char === 'r') {
      dispatch({ type: 'toggleLastThinking' });
      return;
    }
    if (key.ctrl && char === 's' && (tasks.length > 0 || state.subagents.length > 0)) {
      setWorkDockOpen(!workDockOpen);
      return;
    }
    if (key.ctrl && char === 'x' && state.subagents.length > 0) {
      const selected = state.subagents[Math.min(state.subagentFocus, state.subagents.length - 1)];
      if (selected && subagents.current.cancel(selected.taskId)) return;
    }
    // Tab cycles subagent tabs whenever it is not completing a command. While
    // the agent is working there is nothing to complete, which is exactly when
    // there are subagents to look at.
    if (key.tab && state.subagents.length > 1 && !showCompletions) {
      dispatch({ type: 'subagent.focus', delta: key.shift ? -1 : 1 });
      return;
    }

    if (key.escape && workDockOpen) {
      setWorkDockOpen(false);
      return;
    }
    if (key.ctrl && char === 't') {
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
      if (key.return) {
        sendLine(expandShortcodes(input));
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
          if (picked && picked.name !== tokenize(input.slice(1))[0]) {
            applyCompletion(picked);
            return;
          }
        }
        sendLine(expandShortcodes(input));
        return;
      }

      if (key.tab) {
        const picked = completions[completionIndex];
        if (showCompletions && picked) applyCompletion(picked);
        return;
      }

      if (key.upArrow || key.downArrow) {
        // Arrows drive the menu when it is open, and history when it is not.
        if (showCompletions) {
          setCompletionIndex((value) =>
            key.upArrow
              ? Math.max(0, value - 1)
              : Math.min(completions.length - 1, value + 1),
          );
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
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      // Delete the whole character. Removing one code unit left the other half
      // of an emoji in the buffer, which then rendered as a replacement box the
      // developer had to press backspace a second time to clear.
      const from = stepLeft(input, cursor);
      setInput(input.slice(0, from) + input.slice(cursor));
      setCursor(from);
      setCompletionIndex(0);
      setEmojiIndex(0);
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      if (isTerminalPaste(char)) {
        const pastedText = sanitizePastedText(char);
        if (pastedText) addPasted({ kind: 'text', text: pastedText });
        return;
      }
      // A paste arrives as one chunk, not as N keypresses, so this branch must
      // cope with arbitrary text — including embedded newlines and control
      // bytes. Inserting the chunk raw would put a literal CR in the buffer and
      // silently corrupt the command.
      const text = sanitizePastedText(char);
      if (text.endsWith('\n')) {
        const typed = text.replace(/\n+$/, '');
        sendLine(expandShortcodes(input.slice(0, cursor) + typed + input.slice(cursor)));
        return;
      }
      const raw = input.slice(0, cursor) + text + input.slice(cursor);
      // Resolve any shortcode the keystroke just closed, so `:sob:` becomes the
      // glyph the moment the second colon lands rather than waiting for Enter.
      const next = expandShortcodes(raw);
      const shrank = raw.length - next.length;

      setInput(next);
      setEmojiIndex(0);
      setCursor((value) => Math.max(0, value + text.length - shrank));
      setCompletionIndex(0);
    }
  }

  function sendLine(line: string): void {
    if (state.busy) {
      const queued = line.trim();
      if (!queued && pasted.length === 0) return;
      dispatch({
        type: 'queue.push',
        message: { id: `q${Date.now()}`, text: queued, attachments: pasted },
      });
      setPasted([]);
      setInput('');
      setCursor(0);
      setQueuedIndex(state.queue.length);
      return;
    }
    setInput('');
    setCursor(0);
    void submit(line);
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

    if (key.escape || (key.ctrl && char === 'c')) {
      dispatch({ type: 'browser.close' });
      return;
    }
    if (key.tab) {
      dispatch({ type: 'browser.tab', delta: key.shift ? -1 : 1 });
      return;
    }
    if (key.upArrow) {
      dispatch({ type: 'browser.move', delta: -1 });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'browser.move', delta: 1 });
      return;
    }
    // A page at a time, because scrolling three thousand entries one row at a
    // time is not navigation.
    if (key.pageUp) {
      dispatch({ type: 'browser.move', delta: -10 });
      return;
    }
    if (key.pageDown) {
      dispatch({ type: 'browser.move', delta: 10 });
      return;
    }
    if (key.ctrl && char === 'r') {
      void openCatalog(true);
      return;
    }
    if (key.return) {
      void actOnBrowserRow();
      return;
    }
    // Uppercase only. Lowercase belongs to the filter, and a browser where
    // typing a server's name starts changing its connection is a trap.
    if (browser.tab === 'mcp' && !key.ctrl && !key.meta && ['C', 'D', 'A', 'T'].includes(char)) {
      const row = browser.rows[browser.selected];
      if (!row) return;
      const action = char === 'C'
        ? connectMcp
        : char === 'D'
          ? disconnectMcp
          : char === 'A'
            ? loginMcp
            : testMcp;
      void action(row.id).then(push);
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
    const row = browser?.rows[browser.selected];
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
      leftArrow?: boolean;
      rightArrow?: boolean;
      pageUp?: boolean;
      pageDown?: boolean;
      home?: boolean;
      end?: boolean;
      backspace?: boolean;
      delete?: boolean;
      ctrl?: boolean;
      meta?: boolean;
    },
  ): void {
    const picker = state.picker;
    if (!picker) return;

    if (key.escape || (key.ctrl && char === 'c')) {
      dispatch({ type: 'picker.close' });
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
    if (key.pageUp || key.pageDown || key.home || key.end) {
      const delta = key.home || key.pageUp
        ? (key.home ? -100_000 : -Math.max(1, pickerRows - 2))
        : (key.end ? 100_000 : Math.max(1, pickerRows - 2));
      dispatch({ type: picker.groups ? 'picker.moveVisible' : 'picker.move', delta });
      return;
    }
    if (picker.groups && (key.leftArrow || key.rightArrow)) {
      const matches = visiblePickerRows(picker.groups, picker.expanded ?? [], picker.filter);
      const chosen = matches[picker.selected];
      if (!chosen) return;
      const expand = key.rightArrow;
      if (chosen.kind === 'group') {
        const isExpanded = (picker.expanded ?? []).includes(chosen.group.id);
        if ((expand && !isExpanded) || (!expand && isExpanded)) {
          dispatch({ type: 'picker.toggle', id: chosen.group.id });
        }
        return;
      }
      if (!expand) {
        dispatch({ type: 'picker.toggle', id: chosen.groupId });
      }
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
      if (chosen) picker.onPick(chosen.value);
      return;
    }
    if (key.ctrl && char === 'u') {
      dispatch({ type: 'picker.filter', filter: '' });
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

    if (key.ctrl && char === 'e') {
      dispatch({ type: 'question.expand' });
      return;
    }
    if (key.escape || (key.ctrl && char === 'c')) {
      if (question.secret) {
        // Credential dialogs are cancellable inputs, not agent decisions. Do
        // not abort the surrounding session when the developer backs out.
        engine.questions.abandonAll();
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
    if (modelPickerPrompted.current || !providerProblem || !/no model/i.test(providerProblem)) return;
    modelPickerPrompted.current = true;
    push(
      entry('notice', 'no model configured yet', {
        tone: 'accent',
        subtitle: 'Plif ships empty. Pick a provider and model to get started.',
      }),
    );
    void findCommand('model')?.run([], context);
  }, [providerProblem, push]);

  useEffect(() => {
    if (modelKeyPrompted.current || !providerProblem || !/api key|credential/i.test(providerProblem)) return;
    modelKeyPrompted.current = true;
    void (async () => {
      try {
        const stored = await loadStoredConfig(engine.paths);
        const currentConfig = resolveConfig(stored);
        const providerName = findCatalogProvider(stored.preset ?? '')?.label ?? (stored.preset || 'This provider');
        const keyEnv = PRESETS[stored.preset as keyof typeof PRESETS]?.keyEnv;
        const credential = await requestModelKey(providerName, currentConfig.model, keyEnv, [
          'Plif could not start the configured model because its credential is missing.',
          'You can also set NeedKey = true in ~/.plif/config.toml and use /model later to reconfigure it.',
        ].join('\n'));
        if (!credential) return;
        const next = adoptProvider(
          stored,
          { preset: stored.preset ?? '', model: currentConfig.model },
          credential.key,
        );
        const ready = resolveConfig(next);
        const candidate = createModelProvider(ready);
        const probe = await candidate.probe();
        if (!probe.ok) {
          const failure = credentialProbeFailure(providerName, ready.model, probe.detail);
          push(entry('notice', failure.title, {
            tone: 'danger',
            subtitle: failure.subtitle,
            detail: probe.detail,
          }));
          return;
        }
        providerRef.current = candidate;
        if (credential.persist) await saveStoredConfig(engine.paths, next);
        push(entry('notice', `credential ready for ${ready.model}`, {
          tone: 'accent',
          subtitle: credential.persist
            ? 'Saved to ~/.plif/config.toml. The key is redacted from the transcript.'
            : 'Used for this session only. The key is redacted from the transcript.',
        }));
      } catch (error) {
        push(entry('notice', 'could not save the model credential', {
          tone: 'danger',
          detail: String(error),
        }));
      }
    })();
  }, [engine, providerProblem, push, requestModelKey]);

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
  const hints: Hint[] = state.browser && !state.question
    ? [
        { key: 'type', label: 'filter' },
        { key: '↑↓', label: 'move' },
        { key: 'Tab', label: 'switch tab' },
        { key: 'Enter', label: 'details' },
        ...(state.browser.tab === 'mcp'
          ? [
              { key: 'C', label: 'connect' },
              { key: 'D', label: 'disconnect' },
              { key: 'A', label: 'authenticate' },
              { key: 'T', label: 'test' },
            ]
          : []),
        ...(state.browser.tab === 'marketplace' ? [{ key: 'Ctrl+R', label: 'refresh' }] : []),
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
        ...(state.picker.groups ? [{ key: '←→', label: 'expand' }] : []),
        { key: 'Enter', label: 'select' },
        { key: 'Esc', label: 'cancel' },
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
      ? [
          { key: 'Enter', label: 'queue' },
          ...(state.queue.length > 0 ? [{ key: 'Ctrl+X', label: 'drop queued' }] : []),
          ...(state.subagents.length > 1 ? [{ key: 'Tab', label: 'subagent' }] : []),
          ...(tasks.length > 0 ? [{ key: 'Ctrl+S', label: 'tasks' }] : []),
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

  // While the agent runs, the elapsed time and the token count live on the
  // working line directly above the prompt, where the eye already is. Repeating
  // them in the footer was the same three facts twice on one screen.
  const status = interruptArmed ? 'press Ctrl+C again to quit' : undefined;
  const working =
    agentTurnStartedAt !== null ? (
      <Working
        seed={turn}
        since={agentTurnStartedAt}
        tokens={completionMeter.tokens}
        estimated={completionMeter.estimated}
      />
    ) : undefined;
  const promptStatus = planMode ? (
    <Text color={color('accent')}>plan mode · read-only · /plan off to work</Text>
  ) : working;

  // A dialog is the only thing on screen worth attention, and the prompt line
  // already carries the elapsed time and "Esc to cancel". A spinner underneath
  // a permission prompt is noise that costs four lines nobody has to spare.
  //
  // Compaction takes it over too: both are "the agent is busy", but only one of
  // them can say what it is busy *with* and how far along it is, so the vaguer
  // one steps aside rather than the two stacking.
  const workRows = workDockHeight(tasks, state.subagents, workDockOpen);
  const discoveryRows = discoveryHeight(state.discovery.calls, state.discovery.open);

  // How many rows a list-style dialog may use. Shrinks with the window so the
  // dialog itself never becomes the thing that overflows it.
  const pickerRows = Math.max(3, Math.min(12, rows - 12));
  const compactDialogs = rows < 34;
  const suggestionRows = Math.max(1, Math.min(6, surface.contentHeight - 8));

  // Everything Ink has to repaint, other than the timeline. Deliberately
  // generous: overestimating costs one row of history, underestimating puts the
  // frame at terminal height and duplicates the whole session.
  const chrome =
    12 + // header, rounded prompt frame, its separation and footer
    1 + // footer
    plifDockHeight(effort) +
    workRows +
    (showCompletions ? suggestionRows + (completions.length > suggestionRows ? 1 : 0) : 0) +
    (showEmoji ? suggestionRows + (emojiMatches.length > suggestionRows ? 1 : 0) : 0) +
    queueHeight(state.queue) +
    (state.picker && !state.question ? pickerRows + 10 : 0) +
    (state.approval ? approvalHeight(compactDialogs) : 0) +
    (state.question ? questionHeight(state.question, compactDialogs, state.questionExpanded) : 0) +
    (state.compaction ? COMPACTION_HEIGHT + 1 : 0) +
    discoveryRows +
    (state.exiting ? 1 : 0) +
    // The comparison is `>=`, so a frame that exactly fills the window still
    // repaints — and `estimateHeight` is an estimate, which means it is
    // sometimes low. Three spare lines cost three rows of history and buy the
    // difference between "fits" and "the session prints twice".
    3;
  // Zero is a legitimate answer. On a short window with a dialog open there is
  // genuinely no room for history, and showing two orphaned rows at the cost of
  // duplicating the session is the wrong trade.
  const timelineBudget = Math.max(0, surface.contentHeight - chrome);
  const animationActive =
    ['plif', 'max', 'ultra', 'ultracode'].includes(effort ?? '') ||
    state.busy ||
    state.compaction !== null ||
    state.browser?.loading === true ||
    tasks.some((task) => task.status === 'running' || task.status === 'awaiting_approval') ||
    state.subagents.some((view) => view.status === 'running') ||
    state.discovery.calls.some((call) => call.ok === undefined);

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
    <AnimationClockProvider active={animationActive}>
    <Box flexDirection="column">
      {/*
        Scrollback. Ink prints each item once, above the frame, and never again
        — which is both why history survives here and why the array behind it
        must only ever grow. The key is what makes /clear safe: a new key is a
        new component with a fresh count, rather than the same one being handed
        a shorter list it will misread.
      */}
      <Static key={state.epoch} items={state.committed as TimelineEntry[]}>
        {(item) => (
          <Box key={item.id} paddingX={layout.gutter}>
            <TimelineRow entry={item} width={width - layout.gutter * 2} />
          </Box>
        )}
      </Static>

      {transcriptViewport.open ? (
        <TranscriptOverlay
          cells={transcript.state.finalized}
          active={transcript.state.active}
          viewport={transcriptViewport}
          width={width}
          height={terminalFrameRows(rows)}
        />
      ) : state.browser && !state.question ? (
        /*
          Full-screen, replacing the normal panel rather than sitting above it.
          Browser and transcript views keep the physical terminal dimensions so
          their dense tables are not clipped by the quiet interactive shell.
        */
        <Box
          flexDirection="column"
          {...{ height: sessionFrameHeight(rows, 'browser'), overflowY: 'hidden' as const }}
        >
          <Browser
            state={state.browser}
            servers={mcpStatuses}
            skills={skillList}
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
            <Header
              cwd={cwd}
              width={surface.contentWidth}
              model={provider?.info.id ?? ''}
              effort={effort}
              version={version}
            />

            <WorkDock
              tasks={tasks}
              subagents={state.subagents}
              subagentFocus={state.subagentFocus}
              expanded={workDockOpen}
              width={surface.contentWidth}
              now={now}
            />

            <Box flexDirection="column">
              <Timeline
                entries={state.entries}
                width={surface.contentWidth}
                maxLines={timelineBudget}
              />
            </Box>

            {state.picker && !state.question && (
              <Box paddingX={1}>
                <Picker
                  title={state.picker.title}
                  {...(state.picker.groups
                    ? { groups: state.picker.groups, expanded: state.picker.expanded }
                    : { items: filterItems(state.picker.items ?? [], state.picker.filter) })}
                  filter={state.picker.filter}
                  selected={state.picker.selected}
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

            <Box flexGrow={1} />

            {showCompletions && (
              <Completions matches={completions} selected={completionIndex} maxRows={suggestionRows} width={Math.max(1, surface.contentWidth - 2)} />
            )}

            {showEmoji && (
              <EmojiMenu matches={emojiMatches} selected={emojiIndex} maxRows={suggestionRows} width={Math.max(1, surface.contentWidth - 2)} />
            )}

            <Box flexDirection="column" flexShrink={0}>
              <Prompt
                value={input}
                cursor={cursor}
                placeholder={
                  // Short enough to survive a narrow terminal without being clipped
                  // mid-word.
                  state.container ? 'run a command, or / for commands' : 'describe a task, or / for commands'
                }
                // Focused while busy too: the field takes input the whole time, and
                // an unfocused-looking box that nonetheless accepts typing is a lie
                // about where the keystrokes are going.
                focused={!state.approval && !state.question && !state.picker}
                busy={state.busy}
                busyLabel={state.busyLabel}
                width={surface.contentWidth}
                {...(promptStatus ? { status: promptStatus } : {})}
                frameActive={['plif', 'max', 'ultra', 'ultracode'].includes(effort ?? '') || state.busy}
                {...(['plif', 'max', 'ultra', 'ultracode'].includes(effort ?? '')
                  ? {
                      frameFooter: (
                        <PlifDock
                          cwd={cwd}
                          effort={effort}
                          contextUsed={state.contextUsed}
                          contextMax={state.contextMax}
                          working={state.busy}
                          width={Math.max(18, surface.contentWidth - 4)}
                        />
                      ),
                    }
                  : {})}
                {...(state.busySince !== null ? { busySince: state.busySince } : {})}
                {...(state.queue.length > 0
                  ? {
                      queue: (
                        <Queue
                          messages={state.queue}
                          selected={queuedIndex}
                          width={Math.max(1, surface.contentWidth - 4)}
                        />
                      ),
                    }
                  : {})}
              />
              <Footer hints={hints} width={surface.contentWidth} {...(status ? { status } : {})} />
            </Box>

            {state.exiting && (
              <Box paddingX={1}>
                <Text color={color('muted')}>stopping containers…</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
    </AnimationClockProvider>
  );
}
