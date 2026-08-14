/**
 * What the CLI is currently showing.
 *
 * Kept as plain data with a small reducer rather than scattered `useState`
 * calls, so that every visual change is the result of a named, inspectable
 * action. When a rendering bug appears, the question becomes "which action
 * produced this state" instead of "which of eleven setters ran last".
 */

import { DEFAULT_CONTEXT_TOKENS, diffStats, parseDiff } from '@plif/core';
import type { Catalog, Decision, PolicyAction } from '@plif/core';
import type { ModelSelection } from '@plif/core';
import { filterItems, filterPickerGroups, flattenPickerGroups, pickerRows, preservePickerSelection } from './components/Picker.js';
import type { PickerGroup, PickerItem } from './components/Picker.js';
import type { PastedAttachment } from './composer/state.js';
export type { PastedAttachment, PastedImage, PastedText } from './composer/state.js';

export type EntryKind =
  /** Something the developer typed. */
  | 'input'
  /** A step the agent took: a thought, a tool call, a decision. */
  | 'step'
  /** Output from a command, shown in a rail-prefixed block. */
  | 'output'
  /** Engine or CLI commentary. */
  | 'notice'
  /** A resolved approval, kept in the log as a record. */
  | 'approval'
  /** A question asked by the agent, distinct from a permission gate. */
  | 'question'
  /** The agent's prose answer, rendered as markdown. */
  | 'answer'
  /** A block of model reasoning: one collapsed line, expandable. */
  | 'thinking'
  /** One tool invocation, with its own header/summary/output shape. */
  | 'tool'
  /** A visual boundary between one model/tool cycle and the next. */
  | 'separator';

export type EntryStatus = 'pending' | 'active' | 'done' | 'failed' | 'blocked';

export interface TimelineEntry {
  readonly id: string;
  readonly kind: EntryKind;
  /** The main line. Keep it to one line; put detail in `detail`. */
  readonly title: string;
  /** Dim text after the title on the same line. */
  readonly subtitle?: string;
  /** Multi-line body, rendered under a rail. */
  readonly detail?: string;
  /**
   * Show `detail` in full instead of eliding the middle.
   *
   * Set it for output the user explicitly asked to see — `/help`, `/policy`,
   * `/ps`. Truncating a reference listing is a bug: the answer they wanted may
   * be exactly the line that got dropped, and unlike command output there is no
   * "scroll back and look" because it was never printed.
   */
  readonly expand?: boolean;
  readonly status?: EntryStatus;
  readonly tone?:
    | 'text'
    | 'muted'
    | 'faint'
    | 'accent'
    | 'brand'
    | 'success'
    | 'warn'
    | 'danger'
    | 'info';
  /** Right-aligned tag, e.g. "[done]" or a duration. */
  readonly tag?: string;
  /** What the tool acted on, shown in parentheses after its name. */
  readonly toolTarget?: string;
  /** Stable operational identity; status and colour never replace it. */
  readonly toolCategory?: import('./format.js').ToolCategory;
  /** One line under the tool header: line counts, exit code, bytes written. */
  readonly toolSummary?: string;
  /** On a `thinking` row: how long the block took, once it has finished. */
  readonly durationMs?: number;
  /**
   * A unified diff, on a tool row that changed a file.
   *
   * Held apart from `detail` because it is rendered rather than printed —
   * coloured by syntax, numbered by the file's own line numbers, tinted by
   * side. Putting it in `detail` would show a wall of `+`-prefixed grey text
   * and lose everything that makes a diff readable at a glance.
   */
  readonly diff?: string;
  readonly edits?: readonly { readonly path: string; readonly diff: string }[];
  readonly planItems?: readonly import('./format.js').PlanDisplayItem[];
  readonly executions?: readonly {
    readonly kind?: 'Read' | 'List';
    readonly target?: string;
    readonly output?: string;
    readonly ok?: boolean;
  }[];
  readonly at: number;
}

export interface DiscoveryCall {
  readonly id: string;
  readonly kind: 'Read' | 'List';
  readonly target?: string;
  readonly output?: string;
  readonly ok?: boolean;
}

