import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentConfig } from '../config/global.js';
import { EventBus } from '../events/bus.js';
import type { PlifEvents } from '../events/bus.js';
import {
  customProvidersOf,
  formatModelRef,
  keyOptional,
  parseModelRef,
  providerIdForConfig,
  resolveConfig,
  subagentEffortFor,
  validate,
} from '../model/config.js';
import type { Effort, StoredConfig } from '../model/config.js';
import { createModelProvider } from '../model/factory.js';
import type { Message, ModelProvider } from '../model/provider.js';
import { DEFAULT_CONTEXT_TOKENS, runLoop } from './loop.js';
import type { SkillBootstrap } from './loop.js';
import { stableToolSpecs } from './context-budget.js';
import { buildSystemPrompt } from './prompt.js';
import { summariseMemory } from './memory.js';
import type { MemoryStore } from './memory.js';
import { conversationFromTranscript } from '../session/resume.js';
import { eventBase } from '../session/events.js';
import type { Session, SessionStore } from '../session/store.js';
import {
  applyPatch,
  editFile,
  globFiles,
  grepFiles,
  listDir,
  readFile,
  runCommand,
  shellCommand,
  terminalClose,
  terminalRead,
  terminalResize,
  terminalSignal,
  terminalStart,
  terminalWrite,
  updatePlan,
  writeFile,
} from './tools.js';
import type { EditCoordinator } from './edits.js';
import type { Tool } from './tools.js';
import type { ShellDialect } from '../execution/shell-dialects.js';

export interface SubagentOptions {
  /** The parent's provider, used when no model is named. */
  readonly provider: ModelProvider;
  readonly isolation: string;
  /** The resolved config file, so a named model resolves the same way the main one does. */
  readonly stored: StoredConfig;
  /** Resolve a provider-specific credential without putting it back in config. */
  readonly resolveCredential?: (provider: string, stored: StoredConfig) => Promise<string | undefined>;
  /** Injectable factory for deterministic integration tests. */
  readonly createProvider?: (config: ReturnType<typeof resolveConfig>) => ModelProvider;
  /** Named agents from `agent: {}` in the config. */
  readonly agents?: Readonly<Record<string, AgentConfig>>;
  /** When false, a configured named agent requires an explicit user request. */
  readonly agentAutoLaunch?: boolean;
  readonly maxIterations?: number;
  /** Passed through to the child — the LSP and web tools, in practice. */
  readonly extraTools?: readonly Tool[];
  readonly edits?: EditCoordinator;
  readonly coordinator?: SubagentCoordinator;
  readonly agentInstructions?: string;
  /** The parent's routable skill catalogue, inherited by the child prompt. */
  readonly skillCatalogue?: string;
  /** Mandatory skill bodies for native providers that cannot call host tools. */
  readonly skillBootstrap?: readonly SkillBootstrap[];
  /** Inherited from the parent session; subagents never resolve a new dialect. */
  readonly shellDialect?: ShellDialect;
  /** Persist children and expose send_message when true and a store exists. */
  readonly continuable?: boolean;
  readonly sessions?: SessionStore;
  readonly memory?: MemoryStore;
  readonly parentSession?: Session;
  readonly parentSessionId?: string;
  readonly parentContext?: readonly Message[] | (() => readonly Message[]);
}

export interface SubagentRecord {
  readonly subagentId: string;
  readonly sessionId: string;
  readonly workspace: string;
  readonly modelRef: string;
  readonly title: string;
  readonly provider: ModelProvider;
  readonly maxIterations: number;
  readonly effort?: Effort;
  readonly compatibilityId?: string;
  readonly forkedFrom?: string;
}

export class SubagentCoordinator {
  #running = new Map<string, AbortController>();
  #records = new Map<string, SubagentRecord>();
  #taskRecords = new Map<string, string>();
  #lanes = new Map<string, Promise<void>>();

  register(taskId: string, controller: AbortController, record?: SubagentRecord): void {
    this.#running.set(taskId, controller);
    if (record) {
      this.#records.set(record.subagentId, record);
      this.#taskRecords.set(taskId, record.subagentId);
      this.#runningSubagents.add(record.subagentId);
    }
  }

  finish(taskId: string): void {
    this.#running.delete(taskId);
    const subagentId = this.#taskRecords.get(taskId);
    if (subagentId) this.#taskRecords.delete(taskId);
    if (subagentId) this.#runningSubagents.delete(subagentId);
  }

  #runningSubagents = new Set<string>();

