/**
 * Typed event bus.
 *
 * The core never renders anything and never prompts. It emits events, and the
 * CLI subscribes. That separation is what lets the same engine drive an
 * interactive TUI, a CI runner, or a test harness without branching on which
 * one is attached.
 *
 * Handlers are isolated: one throwing handler must not stop the others or
 * unwind the engine operation that emitted the event. A rendering bug should
 * never kill a running container.
 */

import type { ContainerState, ExecResult, ResourceUsage } from '../types.js';
import type { Decision, PolicyAction, PolicyVerdict } from '../policy/policy.js';
import type { SandboxCapabilityReport } from '@plif/sandbox';
import type { McpAuthEvent } from '../auth/mcp-oauth.js';
import type { ConversationEvent } from '../session/events.js';
import type { StreamTiming } from '../model/stream-timing.js';
import type { CompactionFailure } from '../harness/compaction.js';

export interface QuestionOption {
  /** Text submitted when this row is selected. */
  readonly value: string;
  /** Short, scan-friendly title. */
  readonly label: string;
  /** Optional second line explaining the trade-off. */
  readonly description?: string;
}

export interface PlifEvents {
  /** Stable semantic boundaries used by persistence and transcript projection. */
  'conversation.event': ConversationEvent;
  'task.created': {
    taskId: string;
    title: string;
    argv: readonly string[];
    containerId: string;
  };
  'task.started': { taskId: string; at: number };
  'task.output': { taskId: string; stream: 'stdout' | 'stderr'; chunk: string };
  'task.finished': {
    taskId: string;
    status: 'done' | 'failed' | 'cancelled';
    exitCode: number;
    durationMs: number;
  };
  'task.blocked': { taskId: string; reason: string };
  'engine.ready': {
    root: string;
    sandbox: SandboxCapabilityReport;
  };
  'container.state': {
    containerId: string;
    name: string;
    from: ContainerState;
    to: ContainerState;
  };
  'container.usage': {
    containerId: string;
    usage: ResourceUsage;
  };
  'policy.decision': {
    containerId: string;
    action: PolicyAction;
    target: string;
    verdict: PolicyVerdict;
  };
  'approval.request': {
    id: string;
    containerId: string;
    action: PolicyAction;
    target: string;
    argv: readonly string[] | undefined;
    reason: string;
    /** Why the policy stopped here, in the rule author's words. */
    rationale: string;
  };
  'approval.response': {
    id: string;
    decision: Decision;
    /** Whether the answer applies to future identical requests this session. */
    remember: boolean;
  };
  'exec.start': {
    containerId: string;
    execId: string;
    argv: readonly string[];
    cwd: string;
  };
  'exec.output': {
    containerId: string;
    execId: string;
    stream: 'stdout' | 'stderr';
    chunk: string;
  };
  'exec.end': {
    containerId: string;
    execId: string;
    result: ExecResult;
  };
  /** The agent is stuck and wants information — not permission. */
  'question.asked': {
    id: string;
    text: string;
    options: readonly QuestionOption[] | undefined;
    context: string | undefined;
    /** A credential. The interface must mask what is typed. */
    secret?: boolean;
  };
  'question.answered': {
    id: string;
    /** Null when it timed out. The loop must not treat that as agreement. */
    answer: string | null;
    /** Answered, but the value is a credential and is deliberately withheld. */
    redacted?: boolean;
  };
  'agent.turn': {
    /** Which pass through the loop this is, 1-based. */
    iteration: number;
    maxIterations: number;
  };
  /** The bounded Plan → Work → Review lifecycle used by edit-capable loops. */
  'agent.phase': {
    phase: 'plan' | 'work' | 'review' | 'complete';
    reason: 'turn_started' | 'plan_ready' | 'change_applied' | 'review_required' | 'completed';
  };
  /** A model/tool cycle finished and the loop is about to ask the model again. */
  'agent.cycle': {
    iteration: number;
    durationMs: number;
    toolCalls: number;
  };
  'agent.text': {
    delta: string;
  };
  /**
   * Prose emitted before a model asks for tools.
   *
   * It remains in the assistant message sent back to the provider, but the UI
   * decides whether it is transient clipped prose or a compact activity line.
   */
  'agent.pre_tool_prose': {
    iteration: number;
    text: string;
    visibility: 'transient' | 'activity';
  };
  /** Thinking from a reasoning model, as it is written. */
  'agent.reasoning': {
    delta: string;
  };
  /**
   * The brackets around a thinking block.
   *
   * The deltas alone cannot say when thinking *stopped* — the model simply
   * starts emitting on the other channel instead, and an interface watching
   * only `agent.reasoning` leaves a spinner running under a block that finished
   * a minute ago. The loop knows, because it sees both channels and the end of
   * the stream, so it says so.
   */
  'agent.thinking': {
    phase: 'start' | 'end';
    /** Set on `end`: how long the model spent in this block. */
    durationMs?: number;
  };
  /**
   * The endpoint failed and the turn is being attempted again.
   *
   * Emitted before the wait, not after, so the interface can say how long the
   * silence is going to be. Four minutes of retrying with nothing on screen is
   * indistinguishable from a hang, and the developer's reasonable response to a
   * hang — kill it — is the wrong move here.
   */
  'agent.retry': {
    attempt: number;
    of: number;
    waitMs: number;
    reason: string;
  };
  /** Discard the current turn's output; it is being redone from scratch. */
  'agent.reset': { reason: string };
  /** Redacted request/stream paint timing for optional diagnostics. */
  'stream.timing': StreamTiming;
  /** Messages the human queued mid-turn have been handed to the model. */
  'agent.dequeued': { count: number };
  'agent.tool': {
    /**
     * The call id from the wire.
     *
     * Required once calls can run in parallel: several rows are open at the
     * same time, and matching an `end` to its `start` by tool name alone picks
     * the wrong one as soon as the model reads two files at once.
     */
    id: string;
    name: string;
    /** Parsed arguments, or the raw string when it would not parse. */
    input: unknown;
    phase: 'start' | 'end';
    ok?: boolean;
    durationMs?: number;
    /**
     * Terminal-facing output on `end`. This is intentionally separate from
     * the complete result handed to the model: reads inform the agent without
     * pasting whole files into the developer's timeline.
     */
    output?: string;
    /**
     * A unified diff, when the call changed a file.
     *
     * Carried separately from `output` so the interface can colour it and the
     * model does not have to read it. What the developer needs to see about an
     * edit and what the model needs to be told about it are different things,
     * and merging them serves neither.
     */
    diff?: string;
  };
  /**
   * What one turn cost, and how full the window now is.
   *
   * `promptTokens` is the whole conversation as the endpoint counted it, so it
   * is the context gauge — not a running total to add up. `estimated` marks the
   * turns where the endpoint reported nothing and the number was counted here
   * instead, which is close but not authoritative.
   */
  'agent.usage': {
    promptTokens: number;
    completionTokens: number;
    /** The point at which the loop compacts, or 0 when compaction is off. */
    budget: number;
    estimated: boolean;
  };
  /**
   * How far along a delegated investigation is.
   *
   * The subagent's own tool calls run on a private bus and never reach here —
   * that is the point of delegating, and relaying them would put back exactly
   * the noise it removes. Only a count crosses over, so a two-minute
   * investigation does not look like a hang.
   *
   * There is no start or end event: the `agent.tool` pair for the `subagent`
   * call already brackets it, and `callId` is what ties this to that row.
   * Emitting a second pair produced two rows for one investigation.
   */
  'subagent.progress': { callId: string; toolCalls: number; lastTool: string };
  /** Live context usage from a child agent's private loop. */
  'subagent.usage': {
    taskId: string;
    promptTokens: number;
    completionTokens: number;
    budget: number;
  };
  'subagent.started': {
    taskId: string;
    /** The parent tool call this belongs to, so its row can be found. */
    callId: string | undefined;
    title: string;
    model: string;
    /** Declared context window of the selected child model. */
    contextMax: number;
    at: number;
  };
  /**
   * One line of what a delegated agent is doing, for its panel.
   *
   * Distinct from `subagent.progress`, which is a count for the parent's own
   * timeline row. This is the content of the child's view: the tools it ran,
   * the thinking it did, the answer it reached. It stays out of the parent's
   * transcript — a subagent exists so its steps do not land there — and goes
   * only to the panel that shows the child as its own small session.
   */
  'subagent.activity': {
    taskId: string;
    kind: 'thinking' | 'reasoning' | 'tool' | 'text';
    label: string;
    /** Set for `tool` once it has finished. */
    ok?: boolean;
    durationMs?: number;
  };
  'subagent.finished': {
    taskId: string;
    status: 'done' | 'failed' | 'cancelled';
    at: number;
    durationMs: number;
    /** First line of the answer, for the collapsed row. */
    summary: string;
  };
  /**
   * A compaction pass, stage by stage.
   *
   * Emitted per stage rather than once at the start, because compaction can
   * take minutes when it reaches the summarising stage — it is a whole model
   * call over the transcript — and a progress line that cannot move is
   * indistinguishable from a hang. `step` is the position in the fixed ladder,
   * not a count of what ran, so the proportion means the same thing every time.
   */
  'agent.compacting': {
    stage: string;
    /** 1-based position in the ladder. */
    step: number;
    steps: number;
    /** Tokens in the conversation when the pass began. */
    before: number;
    /** What it is trying to get under. */
    target: number;
  };
  'agent.compacted': {
    before: number;
    after: number;
    stages: readonly string[];
    summarised: boolean;
    /** Present when capsule generation failed, including the safe fallback used. */
    failure?: CompactionFailure;
  };
  'mcp.connected': {
    server: string;
    transport: 'stdio' | 'http';
    tools: readonly string[];
  };
  'auth.required': McpAuthEvent;
  'mcp.status': {
    server: string;
    transport: 'stdio' | 'http';
    connected: boolean;
    toolCount: number;
    detail: string;
  };
  'lsp.ready': {
    server: string;
    label: string;
    root: string;
  };
  'limit.exceeded': {
    containerId: string;
    limit: string;
    actual: number;
    ceiling: number;
  };
  'log': {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    detail?: Record<string, unknown>;
  };
}