export interface DiscoveryState {
  readonly calls: readonly DiscoveryCall[];
  readonly open: boolean;
}

/**
 * A question the agent asked the human.
 *
 * Not an approval. An approval is "may I", answerable with a key; this is "I do
 * not know, tell me", and the answer is whatever the developer types. They are
 * separate pieces of state for the same reason they are separate brokers in the
 * core: forcing a question into a yes/no dialog loses the answer.
 */
export interface PendingQuestion {
  readonly id: string;
  readonly text: string;
  readonly options: readonly import('@plif/core').QuestionOption[] | undefined;
  readonly context: string | undefined;
  readonly askedAt: number;
  /** A credential: masked on screen, never echoed back into the timeline. */
  readonly secret?: boolean;
}

/**
 * Something the developer typed while the agent was working.
 *
 * Held rather than sent, and handed over at the next tool call. That boundary
 * is the right one for a reason worth stating: the model is about to re-read
 * the whole conversation anyway to decide what the tool result means, so a line
 * inserted there costs nothing extra and arrives while there is still time to
 * act on it. Interrupting mid-stream would throw away a turn that was fine.
 */
export interface QueuedMessage {
  readonly id: string;
  readonly text: string;
  /** Complete clipboard payloads held until this exact message is delivered. */
  readonly attachments: readonly PastedAttachment[];
}

export type BrowserTab = 'mcp' | 'skills' | 'marketplace';

/** One line in the browser list, flattened so the renderer stays dumb. */
export interface BrowserRow {
  /** Identifies the underlying thing: a server name, a skill name, a plugin name. */
  readonly id: string;
  readonly title: string;
  readonly mark: string;
  readonly tone: 'accent' | 'success' | 'danger' | 'warn' | 'muted' | 'ghost' | 'faint';
}

/**
 * The extension browser: what is installed, and what could be.
 *
 * The catalogue is held here rather than re-fetched per render — three
 * thousand entries is a megabyte and a half, and filtering it is a synchronous
 * pass over an array that has to happen on every keystroke.
 */
export interface BrowserState {
  readonly tab: BrowserTab;
  readonly filter: string;
  readonly selected: number;
  readonly rows: readonly BrowserRow[];
  readonly catalog: Catalog | null;
  readonly loading: boolean;
  readonly problem: string | null;
  /** The catalogue came from disk because the network did not answer. */
  readonly stale: boolean;
}

/** A compaction pass in flight. */
export interface CompactionState {
  readonly stage: string;
  readonly step: number;
  readonly steps: number;
  readonly before: number;
  readonly target: number;
  readonly since: number;
}

export interface SubagentLine {
  readonly kind: 'thinking' | 'reasoning' | 'tool' | 'text';
  readonly label: string;
  readonly ok?: boolean;
  readonly durationMs?: number;
}

/**
 * A delegated agent, as its own small session.
 *
 * Enough state to draw a tab and, when it is the focused one, the last few
 * things it did. Bounded on purpose: this is a live view, not a transcript, and
 * the child's full history belongs to the child.
 */
export interface SubagentView {
  readonly taskId: string;
  readonly title: string;
  readonly model: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly status: 'running' | 'done' | 'failed' | 'cancelled';
  readonly summary: string | null;
  readonly lines: readonly SubagentLine[];
  /** Set while the child is mid-thought, for its animated line. */
  readonly thinkingSince: number | null;
  readonly toolCalls: number;
  /** The child's own context window, updated from its private loop. */
  readonly contextUsed: number;
  readonly contextMax: number;
  readonly completionTokens: number;
}

/** Activity lines kept per subagent. The panel cannot show more. */
const MAX_SUBAGENT_LINES = 8;

export interface PendingApproval {
  readonly id: string;
  readonly containerId: string;
  readonly action: PolicyAction;
  readonly target: string;
  readonly argv: readonly string[] | undefined;
  readonly reason: string;
  readonly rationale: string;
}

export interface PickerState {
  readonly title: string;
  readonly items?: readonly PickerItem[];
  readonly groups?: readonly PickerGroup[];
  readonly expanded?: readonly string[];
  readonly filter: string;
  readonly selected: number;
  readonly onPick: (value: string | ModelSelection) => void;
}