  isRunning(subagentId: string): boolean {
    return this.#runningSubagents.has(subagentId);
  }

  async enqueue<T>(subagentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#lanes.get(subagentId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(() => undefined, () => undefined);
    this.#lanes.set(subagentId, tail);
    try {
      return await current;
    } finally {
      if (this.#lanes.get(subagentId) === tail) this.#lanes.delete(subagentId);
    }
  }

  cancel(taskId: string): boolean {
    const controller = this.#running.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  get(subagentId: string): SubagentRecord | undefined {
    return this.#records.get(subagentId);
  }
}

const DEFAULT_MAX_ITERATIONS = 12;

/**
 * The tools a subagent gets.
 *
 * File discovery, edits and command execution, plus whatever the parent passes
 * through. The shared edit coordinator prevents silent concurrent clobbering.
 * Deliberately missing:
 *
 * - `ask_user`, because there is nothing to ask. The broker would hang or the
 *   non-interactive responder would deny, and either wastes the whole run.
 * - `subagent`, because recursion is unbounded fan-out with no human in the
 *   loop and no budget that composes.
 * - the task tools, because a background job outliving the subagent that
 *   started it has no owner.
 */
export function subagentTools(extra?: readonly Tool[]): Tool[];
export function subagentTools(
  shellDialect: ShellDialect | null,
  extra?: readonly Tool[],
): Tool[];
export function subagentTools(
  dialectOrExtra: ShellDialect | readonly Tool[] | null = null,
  additional: readonly Tool[] = [],
): Tool[] {
  const oldSignature = Array.isArray(dialectOrExtra);
  const shellDialect = oldSignature ? null : dialectOrExtra as ShellDialect | null;
  const extra = oldSignature ? dialectOrExtra as readonly Tool[] : additional;
  const tools = [
    readFile,
    updatePlan,
    writeFile,
    editFile,
    applyPatch,
    listDir,
    globFiles,
    grepFiles,
    runCommand,
    terminalStart,
    terminalWrite,
    terminalRead,
    terminalResize,
    terminalSignal,
    terminalClose,
    ...(shellDialect ? [shellCommand] : []),
  ];
  const forbidden = new Set([
    'ask_user',
    'request_user_input',
    'subagent',
    'spawn_agent',
    'start_task',
    'list_tasks',
    'task_status',
    'cancel_task',
    'send_message',
    'run_script',
    'remember',
    'forget_memory',
  ]);
  const names = new Set(tools.map((tool) => tool.spec.name));
  for (const tool of extra) {
    if (forbidden.has(tool.spec.name) || names.has(tool.spec.name)) continue;
    names.add(tool.spec.name);
    tools.push(tool);
  }
  return tools;
}

/**
 * The one argument worth showing next to a tool name.
 *
 * A path, a command, a query — whichever the call carries. The panel gives each
 * line about half a terminal width, so this picks one field rather than
 * rendering the arguments object and letting it be truncated into nonsense.
 */
function summarise(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const fields = input as Record<string, unknown>;
  const argv = fields['argv'];
  if (Array.isArray(argv)) return argv.join(' ').slice(0, 60);
  for (const key of ['script', 'path', 'query', 'url', 'pattern', 'name', 'title']) {
    const value = fields[key];
    if (typeof value === 'string' && value) return value.slice(0, 60);
  }
  return '';
}

interface Resolved {
  readonly ref: string;
  readonly provider: ModelProvider;
  readonly free: boolean;
  readonly maxIterations: number | undefined;
  readonly effort: Effort | undefined;
  readonly agentName?: string;
  readonly instructions?: string;
}

interface SubagentManifest {
  readonly subagentId: string;
  readonly sessionId: string;
  readonly workspace: string;
  readonly modelRef: string;
  readonly title: string;
  readonly maxIterations: number;
  readonly effort?: Effort;
  readonly compatibilityId?: string;
  readonly forkedFrom?: string;
}

function manifestPath(sessions: SessionStore, sessionId: string): string {
  return path.join(sessions.root, 'subagents', `${sessionId}.json`);
}

async function saveManifest(sessions: SessionStore, manifest: SubagentManifest): Promise<void> {
  const target = manifestPath(sessions, manifest.sessionId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(target, { force: true });
    await fs.rename(temp, target).catch(() => { throw error; });
  }
}

async function loadManifest(sessions: SessionStore, sessionId: string): Promise<SubagentManifest | null> {
  try {
    const value = JSON.parse(await fs.readFile(manifestPath(sessions, sessionId), 'utf8')) as SubagentManifest;
    return value && value.sessionId === sessionId && typeof value.subagentId === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function loadManifestByReference(
  sessions: SessionStore,
  reference: string,
): Promise<SubagentManifest | null> {
  const direct = await loadManifest(sessions, reference);
  if (direct) return direct;
  let files: string[];
  try {
    files = await fs.readdir(path.join(sessions.root, 'subagents'));
  } catch {
    return null;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const value = JSON.parse(await fs.readFile(path.join(sessions.root, 'subagents', file), 'utf8')) as SubagentManifest;
      if (
        value &&
        typeof value.sessionId === 'string' &&
        typeof value.subagentId === 'string' &&
        (value.subagentId === reference ||
          value.subagentId === `subagent:${reference}` ||
          value.subagentId.startsWith(reference) ||
          value.compatibilityId === reference ||
          value.sessionId === reference)
      ) {
        return value;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function continuationId(session: Session): string {
  return `subagent:${session.id}`;
}

export interface ForkCheckpoint {
  readonly parentId: string;
  readonly sourceSequence: number;
  readonly text: string;
}

function clipForkText(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

export function createForkCheckpoint(
  parentId: string,
  parentContext: readonly Message[],
  task: string,
): ForkCheckpoint {
  const source = parentContext.filter((message) => message.role !== 'system');
  const selected = source.slice(-18);
  const lines = [`Forked from ID-${parentId}`, '', 'Parent checkpoint:'];
  for (const message of selected) {
    const calls = message.toolCalls?.map((call) => call.name).join(', ');
    const label = calls ? `${message.role} tool calls: ${calls}` : message.role;
    const content = clipForkText(message.content, 900);
    if (content) lines.push(`${label}: ${content}`);
  }
  lines.push('', 'Child objective:', clipForkText(task, 2_400));
  lines.push('', 'Use this checkpoint as bounded context. Verify current files and state before acting.');
  return {
    parentId,
    sourceSequence: parentContext.length,
    text: lines.join('\n').slice(0, 14_000),
  };
}

function clipContinuation(text: string): string {
  const limit = 3_000;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[${text.length - limit} characters omitted]`;
}

export function subagentTool(options: SubagentOptions): Tool {
  const tools = subagentTools(options.shellDialect ?? null, options.extraTools ?? []);
  const agents = options.agents ?? {};
  const named = Object.entries(agents);

  /**
   * Turn what the model asked for into a provider, and say whether it bills.
   *
   * Three forms are accepted, in this order: the name of an agent from the
   * config, a provider-qualified ref, or nothing at all. Names first because a
   * config entry is the developer's own choice and should win over a model id
   * that happens to look the same.
   */
  async function resolve(requested: string | undefined): Promise<Resolved | string> {
    if (!requested) {
      const childEffort = subagentEffortFor(options.stored.effort);
      return {
        ref: options.provider.info.id,
        provider: childEffort && options.provider.withEffort
          ? options.provider.withEffort(childEffort)
          : options.provider,
        // The parent is already running, so whatever it costs is being spent
        // either way. Delegating to the same model asks nothing new.
        free: true,
        maxIterations: undefined,
        effort: childEffort,
      };
    }

    const agent = agents[requested];
    // Built-in roles are prompt profiles, not model ids. When no model was
    // configured, keep the parent's provider/model and only add role prompts.
    if (agent && !agent.model) {
      const childEffort = subagentEffortFor(options.stored.effort, agent.effort);
      return {
        ref: options.provider.info.id,
        provider: childEffort && options.provider.withEffort
          ? options.provider.withEffort(childEffort)
          : options.provider,
        free: true,
        maxIterations: agent.maxIterations,
        effort: childEffort,
        agentName: requested,
        ...(agent.instructions ? { instructions: agent.instructions } : {}),
      };
    }
    const ref = agent?.model ?? requested;
    const parsed = parseModelRef(ref, customProvidersOf(options.stored));

    const providerId = parsed.preset ?? providerIdForConfig(options.stored, { model: ref }) ?? '';
    let apiKey: string | undefined;
    try {
      apiKey = providerId
        ? await options.resolveCredential?.(providerId, options.stored)
        : undefined;
    } catch {
      return `Error: could not read the encrypted credential for "${providerId || ref}".`;
    }

    const config = resolveConfig(options.stored, {
      model: parsed.model,
      ...(parsed.preset ? { preset: parsed.preset } : {}),
      ...(apiKey ? { apiKey } : {}),
    });

    const childEffort = subagentEffortFor(options.stored.effort, agent?.effort);
    const childConfig = childEffort === undefined ? config : { ...config, effort: childEffort };
    const check = validate(childConfig);
    if (!check.ok) {
      return (
        `Error: "${ref}" is not usable — ${check.problem}. ` +
        (check.hint ?? '') +
        (named.length ? ` Configured agents: ${named.map(([name]) => name).join(', ')}.` : '')
      );
    }

    return {
      ref: formatModelRef(parsed.preset, parsed.model),
      provider: (options.createProvider ?? createModelProvider)(childConfig),
      free: keyOptional(childConfig.baseURL, childConfig.model, childConfig.providerId),
      maxIterations: agent?.maxIterations,
      effort: childEffort,
      ...(agent ? { agentName: requested, ...(agent.instructions ? { instructions: agent.instructions } : {}) } : {}),
    };
  }

  const autoLaunch = options.agentAutoLaunch !== false;
  const catalogue = named.length
    ? ` Configured agents you can pass as "model": ${named
        .map(([name, entry]) =>
          `${name}${entry.description ? ` (${entry.description})` : ''}${
            entry.model ? ` → ${entry.model}` : ''
          }`,
        )
        .join('; ')}.`
    : '';

  return {
    // Several investigations at once is the point: three subagents reading
    // three parts of a codebase in parallel is the case this exists for.
    parallelSafe: true,
    spec: {
      name: 'subagent',
      // The tool list is generated, not written out. A hardcoded sentence went
      // stale the moment the web tools were passed through, and the parent
      // believed it: it declined to delegate research on the grounds that
      // subagents could not search, which by then they could.
      description:
        'Delegate a self-contained investigation to a fresh agent with its own ' +
        'context, and get back only its conclusion. Use it when answering would mean ' +
        'reading or searching far more than you need in your own context: tracing a ' +
        'call path, finding every caller of something, researching a library. It has ' +
        `these tools: ${tools.map((tool) => tool.spec.name).join(', ')}. It cannot ` +
        'ask the human, or start subagents. It may edit through the coordinated write ' +
        'tool, and conflicts are returned to the principal for arbitration. Give it one clear question ' +
        'and say what a good answer contains. Issue several calls in one message to ' +
        'investigate in parallel. ' +
        (autoLaunch
          ? 'Named agents may be selected automatically when they clearly fit the task.'
          : 'Automatic named-agent launch is disabled. Use a named agent only when the user explicitly asks for it and set "explicit": true.') +
        catalogue,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short label for this investigation, shown to the human',
          },
          task: {
            type: 'string',
            description:
              'The full question, self-contained. The subagent sees none of your ' +
              'conversation, so include the paths, names and context it needs.',
          },
          model: {
            type: 'string',
            description:
              'Which model to run this on: a configured agent name, or a ref like ' +
              '"opencode/longcat-2.0-free". Omit to use your own model. A model that ' +
              'bills needs the developer to approve it; free ones do not.',
          },
          includeAttachments: {
            type: 'boolean',
            description: 'Pass the current pasted attachments to this subagent. Use only when its task requires them.',
          },
          explicit: {
            type: 'boolean',
            description: 'Set true only when the user explicitly requested the named agent or subagent.',
          },
        },
        required: ['title', 'task'],
        additionalProperties: false,
      },
    },

    async run(input, context) {
      const title = typeof input['title'] === 'string' ? input['title'] : 'investigation';
      const task = typeof input['task'] === 'string' ? input['task'] : '';
      if (!task.trim()) {
        return { output: 'Error: subagent needs a "task" describing what to find out.', ok: false };
      }

      const requested = typeof input['model'] === 'string' ? input['model'].trim() : '';
      const namedAgent = requested ? agents[requested] : undefined;
      if (namedAgent && options.agentAutoLaunch === false && input['explicit'] !== true) {
        return {
          output:
            `Automatic launch for named agent "${requested}" is disabled. ` +
            'Ask the user to explicitly request this agent, or delegate without a named agent.',
          ok: false,
        };
      }
      const resolved = await resolve(requested || undefined);
      if (typeof resolved === 'string') return { output: resolved, ok: false };

      // Free is free: no prompt, no ceremony, spawn it. A model that bills is
      // the developer's money, so it goes through the same approval door every
      // other consequential action uses — and auto-approve is what makes that
      // door stand open.
      if (!resolved.free) {
        await context.container.authorizeModel(
          resolved.ref,
          `run a subagent on ${resolved.ref} — "${title}"`,
        );
      }

      const parent = context.bus;
      const callId = context.callId;
      const taskId = `subagent-${callId ?? randomUUID()}`;
      const startedAt = Date.now();
      const childAbort = new AbortController();
      const abortChild = (): void => childAbort.abort();
      context.signal?.addEventListener('abort', abortChild, { once: true });
      const forkedFrom = options.parentSession?.meta.uuid ?? options.parentSessionId ?? 'unknown';
      const parentContext = typeof options.parentContext === 'function'
        ? options.parentContext()
        : options.parentContext ?? [];
      const fork = createForkCheckpoint(forkedFrom, parentContext, task);
      let childMemory = '';
      if (options.memory && context.workspace) {
        try {
          childMemory = summariseMemory(await options.memory.readOnlySnapshot(context.workspace));
        } catch {
          childMemory = '';
        }
      }
      let childSession: Session | null = null;
      const continuable = options.continuable !== false && options.sessions !== undefined && context.workspace !== undefined;
      if (continuable) {
        try {
          childSession = await options.sessions!.create(context.workspace!, {
            container: context.container.name,
            parentId: forkedFrom,
            forkCheckpoint: fork.sourceSequence,
            ...(resolved.provider.info.providerId ? { providerId: resolved.provider.info.providerId } : {}),
            modelId: resolved.provider.info.id,
            lifecycle: 'active',
          });
          await childSession.rename(`sub: ${title}`);
          await childSession.checkpoint(fork.text, fork.sourceSequence);
          const subagentId = continuationId(childSession);
          await saveManifest(options.sessions!, {
            subagentId,
            sessionId: childSession.id,
            workspace: context.workspace!,
            modelRef: resolved.ref,
            title,
            maxIterations: resolved.maxIterations ?? options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
            ...(resolved.effort ? { effort: resolved.effort } : {}),
            compatibilityId: childSession.id,
            forkedFrom,
          });
        } catch {
          // Persistence is an enhancement. An unavailable store keeps the
          // existing one-shot delegation behavior intact.
          childSession = null;
        }
      }
      const subagentId = childSession ? continuationId(childSession) : undefined;
      // The child has its own logical turn. Keep the identity stable across
      // the whole run so a duplicate continuation cannot enter the same
      // child loop through two asynchronous paths.
      const childTurnId = subagentId ?? taskId;
      const record: SubagentRecord | undefined = childSession && context.workspace && subagentId
        ? {
            subagentId,
            sessionId: childSession.id,
            workspace: context.workspace,
            modelRef: resolved.ref,
            title,
            provider: resolved.provider,
            maxIterations: resolved.maxIterations ?? options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
            ...(resolved.effort ? { effort: resolved.effort } : {}),
            compatibilityId: childSession.id,
            forkedFrom,
          }
        : undefined;
      options.coordinator?.register(taskId, childAbort, record);
      parent?.emit('subagent.started', {
        taskId,
        callId,
        title,
        model: resolved.ref,
        contextMax: resolved.provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
        ...(subagentId ? { subagentId } : {}),
        ...(childSession ? { sessionId: childSession.id } : {}),
        forkedFrom,
        at: startedAt,
      });

      // A private bus, and it stays private.
      //
      // The child's steps must not land in the parent's transcript — removing
      // them from it is the entire reason to delegate. What crosses over is a
      // count, onto the parent's own row, and a stream of one-line activity for
      // the panel that shows the child as its own small session. Neither is
      // part of the conversation; both exist so a two-minute investigation
      // looks like work rather than a hang.
      const inner = new EventBus();
      let childPersistence = Promise.resolve();
      const persistChild = (event: PlifEvents['conversation.event']): void => {
        if (!childSession) return;
        childPersistence = childPersistence.then(() => childSession!.append(event));
      };
      if (childSession) {
        persistChild({
          ...eventBase('user.message', 'subagent:' + childSession.id + ':initial'),
          text: task,
        });
        inner.on('conversation.event', persistChild);
      }
      const drainChildInputs = async (): Promise<readonly Message[]> => {
        if (!childSession) return [];
        const queued = await childSession.pendingInputs();
        const messages: Message[] = [];
        for (const item of queued) {
          const turnId = randomUUID();
          const delivered = await childSession.deliverInput(item.id, {
            ...eventBase('user.message', turnId),
            text: item.text,
          });
          if (!delivered) continue;
          messages.push({
            role: 'user',
            content: item.text,
            ...(item.attachments?.length ? { attachments: item.attachments as Message['attachments'] } : {}),
          });
        }
        return messages;
      };
      let calls = 0;
      const relay = (event: PlifEvents['subagent.activity']): void =>
        parent?.emit('subagent.activity', event);

      inner.on('agent.tool', (event) => {
        const described = `${event.name}${
          summarise(event.input) ? `(${summarise(event.input)})` : ''
        }`;
        if (event.phase === 'start') {
          relay({ taskId, kind: 'tool', label: described });
          return;
        }
        calls += 1;
        relay({
          taskId,
          kind: 'tool',
          label: described,
          ok: event.ok ?? true,
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        });
        if (parent && callId) {
          parent.emit('subagent.progress', { callId, toolCalls: calls, lastTool: event.name });
        }
      });

      let reasoning = '';
      const flushReasoning = (): void => {
        const line = reasoning.trim();
        reasoning = '';
        if (line) relay({ taskId, kind: 'reasoning', label: line });
      };
      inner.on('agent.reasoning', (event) => {
        reasoning += event.delta;
        const cut = reasoning.lastIndexOf('\n');
        if (cut < 0 && reasoning.length < 160) return;
        const line = (cut >= 0 ? reasoning.slice(0, cut) : reasoning).trim();
        reasoning = cut >= 0 ? reasoning.slice(cut + 1) : '';
        if (line) relay({ taskId, kind: 'reasoning', label: line });
      });

      inner.on('agent.thinking', (event) => {
        if (event.phase === 'end') flushReasoning();
        relay({
          taskId,
          kind: 'thinking',
          label: event.phase,
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        });
      });

      inner.on('agent.usage', (event) => {
        parent?.emit('subagent.usage', {
          taskId,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          budget: event.budget,
        });
      });

      // Sentences, not deltas. The panel shows a line at a time, and forwarding
      // every token would make the parent's render loop run at the child's
      // streaming rate for no visible gain.
      let sentence = '';
      inner.on('agent.text', (event) => {
        sentence += event.delta;
        const cut = sentence.lastIndexOf('\n');
        if (cut < 0 && sentence.length < 160) return;
        const line = (cut >= 0 ? sentence.slice(0, cut) : sentence).trim();
        sentence = cut >= 0 ? sentence.slice(cut + 1) : '';
        if (line) relay({ taskId, kind: 'text', label: line });
      });

      const messages: Message[] = [
        {
          role: 'system',
          content: buildSystemPrompt({
            workspace: context.workspace ?? context.container.workdir,
            containerName: context.container.name,
            workdir: context.container.workdir,
            tempWorkdir: '/temp',
            capabilities: context.container.capabilities,
            isolation: options.isolation,
            mode: 'subagent',
            // The worker inherits the parent's PLIF operating mode and skill
            // gate, while its provider wire uses the reduced `resolved.effort`.
             effort: options.stored.effort,
             providerId: resolved.provider.info.providerId,
             modelId: resolved.provider.info.id,
             modelDisplayName: resolved.provider.info.id,
             endpointRoute: resolved.provider.info.endpoint,
             contextTokens: resolved.provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
            tools: stableToolSpecs(tools.map((tool) => tool.spec)),
            ...(options.skillCatalogue ? { skills: options.skillCatalogue } : {}),
            ...(options.agentInstructions ? { agentInstructions: options.agentInstructions } : {}),
             ...(resolved.instructions && resolved.agentName
               ? { profile: { name: resolved.agentName, systemPrompt: resolved.instructions } }
               : {}),
             ...(childMemory ? { memory: childMemory } : {}),
          }),
        },
        {
          role: 'user',
           content: fork.text,
          ...(input['includeAttachments'] === true && context.attachments?.length
            ? { attachments: context.attachments }
            : {}),
        },
      ];

      const result = await runLoop(messages, {
        provider: resolved.provider,
        container: context.container,
        questions: context.questions,
        bus: inner,
        turnId: childTurnId,
        tools,
        skillBootstrap: options.skillBootstrap,
        maxIterations:
          resolved.maxIterations ?? options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
        contextTokens: resolved.provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
        enableHarnessCycle: options.stored.effort === 'plif',
        signal: childAbort.signal,
        ...(context.workspace ? { workspace: context.workspace } : {}),
        ...(context.execution ? { execution: context.execution } : {}),
        ...(context.lsp ? { lsp: context.lsp } : {}),
        ...(context.edits ? { edits: context.edits } : {}),
        ...(options.shellDialect ? { shellDialect: options.shellDialect } : {}),
        ...(options.sessions && !childSession ? { sessions: options.sessions } : {}),
        ...(options.memory ? { memory: options.memory } : {}),
        readOnlyMemory: true,
        drainQueue: drainChildInputs,
        agentId: subagentId ? `subagent:${subagentId}` : `subagent:${callId ?? title}:${Date.now()}`,
      }).catch((error: unknown) => {
        parent?.emit('subagent.finished', {
          taskId,
          status: childAbort.signal.aborted ? 'cancelled' : 'failed',
          at: Date.now(),
          durationMs: Date.now() - startedAt,
          summary: error instanceof Error ? error.message : 'subagent failed',
        });
        throw error;
      }).finally(() => {
        context.signal?.removeEventListener('abort', abortChild);
        options.coordinator?.finish(taskId);
      });

      await childPersistence;

      const answer = result.text.trim();
      const ok = result.stop === 'complete' && answer.length > 0;
      parent?.emit('subagent.finished', {
        taskId,
        status: result.stop === 'cancelled' ? 'cancelled' : ok ? 'done' : 'failed',
        at: Date.now(),
        durationMs: Date.now() - startedAt,
        summary: answer.split('\n').find((line) => line.trim())?.trim() ?? `stopped: ${result.stop}`,
      });

      if (!answer) {
        return {
          output:
            `The subagent (${resolved.ref}) stopped (${result.stop}) after ` +
            `${result.toolCalls} tool calls without producing an answer. ` +
            'Ask a narrower question, or do it yourself.',
          ok: false,
        };
      }

      // The stop reason travels with the answer. A subagent that ran out of
      // iterations produces something that reads exactly like a finished
      // answer, and acting on a half-finished investigation as though it were
      // complete is worth two lines to prevent.
      const caveat = ok
        ? ''
        : `\n\n[incomplete: the subagent stopped because of ${result.stop}. Treat this as partial.]`;

      return {
        output: `[${resolved.ref}]${subagentId ? `\n[subagent_id: ${subagentId}]` : ''}\n${answer}${caveat}`,
        ok,
      };
    },
  };
}

/** Continue a persisted child without spawning a second child or a goal round. */
export function sendMessageTool(options: SubagentOptions): Tool {
  const tools = subagentTools(options.shellDialect ?? null, options.extraTools ?? []);

  async function providerFromManifest(manifest: SubagentManifest): Promise<ModelProvider | null> {
    // A same-process restart may still have the exact provider instance that
    // created the child. Reuse it when the persisted model id matches; this
    // also keeps custom/local providers resumable without requiring a second
    // credential/config round-trip. Preserve the child effort when supported.
    if (manifest.modelRef === options.provider.info.id) {
      return manifest.effort && options.provider.withEffort
        ? options.provider.withEffort(manifest.effort)
        : options.provider;
    }
    const parsed = parseModelRef(manifest.modelRef, customProvidersOf(options.stored));
    const providerId = parsed.preset ?? providerIdForConfig(options.stored, { model: parsed.model });
    const apiKey = providerId && options.resolveCredential
      ? await options.resolveCredential(providerId, options.stored)
      : undefined;
    const config = resolveConfig(options.stored, {
      model: parsed.model,
      ...(parsed.preset ? { preset: parsed.preset } : {}),
      ...(apiKey ? { apiKey } : {}),
    });
    if (!validate(config).ok) return null;
    return (options.createProvider ?? createModelProvider)(config);
  }

  return {
    spec: {
      name: 'send_message',
      description:
        'Send a follow-up message to a previous subagent, continuing its persisted conversation. ' +
        'Use this to correct, extend, or ask for details instead of starting a new subagent.',
      parameters: {
        type: 'object',
        properties: {
          subagent_id: { type: 'string', description: 'The subagent_id returned by subagent.' },
          message: { type: 'string', description: 'Follow-up instruction for the same child.' },
        },
        required: ['subagent_id', 'message'],
        additionalProperties: false,
      },
    },
    async run(input, context) {
      if (!options.sessions || !context.workspace) {
        return { output: 'Continuable subagents are not available in this run.', ok: false };
      }
      const subagentId = typeof input['subagent_id'] === 'string' ? input['subagent_id'].trim() : '';
      const message = typeof input['message'] === 'string' ? input['message'].trim() : '';
      if (!subagentId || !message) return { output: 'send_message requires subagent_id and message.', ok: false };

      const live = options.coordinator?.get(subagentId);
      let session: Session | null = null;
      let provider: ModelProvider | null = live?.provider ?? null;
      let maxIterations = live?.maxIterations ?? options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      let workspace = live?.workspace ?? context.workspace;
      let modelRef = live?.modelRef ?? '';
      if (live) {
        session = await options.sessions.resolve(live.workspace, live.sessionId);
        if (session && options.coordinator?.isRunning(subagentId)) {
          await session.enqueueInput(message);
          return {
            output: `Queued follow-up for ${subagentId}. It will be delivered after the child's current tool results.`,
            ok: true,
          };
        }
      } else {
        const reference = subagentId.startsWith('subagent:') ? subagentId.slice('subagent:'.length) : subagentId;
        const manifest = await loadManifestByReference(options.sessions, reference);
        if (manifest) {
          session = await options.sessions.resolve(manifest.workspace, manifest.sessionId);
          provider = await providerFromManifest(manifest);
          maxIterations = manifest.maxIterations;
          workspace = manifest.workspace;
          modelRef = manifest.modelRef;
        }
      }
      if (!session || !provider) {
        return {
          output: `No subagent with id ${subagentId} — its persisted session or model is unavailable; start a new one.`,
          ok: false,
        };
      }

      let childMemory = '';
      try {
        if (options.memory) childMemory = summariseMemory(await options.memory.readOnlySnapshot(workspace));
      } catch {
        childMemory = '';
      }
      const checkpoint = await session.latestCheckpoint();
      const inner = new EventBus();
      let persistence = Promise.resolve();
      inner.on('conversation.event', (event) => {
        persistence = persistence.then(() => session!.append(event));
      });
      const pending = await session.pendingInputs();
      for (const item of pending) {
        await session.deliverInput(item.id, {
          ...eventBase('user.message', randomUUID()),
          text: item.text,
        });
      }
      const turnId = randomUUID();
      await session.append({
        ...eventBase('user.message', turnId),
        text: message,
      });
      const transcript = await session.replay();
      const carried = conversationFromTranscript(transcript);
      const messages: Message[] = [
        {
          role: 'system',
          content: buildSystemPrompt({
            workspace,
            containerName: context.container.name,
            workdir: context.container.workdir,
            tempWorkdir: '/temp',
            capabilities: context.container.capabilities,
            isolation: options.isolation,
            mode: 'subagent',
            effort: options.stored.effort,
            providerId: provider.info.providerId,
            modelId: provider.info.id,
            modelDisplayName: provider.info.id,
            endpointRoute: provider.info.endpoint,
            contextTokens: provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
            tools: stableToolSpecs(tools.map((tool) => tool.spec)),
            ...(options.skillCatalogue ? { skills: options.skillCatalogue } : {}),
            ...(options.agentInstructions ? { agentInstructions: options.agentInstructions } : {}),
            ...(childMemory ? { memory: childMemory } : {}),
          }),
        },
        ...(checkpoint?.snapshot ? [{ role: 'user' as const, content: checkpoint.snapshot }] : []),
        ...carried,
      ];
      const abort = new AbortController();
      const abortChild = (): void => abort.abort();
      context.signal?.addEventListener('abort', abortChild, { once: true });
      try {
        const runTurn = (): Promise<Awaited<ReturnType<typeof runLoop>>> => runLoop(messages, {
          provider,
          container: context.container,
          questions: context.questions,
          bus: inner,
          turnId,
          tools,
          skillBootstrap: options.skillBootstrap,
          maxIterations,
          contextTokens: provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
          signal: abort.signal,
          workspace,
          ...(context.execution ? { execution: context.execution } : {}),
          ...(context.lsp ? { lsp: context.lsp } : {}),
          ...(context.edits ? { edits: context.edits } : {}),
          ...(options.shellDialect ? { shellDialect: options.shellDialect } : {}),
          ...(options.memory ? { memory: options.memory } : {}),
          readOnlyMemory: true,
          agentId: `subagent:${subagentId}`,
        });
        const result = await (options.coordinator
          ? options.coordinator.enqueue(`follow-up:${context.workspace}:${subagentId}`, runTurn)
          : runTurn());
        await persistence;
        const answer = clipContinuation(result.text.trim());
        return { output: `[${modelRef || provider.info.id}]\n${answer || `stopped: ${result.stop}`}`, ok: result.stop === 'complete' && answer.length > 0 };
      } finally {
        context.signal?.removeEventListener('abort', abortChild);
        await persistence;
      }
    },
  };
}