export type EventName = keyof PlifEvents;
export type Handler<K extends EventName> = (payload: PlifEvents[K]) => void;

export class EventBus {
  #handlers = new Map<EventName, Set<(payload: never) => void>>();
  #onHandlerError: (error: unknown, event: EventName) => void;

  constructor(onHandlerError?: (error: unknown, event: EventName) => void) {
    this.#onHandlerError =
      onHandlerError ??
      ((error, event) => {
        // Last resort. A subscriber that throws is a bug in the subscriber, and
        // swallowing it entirely would make that bug invisible.
        process.emitWarning(
          `plif: event handler for "${event}" threw: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  on<K extends EventName>(event: K, handler: Handler<K>): () => void {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => {
      set?.delete(handler as (payload: never) => void);
    };
  }

  once<K extends EventName>(event: K, handler: Handler<K>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  emit<K extends EventName>(event: K, payload: PlifEvents[K]): void {
    const set = this.#handlers.get(event);
    if (!set) return;
    // Copy before iterating: a handler that unsubscribes during dispatch would
    // otherwise mutate the set we are walking.
    for (const handler of [...set]) {
      try {
        (handler as Handler<K>)(payload);
      } catch (error) {
        this.#onHandlerError(error, event);
      }
    }
  }

  /** Resolve on the next occurrence, or reject on timeout. */
  wait<K extends EventName>(event: K, timeoutMs: number): Promise<PlifEvents[K]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for "${event}" after ${timeoutMs}ms`));
      }, timeoutMs);
      const off = this.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  removeAll(): void {
    this.#handlers.clear();
  }
}