export interface SessionState {
  /**
   * Rows finished with, handed to Ink's `<Static>` and never repainted.
   *
   * Append-only, and it has to be: `<Static>` remembers how many items it has
   * already printed and renders `items.slice(thatMany)`. Shrinking the array
   * makes the count wrong and every later append prints the backlog again. The
   * only legitimate reset is `/clear`, which bumps `epoch` so the component is
   * replaced rather than confused.
   */
  readonly committed: readonly TimelineEntry[];
  /** Incremented by `/clear`, used as the `<Static>` key. */
  readonly epoch: number;
  /** Rows still able to change, rendered into the live frame. */
  readonly entries: readonly TimelineEntry[];
  readonly picker: PickerState | null;
  readonly approval: PendingApproval | null;
  /** Approvals queued behind the one on screen. */
  readonly approvalQueue: readonly PendingApproval[];
  readonly question: PendingQuestion | null;
  readonly questionQueue: readonly PendingQuestion[];
  /** What the developer has typed as a free-form answer. */
  readonly questionDraft: string;
  /** Which suggested option is highlighted, or -1 while typing. */
  readonly questionChoice: number;
  /** Show the question's full context instead of the first few lines. */
  readonly questionExpanded: boolean;
  readonly compaction: CompactionState | null;
  /** Open when /mcp or /skills is showing. Null the rest of the time. */
  readonly browser: BrowserState | null;
  /** Typed while the agent was working, waiting for the next tool call. */
  readonly queue: readonly QueuedMessage[];
  readonly subagents: readonly SubagentView[];
  /** Index into `subagents` of the tab being shown. */
  readonly subagentFocus: number;
  readonly subagentsOpen: boolean;
  readonly discovery: DiscoveryState;
  readonly container: string | null;
  readonly containerState: string | null;
  readonly busy: boolean;
  readonly busyLabel: string;
  /** When the current work started, for the elapsed counter. Null when idle. */
  readonly busySince: number | null;
  readonly contextUsed: number;
  readonly contextMax: number;
  readonly exiting: boolean;
}

export const initialSession: SessionState = {
  committed: [],
  epoch: 0,
  entries: [],
  picker: null,
  approval: null,
  approvalQueue: [],
  question: null,
  questionQueue: [],
  questionDraft: '',
  questionChoice: 0,
  questionExpanded: false,
  compaction: null,
  browser: null,
  queue: [],
  subagents: [],
  subagentFocus: 0,
  subagentsOpen: false,
  discovery: { calls: [], open: false },
  container: null,
  containerState: null,
  busy: false,
  busyLabel: '',
  busySince: null,
  contextUsed: 0,
  contextMax: DEFAULT_CONTEXT_TOKENS,
  exiting: false,
};

