import type { AgentConfig } from '../config/global.js';
import { EventBus } from '../events/bus.js';
import type { PlifEvents } from '../events/bus.js';
import { formatModelRef, keyOptional, parseModelRef, resolveConfig, validate } from '../model/config.js';
import type { StoredConfig } from '../model/config.js';
import { OpenAIProvider } from '../model/openai.js';
import type { Message, ModelProvider } from '../model/provider.js';
import { runLoop } from './loop.js';
import { buildSystemPrompt } from './prompt.js';
import { editFile, listDir, readFile, runCommand, writeFile } from './tools.js';
import type { EditCoordinator } from './edits.js';
import type { Tool } from './tools.js';

export interface SubagentOptions {
  /** The parent's provider, used when no model is named. */
  readonly provider: ModelProvider;
  readonly isolation: string;
  /** The resolved config file, so a named model resolves the same way the main one does. */
  readonly stored: StoredConfig;
  /** Named agents from `agent: {}` in the config. */
  readonly agents?: Readonly<Record<string, AgentConfig>>;
  readonly maxIterations?: number;
  /** Passed through to the child — the LSP and web tools, in practice. */
  readonly extraTools?: readonly Tool[];
  readonly edits?: EditCoordinator;
}

const DEFAULT_MAX_ITERATIONS = 12;

const BRIEFING = `You are a subagent. Another agent gave you one question and your
entire job is to answer it.

Nobody reads your steps. The only thing that survives is your final message, so it
has to stand alone: say what you found, name the files and line numbers that
support it, and quote the two or three lines that actually matter. "I looked into
it and the handling seems fine" is worthless — the agent that asked cannot see
what you saw.

You cannot ask anyone anything; there is no human attached to this run. When
something is genuinely ambiguous, pick the reading you can defend, answer under
it, and say in one line which reading you picked.

You may edit files when the parent asks for implementation. Every edit is transactional.
If the tool reports EDIT_CONFLICT, stop editing that path and report the conflict clearly;
the principal agent will inspect and arbitrate all competing proposals.

Keep it under a few hundred words. If the honest answer is that you could not find
it, say so and say where you looked — that is a real result, and it stops the next
attempt repeating yours.`;

/**
 * The tools a subagent gets.
 *
 * Read, list, run, plus whatever the parent passes through. Deliberately
 * missing:
 *
 * - `write_file`, because an investigation that edits the tree is a surprise
 *   nobody asked for. `run_command` can still write — that is the same
 *   `filesystemWriteBlock: false` gap the sandbox report has always declared,
 *   not a new hole opened here.
 * - `ask_user`, because there is nothing to ask. The broker would hang or the
 *   non-interactive responder would deny, and either wastes the whole run.
 * - `subagent`, because recursion is unbounded fan-out with no human in the
 *   loop and no budget that composes.
 * - the task tools, because a background job outliving the subagent that
 *   started it has no owner.
 */
export function subagentTools(extra: readonly Tool[] = []): Tool[] {
  return [readFile, writeFile, editFile, listDir, runCommand, ...extra];
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
  for (const key of ['path', 'query', 'url', 'pattern', 'name', 'title']) {
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
}

export function subagentTool(options: SubagentOptions): Tool {
  const tools = subagentTools(options.extraTools ?? []);
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
  function resolve(requested: string | undefined): Resolved | string {
    if (!requested) {
      return {
        ref: options.provider.info.id,
        provider: options.provider,
        // The parent is already running, so whatever it costs is being spent
        // either way. Delegating to the same model asks nothing new.
        free: true,
        maxIterations: undefined,
      };
    }

    const agent = agents[requested];
    const ref = agent?.model ?? requested;
    const parsed = parseModelRef(ref);

    const config = resolveConfig(options.stored, {
      model: parsed.model,
      ...(parsed.preset ? { preset: parsed.preset } : {}),
    });

    const check = validate(config);
    if (!check.ok) {
      return (
        `Error: "${ref}" is not usable — ${check.problem}. ` +
        (check.hint ?? '') +
        (named.length ? ` Configured agents: ${named.map(([name]) => name).join(', ')}.` : '')
      );
    }

    return {
      ref: formatModelRef(parsed.preset, parsed.model),
      provider: new OpenAIProvider(config),
      free: keyOptional(config.baseURL, config.model),
      maxIterations: agent?.maxIterations,
    };
  }

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
        'investigate in parallel.' +
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
      const resolved = resolve(requested || undefined);
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
      const taskId = `subagent-${callId ?? Date.now()}`;
      const startedAt = Date.now();
      parent?.emit('subagent.started', {
        taskId,
        callId,
        title,
        model: resolved.ref,
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

      inner.on('agent.thinking', (event) => {
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
          content: [
            BRIEFING,
            '',
            buildSystemPrompt({
              workspace: context.workspace ?? context.container.workdir,
              containerName: context.container.name,
              workdir: context.container.workdir,
              capabilities: context.container.capabilities,
              isolation: options.isolation,
              tools: tools.map((tool) => tool.spec),
            }),
          ].join('\n'),
        },
        { role: 'user', content: task },
      ];

      const result = await runLoop(messages, {
        provider: resolved.provider,
        container: context.container,
        questions: context.questions,
        bus: inner,
        tools,
        maxIterations:
          resolved.maxIterations ?? options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
        ...(context.signal ? { signal: context.signal } : {}),
        ...(context.workspace ? { workspace: context.workspace } : {}),
        ...(context.lsp ? { lsp: context.lsp } : {}),
        ...(context.edits ? { edits: context.edits } : {}),
        agentId: `subagent:${callId ?? title}:${Date.now()}`,
      });

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

      return { output: `[${resolved.ref}]\n${answer}${caveat}`, ok };
    },
  };
}