export type SessionAction =
  | { type: 'append'; entry: TimelineEntry }
  | { type: 'gate'; entry: TimelineEntry }
  | { type: 'update'; id: string; patch: Partial<TimelineEntry> }
  | {
      type: 'stream.frame';
      patches: readonly { readonly id: string; readonly patch: Partial<TimelineEntry> }[];
    }
  /**
   * Remove a row that should never have been shown.
   *
   * Only for output belonging to an attempt the provider abandoned. Rows are
   * otherwise append-only, and deleting history to tidy the screen is how a log
   * stops being trustworthy — but a half-written answer from a failed attempt
   * is not history, it is a fragment the model never stood behind.
   *
   * Safe because it only ever touches `entries`; `committed` is immutable, and
   * a row that reached scrollback has already been printed to the terminal.
   */
  | { type: 'drop'; id: string }
  | { type: 'toggleLastTool' }
  | { type: 'toggleLastThinking' }
  | { type: 'toggleThinking'; id: string }
  /** Move the settled prefix of `entries` into `committed`. */
  | { type: 'commit'; upTo: number; ids?: readonly string[] }
  | { type: 'clear' }
  | { type: 'approval.push'; approval: PendingApproval }
  | { type: 'approval.resolve' }
  | { type: 'question.push'; question: PendingQuestion }
  | { type: 'question.resolve' }
  | { type: 'question.draft'; draft: string }
  | { type: 'question.move'; delta: number }
  | { type: 'question.expand' }
  | { type: 'compaction.stage'; stage: CompactionState }
  | { type: 'compaction.end' }
  | { type: 'browser.open'; tab: BrowserTab }
  | { type: 'browser.close' }
  | { type: 'browser.tab'; delta: number }
  | { type: 'browser.filter'; filter: string }
  | { type: 'browser.move'; delta: number }
  | { type: 'browser.rows'; rows: readonly BrowserRow[] }
  | { type: 'browser.loading'; loading: boolean }
  | { type: 'browser.catalog'; catalog: Catalog | null; problem?: string }
  | { type: 'queue.push'; message: QueuedMessage }
  | { type: 'queue.drop'; id: string }
  /** Everything queued has been handed to the agent. */
  | { type: 'queue.clear' }
  | { type: 'subagent.start'; view: SubagentView }
  | {
      type: 'subagent.activity';
      taskId: string;
      line: SubagentLine;
      /** Set for a thinking bracket, which changes state rather than adding a line. */
      thinking?: 'start' | 'end';
    }
  | {
      type: 'subagent.finish';
      taskId: string;
      status: SubagentView['status'];
      at: number;
      summary: string;
    }
  | {
      type: 'subagent.usage';
      taskId: string;
      promptTokens: number;
      completionTokens: number;
      budget: number;
    }
  | { type: 'subagent.focus'; delta: number }
  | { type: 'subagent.toggle' }
  | { type: 'subagent.reset' }
  | { type: 'discovery.start'; id: string; kind: DiscoveryCall['kind']; target?: string }
  | { type: 'discovery.finish'; id: string; ok: boolean; output: string }
  | { type: 'discovery.toggle' }
  | { type: 'discovery.reset' }
  | { type: 'discovery.flush' }
  | { type: 'container'; name: string | null; state: string | null }
  | { type: 'busy'; busy: boolean; label?: string; since?: number }
  | { type: 'context'; used: number; max?: number }
  | {
      type: 'picker.open';
      picker: Omit<PickerState, 'filter' | 'selected'> & { selected?: number };
    }
  | { type: 'picker.filter'; filter: string }
  | { type: 'picker.move'; delta: number }
  | { type: 'picker.moveVisible'; delta: number }
  | { type: 'picker.toggle'; id: string }
  | { type: 'picker.close' }
  | { type: 'exit' };

/** Bound on retained entries; the terminal cannot show more and memory is not free. */
const MAX_ENTRIES = 500;

function mergeAdjacentEdits(entries: readonly TimelineEntry[]): TimelineEntry[] {
  const merged: TimelineEntry[] = [];
  for (const entry of entries) {
    const previous = merged.at(-1);
    const mergeable = previous?.kind === 'tool' && previous.title === 'Edited' && previous.status === 'done'
      && entry.kind === 'tool' && entry.title === 'Edited' && entry.status === 'done';
    if (!mergeable) { merged.push(entry); continue; }

    const collect = (item: TimelineEntry): { path: string; diff: string }[] => item.edits
      ? [...item.edits]
      : item.diff && item.toolTarget ? [{ path: item.toolTarget, diff: item.diff }] : [];
    const edits = [...collect(previous), ...collect(entry)];
    if (edits.length < 2) { merged.push(entry); continue; }
    const totals = edits.reduce((sum, edit) => {
      const stats = diffStats(parseDiff(edit.diff));
      return { added: sum.added + stats.added, removed: sum.removed + stats.removed };
    }, { added: 0, removed: 0 });
    merged[merged.length - 1] = {
      ...previous,
      toolTarget: `${edits.length} files`,
      toolSummary: `(+${totals.added} -${totals.removed})`,
      diff: undefined,
      edits,
    };
  }
  return merged;
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'toggleLastTool': {
      const index = [...state.entries].map((item) => item.kind).lastIndexOf('tool');
      if (index < 0) return state;
      return { ...state, entries: state.entries.map((item, itemIndex) => itemIndex === index ? { ...item, expand: !item.expand } : item) };
    }
    case 'toggleLastThinking': {
      const index = [...state.entries].map((item) => item.kind).lastIndexOf('thinking');
      if (index < 0) return state;
      return {
        ...state,
        entries: state.entries.map((item, itemIndex) =>
          itemIndex === index ? { ...item, expand: !item.expand } : item,
        ),
      };
    }
    case 'toggleThinking': {
      const exists = state.entries.some((item) => item.id === action.id && item.kind === 'thinking');
      if (!exists) return state;
      return {
        ...state,
        entries: state.entries.map((item) =>
          item.id === action.id ? { ...item, expand: !item.expand } : item,
        ),
      };
    }

    case 'append': {
      // A separator punctuates something. Two in a row punctuate each other,
      // and one with nothing above it in the live frame punctuates a blank —
      // both are the shapes that made a busy turn look like ruled paper. The
      // guard lives here rather than at the emit site because only the reducer
      // can see what the newest row actually is.
      if (action.entry.kind === 'separator') {
        const previous = state.entries.at(-1);
        if (!previous || previous.kind === 'separator') return state;
      }
      const entries = [...state.entries, action.entry];
      const trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;
      return { ...state, entries: trimmed };
    }

    /**
     * Insert above the task currently in flight.
     *
     * A permission prompt is raised *by* a running task, so the task's row
     * already exists when the question appears. Appending would file the
     * approval below the very action it gated — the log would read "command
     * succeeded" and then "you allowed it", which is backwards. Placing it
     * above the active row restores cause-before-effect.
     */
    case 'gate': {
      const index = state.entries.findIndex((item) => item.status === 'active');
      if (index === -1) return sessionReducer(state, { type: 'append', entry: action.entry });
      return {
        ...state,
        entries: [
          ...state.entries.slice(0, index),
          action.entry,
          ...state.entries.slice(index),
        ],
      };
    }

    case 'update': {
      const entries = state.entries.map((entry) =>
        entry.id === action.id ? { ...entry, ...action.patch } : entry,
      );
      return { ...state, entries: mergeAdjacentEdits(entries) };
    }

    case 'stream.frame': {
      if (action.patches.length === 0) return state;
      const patches = new Map<string, Partial<TimelineEntry>>();
      for (const item of action.patches) {
        patches.set(item.id, { ...patches.get(item.id), ...item.patch });
      }
      const entries = state.entries.map((entry) => {
        const patch = patches.get(entry.id);
        return patch ? { ...entry, ...patch } : entry;
      });
      return { ...state, entries: mergeAdjacentEdits(entries) };
    }

    case 'drop':
      return { ...state, entries: state.entries.filter((item) => item.id !== action.id) };

    case 'commit': {
      const upTo = Math.min(Math.max(0, action.upTo), state.entries.length);
      if (upTo === 0) return state;
      // Effects can replay an action after Ink resizes or StrictMode reruns an
      // effect. Position alone is unsafe: the same `upTo` could now refer to
      // different rows. Only commit when the snapshot still matches exactly.
      const currentIds = state.entries.slice(0, upTo).map((entry) => entry.id);
      if (action.ids && (currentIds.length !== action.ids.length || currentIds.some((id, index) => id !== action.ids?.[index]))) {
        return state;
      }
      return {
        ...state,
        committed: [...state.committed, ...state.entries.slice(0, upTo)],
        entries: state.entries.slice(upTo),
      };
    }

    case 'clear':
      return {
        ...state,
        entries: [],
        committed: [],
        epoch: state.epoch + 1,
        subagents: [],
        subagentFocus: 0,
        discovery: { calls: [], open: false },
      };

    case 'approval.push':
      // One question on screen at a time. Stacking prompts is how a developer
      // ends up approving the wrong thing.
      return state.approval === null
        ? { ...state, approval: action.approval }
        : { ...state, approvalQueue: [...state.approvalQueue, action.approval] };

    case 'approval.resolve': {
      const [next, ...rest] = state.approvalQueue;
      return { ...state, approval: next ?? null, approvalQueue: rest };
    }

    case 'question.push':
      return state.question === null
        ? {
            ...state,
            question: action.question,
            questionDraft: '',
            // Highlight the first suggestion when there is one, and start in
            // free-text mode when there is not — a highlight over nothing is a
            // cursor the developer cannot see.
            questionChoice: action.question.options?.length ? 0 : -1,
            questionExpanded: false,
          }
        : { ...state, questionQueue: [...state.questionQueue, action.question] };

    case 'question.resolve': {
      const [next, ...rest] = state.questionQueue;
      return {
        ...state,
        question: next ?? null,
        questionQueue: rest,
        questionDraft: '',
        questionChoice: next?.options?.length ? 0 : -1,
        questionExpanded: false,
      };
    }

    case 'question.draft':
      // Typing leaves the suggestion list. The suggestions are a shortcut, and
      // a highlight that stays lit while someone types a different answer makes
      // it ambiguous which one Enter will send.
      return { ...state, questionDraft: action.draft, questionChoice: action.draft ? -1 : 0 };

    case 'question.move': {
      const options = state.question?.options ?? [];
      const other = options.length;
      const from = state.questionChoice < 0 ? other : state.questionChoice;
      const next = Math.min(other, Math.max(0, from + action.delta));
      return { ...state, questionChoice: next === other ? -1 : next, questionDraft: '' };
    }

    case 'question.expand':
      return { ...state, questionExpanded: !state.questionExpanded };

    case 'compaction.stage':
      return { ...state, compaction: action.stage };

    case 'compaction.end':
      return { ...state, compaction: null };

    case 'browser.open':
      return {
        ...state,
        browser: {
          tab: action.tab,
          filter: '',
          selected: 0,
          rows: [],
          catalog: state.browser?.catalog ?? null,
          // Only the catalogue needs fetching, and only if it is not already
          // held from a previous open. The other two tabs read local state.
          loading: action.tab === 'marketplace' && !state.browser?.catalog,
          problem: null,
          stale: state.browser?.stale ?? false,
        },
      };

    case 'browser.close':
      return { ...state, browser: null };

    case 'browser.tab': {
      if (!state.browser) return state;
      const order: BrowserTab[] = ['mcp', 'skills', 'marketplace'];
      const at = order.indexOf(state.browser.tab);
      const next = order[(at + action.delta + order.length) % order.length] as BrowserTab;
      return {
        ...state,
        browser: {
          ...state.browser,
          tab: next,
          // The filter is per-tab. Carrying "postgres" from the marketplace
          // into a two-item MCP list shows nothing and looks broken.
          filter: '',
          selected: 0,
          rows: [],
          loading: next === 'marketplace' && !state.browser.catalog,
        },
      };
    }

    case 'browser.filter':
      if (!state.browser) return state;
      return { ...state, browser: { ...state.browser, filter: action.filter, selected: 0 } };

    case 'browser.move': {
      if (!state.browser) return state;
      const count = state.browser.rows.length;
      if (count === 0) return state;
      // Clamped, not wrapped. In a list of three thousand, one press past the
      // bottom landing back at the top is disorienting rather than convenient.
      const next = Math.max(0, Math.min(count - 1, state.browser.selected + action.delta));
      return { ...state, browser: { ...state.browser, selected: next } };
    }

    case 'browser.rows': {
      if (!state.browser) return state;
      return {
        ...state,
        browser: {
          ...state.browser,
          rows: action.rows,
          selected: Math.min(state.browser.selected, Math.max(0, action.rows.length - 1)),
        },
      };
    }

    case 'browser.loading':
      if (!state.browser) return state;
      return { ...state, browser: { ...state.browser, loading: action.loading } };

    case 'browser.catalog':
      if (!state.browser) return state;
      return {
        ...state,
        browser: {
          ...state.browser,
          catalog: action.catalog,
          stale: action.catalog?.stale ?? false,
          loading: false,
          problem: action.problem ?? null,
        },
      };

    case 'queue.push':
      return { ...state, queue: [...state.queue, action.message] };

    case 'queue.drop':
      // Best effort by design. A message the agent has already been handed is
      // gone from this list, so the same keystroke a moment later removes
      // nothing — which is the honest outcome, not a bug to paper over.
      return { ...state, queue: state.queue.filter((item) => item.id !== action.id) };

    case 'queue.clear':
      return { ...state, queue: [] };

    case 'subagent.start':
      return {
        ...state,
        subagents: [...state.subagents, action.view],
        // Follow the newest one. A developer who has focused a tab on purpose
        // is watching it, but nothing was focused on purpose until there are
        // two, and until then following the new one is what they wanted.
        subagentFocus: state.subagents.length,
      };

    case 'subagent.activity':
      return {
        ...state,
        subagents: state.subagents.map((view) => {
          if (view.taskId !== action.taskId) return view;
          if (action.thinking === 'start') return { ...view, thinkingSince: Date.now() };

          // A tool that has finished patches the line its start created rather
          // than adding a second one, so `read_file(x)` does not appear twice
          // with only a tick to tell them apart.
          const last = view.lines[view.lines.length - 1];
          const patchable =
            action.line.kind === 'tool' &&
            action.line.ok !== undefined &&
            last?.kind === 'tool' &&
            last.label === action.line.label &&
            last.ok === undefined;

          const lines = patchable
            ? [...view.lines.slice(0, -1), action.line]
            : [...view.lines, action.line];

          return {
            ...view,
            lines: lines.slice(-MAX_SUBAGENT_LINES),
            ...(action.thinking === 'end' ? { thinkingSince: null } : {}),
            toolCalls:
              action.line.kind === 'tool' && action.line.ok !== undefined
                ? view.toolCalls + 1
                : view.toolCalls,
          };
        }),
      };

    case 'subagent.finish':
      {
        const subagents = state.subagents.filter((view) => view.taskId !== action.taskId);
        return {
          ...state,
          subagents,
          subagentFocus: Math.max(0, Math.min(state.subagentFocus, subagents.length - 1)),
          subagentsOpen: subagents.length > 0 && state.subagentsOpen,
        };
      }

    case 'subagent.usage':
      return {
        ...state,
        subagents: state.subagents.map((view) =>
          view.taskId === action.taskId
            ? {
                ...view,
                contextUsed: action.promptTokens,
                contextMax: action.budget || view.contextMax,
                completionTokens: action.completionTokens,
              }
            : view,
        ),
      };

    case 'subagent.focus': {
      if (state.subagents.length === 0) return state;
      const next =
        (state.subagentFocus + action.delta + state.subagents.length) % state.subagents.length;
      return { ...state, subagentFocus: next };
    }

    case 'subagent.toggle':
      return { ...state, subagentsOpen: !state.subagentsOpen };

    case 'subagent.reset':
      return { ...state, subagents: [], subagentFocus: 0, subagentsOpen: false };

    case 'discovery.start':
      return {
        ...state,
        discovery: {
          ...state.discovery,
          calls: [...state.discovery.calls, {
            id: action.id,
            kind: action.kind,
            ...(action.target ? { target: action.target } : {}),
          }].slice(-100),
        },
      };

    case 'discovery.finish':
      return {
        ...state,
        discovery: {
          ...state.discovery,
          calls: state.discovery.calls.map((call) => call.id === action.id
            ? { ...call, ok: action.ok, ...(action.output ? { output: action.output } : {}) }
            : call),
        },
      };

    case 'discovery.toggle':
      return { ...state, discovery: { ...state.discovery, open: !state.discovery.open } };

    case 'discovery.reset':
      return { ...state, discovery: { calls: [], open: false } };

    case 'discovery.flush': {
      if (state.discovery.calls.length === 0) return state;
      const reads = state.discovery.calls.filter((call) => call.kind === 'Read').length;
      const lists = state.discovery.calls.filter((call) => call.kind === 'List').length;
      const parts = [reads ? `Read ${reads}x` : '', lists ? `List ${lists}x` : ''].filter(Boolean);
      const summary = entry('tool', 'Executed', {
        status: 'done',
        toolTarget: parts.join(` ${String.fromCharCode(183)} `),
        executions: state.discovery.calls.map(({ kind, target, output, ok }) => ({
          kind,
          ...(target ? { target } : {}),
          ...(output ? { output } : {}),
          ...(ok !== undefined ? { ok } : {}),
        })),
      });
      return {
        ...state,
        entries: [...state.entries, summary],
        discovery: { calls: [], open: false },
      };
    }

    case 'container':
      return { ...state, container: action.name, containerState: action.state };

    case 'busy':
      return {
        ...state,
        busy: action.busy,
        busyLabel: action.busy ? (action.label ?? '') : '',
        busySince: action.busy ? (action.since ?? Date.now()) : null,
      };

    case 'context':
      return {
        ...state,
        contextUsed: action.used,
        contextMax: action.max ?? state.contextMax,
      };

    case 'picker.open':
      return {
        ...state,
        picker: { ...action.picker, filter: '', selected: action.picker.selected ?? 0 },
      };

    case 'picker.filter': {
      if (!state.picker) return state;
      if (state.picker.groups) {
        const matches = pickerRows(state.picker.groups, state.picker.expanded ?? [], action.filter);
        const previous = pickerRows(state.picker.groups, state.picker.expanded ?? [], state.picker.filter);
        return {
          ...state,
          picker: {
            ...state.picker,
            filter: action.filter,
            selected: preservePickerSelection(previous, state.picker.selected, matches),
          },
        };
      }
      const matches = filterItems(state.picker.items ?? [], action.filter);
      const previous = state.picker.groups
        ? pickerRows(state.picker.groups, state.picker.expanded ?? [], state.picker.filter)
        : [];
      return {
        ...state,
        picker: {
          ...state.picker,
          filter: action.filter,
          selected: Math.min(state.picker.selected, Math.max(0, matches.length - 1)),
        },
      };
    }

    case 'picker.move': {
      if (!state.picker) return state;
      const matches = filterItems(state.picker.items ?? [], state.picker.filter);
      if (matches.length === 0) return state;
      const next = (state.picker.selected + action.delta + matches.length) % matches.length;
      return { ...state, picker: { ...state.picker, selected: next } };
    }

    case 'picker.moveVisible': {
      if (!state.picker?.groups) return state;
      const matches = pickerRows(state.picker.groups, state.picker.expanded ?? [], state.picker.filter);
      if (matches.length === 0) return state;
      const next = (state.picker.selected + action.delta + matches.length) % matches.length;
      return { ...state, picker: { ...state.picker, selected: next } };
    }

    case 'picker.toggle': {
      if (!state.picker?.groups) return state;
      const expanded = new Set(state.picker.expanded ?? []);
      if (expanded.has(action.id)) {
        expanded.delete(action.id);
        // Collapsing a provider forgets that its long tail was showing, so
        // reopening it starts from the ranked ten again rather than dumping
        // two hundred models back onto the screen.
        expanded.delete(`${action.id}:all`);
      } else {
        expanded.add(action.id);
      }
      const nextExpanded = [...expanded];
      const previous = pickerRows(state.picker.groups, state.picker.expanded ?? [], state.picker.filter);
      const matches = pickerRows(state.picker.groups, nextExpanded, state.picker.filter);
      return {
        ...state,
        picker: {
          ...state.picker,
          expanded: nextExpanded,
          selected: preservePickerSelection(previous, state.picker.selected, matches),
        },
      };
    }

    case 'picker.close':
      return { ...state, picker: null };

    case 'exit':
      return { ...state, exiting: true };
  }
}

let counter = 0;

export function entry(
  kind: EntryKind,
  title: string,
  extra: Partial<Omit<TimelineEntry, 'id' | 'kind' | 'title' | 'at'>> = {},
): TimelineEntry {
  return { id: `e${++counter}`, kind, title, at: Date.now(), ...extra };
}

export function decisionTone(decision: Decision): TimelineEntry['tone'] {
  return decision === 'allow' ? 'success' : decision === 'deny' ? 'danger' : 'warn';
}
