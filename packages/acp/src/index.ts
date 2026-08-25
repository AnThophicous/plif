#!/usr/bin/env node
/**
 * plif-acp — ACP (Agent Client Protocol) adapter for plif.
 *
 * Lets AionUi (or any ACP client) drive plif as a custom agent.
 * Bridges @plif/core's runLoop + EventBus to the Agent Client Protocol.
 *
 * v2 adds session features:
 *  - permission modes (default / acceptEdits / bypassPermissions)
 *  - model picker via session config options (persists like `plif model set`)
 *  - skills exposed as slash commands via available_commands_update
 */

import { Readable, Writable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  agent,
  ndJsonStream,
  methods,
  PROTOCOL_VERSION,
  type SessionConfigOption,
  type SessionModeState,
} from '@agentclientprotocol/sdk';
import {
  Engine,
  runLoop,
  buildSystemPrompt,
  DEFAULT_TOOLS,
  DEFAULT_CONTEXT_TOKENS,
  DEVELOPER_POLICY,
  SkillRegistry,
  skillTool,
  createSkillTool,
  loadStoredConfig,
  McpRegistry,
  type McpServerConfig,
  type Message,
  type LoopStop,
} from '@plif/core';
import { buildProviderFromStoredConfig } from './provider.js';
import {
  MODES,
  isKnownMode,
  buildModelPicker,
  applyModelChoice,
  type PlifMode,
  type ModelPickerState,
} from './options.js';

// ── Container path helpers (reimplemented from @plif/cli) ──────────────
const CONTAINER_WORKDIR = '/project';
const TEMP_WORKDIR = '/temp';

function containerMount(hostCwd: string) {
  return {
    source: hostCwd,
    target: CONTAINER_WORKDIR,
    mode: 'rw' as const,
    mask: ['/.git/config', '/.env', '/.env.local'],
  };
}

function containerTempMount(tempDir: string) {
  return { source: tempDir, target: TEMP_WORKDIR, mode: 'rw' as const, mask: [] as string[] };
}

/**
 * Mirror user-installed skills (~/.plif/skills) into <workspace>/.plif/skills,
 * the same way AionUi materializes the skills attached to a conversation into
 * .aionrs/skills (only attached skills — never the agent's builtin ones).
 *
 * Builtin skills ship inside @plif/core and are already loaded by the
 * registry, so they are NOT copied. Project-scoped skills already live in the
 * workspace, so they are skipped too. If no user skills exist, no .plif
 * folder is created. Never overwrites: an existing directory wins.
 */
async function materializeUserSkills(skills: SkillRegistry, workspace: string): Promise<void> {
  const targetRoot = path.join(workspace, '.plif', 'skills');
  for (const skill of skills.list()) {
    if (skill.scope !== 'user') continue;
    const targetDir = path.join(targetRoot, skill.name);
    if (fs.existsSync(targetDir)) continue;
    try {
      await fs.promises.cp(path.dirname(skill.file), targetDir, { recursive: true });
    } catch (err) {
      process.stderr.write(
        `plif-acp: could not materialize skill "${skill.name}": ${
          err instanceof Error ? err.message : String(err)
        }\n`
      );
    }
  }
}

// ── ACP mcpServers → plif McpServerConfig ─────────────────────────────
interface AcpMcpServer {
  name?: string;
  type?: string;
  command?: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  url?: string;
  headers?: Array<{ name: string; value: string }>;
  serverId?: string;
}

function toPlifMcpConfigs(
  servers: AcpMcpServer[] | undefined
): Record<string, McpServerConfig> {
  const configs: Record<string, McpServerConfig> = {};
  for (const s of servers ?? []) {
    if (!s || !s.name) continue;
    if (s.type === 'acp') {
      process.stderr.write(
        `plif-acp: MCP server "${s.name}" uses the ACP transport, which plif does not support — skipping.\n`
      );
      continue;
    }
    if (s.type === 'http' || s.type === 'sse') {
      if (!s.url) continue;
      configs[s.name] = {
        url: s.url,
        ...(s.headers?.length
          ? { headers: Object.fromEntries(s.headers.map((h) => [h.name, h.value])) }
          : {}),
      };
      continue;
    }
    // Stdio (explicit type or no type field at all)
    if (s.command) {
      configs[s.name] = {
        command: s.command,
        ...(s.args?.length ? { args: [...s.args] } : {}),
        ...(s.env?.length
          ? { env: Object.fromEntries(s.env.map((e) => [e.name, e.value])) }
          : {}),
      };
    }
  }
  return configs;
}

// ── Session state ──────────────────────────────────────────────────────
interface PlifSession {
  sessionId: string;
  workspace: string;
  history: Message[];
  abortController: AbortController;
  container?: Awaited<ReturnType<Engine['run']>>;
  tempWorkspace?: string;
  mode: PlifMode;
  skills: SkillRegistry | null;
  mcp: McpRegistry | null;
  modelPicker: ModelPickerState;
  configOptions: SessionConfigOption[];
}

const sessions = new Map<string, PlifSession>();
let engine: Engine | null = null;
let engineStarted = false;

async function getEngine(): Promise<Engine> {
  if (!engine) {
    engine = new Engine({ policy: DEVELOPER_POLICY });
  }
  if (!engineStarted) {
    await engine.start();
    engineStarted = true;
  }
  return engine;
}

// ── Config options / modes builders ────────────────────────────────────
function buildSessionConfigOptions(session: PlifSession): SessionConfigOption[] {
  return [
    {
      id: 'mode',
      name: 'Mode',
      description: 'Session permission mode',
      category: 'mode',
      type: 'select',
      currentValue: session.mode,
      options: MODES.map((m) => ({ value: m.id, name: m.name, description: m.description })),
    },
    {
      id: 'model',
      name: 'Model',
      description: 'AI model plif uses (persisted to plif config)',
      category: 'model',
      type: 'select',
      currentValue: session.modelPicker.currentValue,
      options: session.modelPicker.options,
    },
  ];
}

function buildModeState(session: PlifSession): SessionModeState {
  return {
    currentModeId: session.mode,
    availableModes: MODES.map((m) => ({ id: m.id, name: m.name, description: m.description })),
  };
}

// ── Stop reason mapping ────────────────────────────────────────────────
function mapStopReason(stop: LoopStop): 'end_turn' | 'cancelled' | 'max_tokens' {
  switch (stop) {
    case 'complete':
      return 'end_turn';
    case 'cancelled':
      return 'cancelled';
    case 'max_iterations':
      return 'max_tokens';
    case 'too_many_failures':
    case 'error':
    default:
      return 'end_turn';
  }
}

// ── Tool kind inference ────────────────────────────────────────────────
function inferToolKind(name: string): 'read' | 'edit' | 'execute' | 'search' | 'other' {
  const n = name.toLowerCase();
  if (/read|cat|view|open/.test(n)) return 'read';
  if (/write|edit|patch|replace|create|delete|move/.test(n)) return 'edit';
  if (/exec|run|shell|bash|command|terminal/.test(n)) return 'execute';
  if (/search|grep|find|glob|lookup/.test(n)) return 'search';
  return 'other';
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const input = Writable.toWeb(process.stdout) as WritableStream;
  const output = Readable.toWeb(process.stdin) as ReadableStream;
  const stream = ndJsonStream(input, output);

  const app = agent({ name: 'plif' });

  // ── initialize ─────────────────────────────────────────────────────
  app.onRequest(methods.agent.initialize, async () => {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        // stdio is baseline for every agent; http/sse are handled by plif's
        // McpRegistry too. Only the ACP-transport variant is unsupported.
        mcpCapabilities: { http: true, sse: true, acp: false },
      },
    };
  });

  // ── session/new ────────────────────────────────────────────────────
  app.onRequest(methods.agent.session.new, async (ctx) => {
    const params = ctx.params as {
      cwd?: string;
      mcpServers?: AcpMcpServer[];
      _meta?: Record<string, unknown>;
    };
    const workspace = params.cwd || process.cwd();
    const sessionId = randomUUID();
    process.stderr.write(
      `plif-acp: session/new cwd=${workspace} mcpServers=${params.mcpServers?.length ?? 0}\n`
    );

    const eng = await getEngine();

    // Build provider early to catch config issues, and enumerate models
    const bundle = await buildProviderFromStoredConfig(eng);
    const stored = await loadStoredConfig(eng.paths);
    const modelPicker = await buildModelPicker(stored, bundle.credentials).catch(() => ({
      options: [],
      currentValue: '',
    }));

    // Skills (workspace + user/global dirs) become slash commands + tools
    const skills = await SkillRegistry.load({ workspace, root: eng.paths.root }).catch(
      () => null
    );

    // Mirror user skills into <workspace>/.plif/skills so the loaded skills
    // are visible in the conversation folder (like .aionrs/skills for the
    // built-in agent).
    if (skills) {
      await materializeUserSkills(skills, workspace).catch(() => undefined);
    }

    // MCP servers handed over by the client (AionUi) — connect and expose
    // their tools to the session. A failed server never blocks the session;
    // its reason goes to stderr for diagnosis.
    let mcp: McpRegistry | null = null;
    const mcpConfigs = toPlifMcpConfigs(params.mcpServers);
    if (Object.keys(mcpConfigs).length > 0) {
      try {
        mcp = await McpRegistry.connect(mcpConfigs, eng.bus);
        for (const status of mcp.statuses()) {
          process.stderr.write(
            `plif-acp: MCP "${status.name}" ${status.connected ? 'connected' : 'FAILED'} ` +
              `(${status.toolCount} tools)${status.detail ? ` — ${status.detail}` : ''}\n`
          );
        }
      } catch (err) {
        mcp = null;
        process.stderr.write(
          `plif-acp: MCP registry failed: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }

    // Ensure base image is available, then create the session's container
    const image = await eng.ensureBaseImage();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plif-acp-'));
    const container = await eng.run({
      image: image.reference,
      mounts: [
        { ...containerMount(workspace), mode: 'rw' as const },
        containerTempMount(tempDir),
      ],
      workdir: CONTAINER_WORKDIR,
      // Network is a ceiling, not a licence: policy still asks per host.
      // hostWrite lets edits through the rw mount, gated by approvals.
      capabilities: { network: true, hostWrite: true },
    });

    // Create plif session (transcript persistence)
    await eng.sessions.create(workspace);

    const session: PlifSession = {
      sessionId,
      workspace,
      history: [],
      abortController: new AbortController(),
      container,
      tempWorkspace: tempDir,
      mode: 'default',
      skills,
      mcp,
      modelPicker,
      configOptions: [],
    };
    session.configOptions = buildSessionConfigOptions(session);
    sessions.set(sessionId, session);

    // Advertise slash commands shortly after the response lands, so the
    // client has registered the session first.
    if (skills && skills.size > 0) {
      const commands = skills.list().map((s) => ({
        name: s.name,
        description: s.description,
        input: { hint: '[instruction]' },
      }));
      setTimeout(() => {
        void ctx.client
          .notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'available_commands_update', availableCommands: commands },
          })
          .catch(() => undefined);
      }, 150);
    }

    return {
      sessionId,
      modes: buildModeState(session),
      configOptions: session.configOptions,
    };
  });

  // ── session/set_mode ───────────────────────────────────────────────
  app.onRequest(methods.agent.session.setMode, async (ctx) => {
    const params = ctx.params as { sessionId: string; modeId: string };
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Session ${params.sessionId} not found`);
    if (!isKnownMode(params.modeId)) throw new Error(`Unknown mode: ${params.modeId}`);

    session.mode = params.modeId;
    session.configOptions = buildSessionConfigOptions(session);
    void ctx.client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'current_mode_update', currentModeId: session.mode },
    });
    void ctx.client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'config_option_update', configOptions: session.configOptions },
    });
    return {};
  });

  // ── session/set_config_option ──────────────────────────────────────
  app.onRequest(methods.agent.session.setConfigOption, async (ctx) => {
    const params = ctx.params as { sessionId: string; configId: string; value: unknown };
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Session ${params.sessionId} not found`);
    if (typeof params.value !== 'string') {
      throw new Error(`Invalid value for config option ${params.configId}`);
    }

    if (params.configId === 'mode') {
      if (!isKnownMode(params.value)) throw new Error(`Unknown mode: ${params.value}`);
      session.mode = params.value;
    } else if (params.configId === 'model') {
      const eng = await getEngine();
      const bundle = await buildProviderFromStoredConfig(eng);
      const stored = await loadStoredConfig(eng.paths);
      const next = await applyModelChoice(eng, stored, bundle.credentials, params.value);
      session.modelPicker = await buildModelPicker(next, bundle.credentials).catch(() => ({
        options: [],
        currentValue: params.value as string,
      }));
      // Make sure the picker reflects the chosen value even if unlisted.
      if (
        typeof params.value === 'string' &&
        session.modelPicker.currentValue !== params.value &&
        !session.modelPicker.options.some((g) =>
          g.options.some((o) => o.value === params.value)
        )
      ) {
        session.modelPicker = {
          options: [
            {
              group: '_current',
              name: 'Current',
              options: [{ value: params.value, name: params.value }],
            },
            ...session.modelPicker.options,
          ],
          currentValue: params.value,
        };
      }
    } else {
      throw new Error(`Unknown config option: ${params.configId}`);
    }

    session.configOptions = buildSessionConfigOptions(session);
    void ctx.client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'config_option_update', configOptions: session.configOptions },
    });
    if (params.configId === 'mode') {
      void ctx.client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'current_mode_update', currentModeId: session.mode },
      });
    }
    return { configOptions: session.configOptions };
  });

  // ── session/prompt ─────────────────────────────────────────────────
  app.onRequest(methods.agent.session.prompt, async (ctx) => {
    const params = ctx.params as {
      sessionId: string;
      prompt: Array<{ type: string; text?: string; [k: string]: unknown }>;
    };
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Session ${params.sessionId} not found`);
    if (!session.container) throw new Error(`Session ${params.sessionId} has no container`);

    const eng = await getEngine();
    const bundle = await buildProviderFromStoredConfig(eng);
    const { provider } = bundle;

    // Extract user text
    const rawText = params.prompt
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');

    // Slash command: /<skill-name> [instruction] → load that skill
    let userText = rawText;
    const slash = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(rawText.trim());
    const skillName = slash?.[1];
    if (slash && skillName && session.skills) {
      const skill = session.skills.get(skillName);
      if (skill) {
        userText = `Load and follow the skill "${skill.name}"${
          slash[2]?.trim() ? ` for this request: ${slash[2].trim()}` : '.'
        }`;
      }
    }

    // Fresh abort controller for this turn
    session.abortController = new AbortController();
    const turnId = `turn-${Date.now()}-${randomUUID().slice(0, 8)}`;

    // Tools: defaults + skill loaders + connected MCP tools
    const tools = [
      ...DEFAULT_TOOLS,
      ...(session.skills ? [skillTool(session.skills), createSkillTool(session.skills)] : []),
      ...(session.mcp ? session.mcp.tools() : []),
    ];

    // System prompt built once per turn (cheap) with live container facts
    const systemPrompt = buildSystemPrompt({
      workspace: session.workspace,
      containerName: session.container.name,
      workdir: session.container.workdir,
      tempWorkdir: TEMP_WORKDIR,
      capabilities: session.container.capabilities,
      isolation: eng.sandboxReport.isolation,
      contextTokens: provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
      tools: tools.map((t) => t.spec),
      ...(session.skills ? { skills: session.skills.catalogue() } : {}),
      ...(session.mcp && session.mcp.connectedCount > 0
        ? { mcpServers: session.mcp.catalogue() }
        : {}),
    });

    // History: system + accumulated + new user message
    const history: Message[] = [
      { role: 'system', content: systemPrompt },
      ...session.history,
      { role: 'user', content: userText },
    ];

    // Subscribe to bus events and forward as ACP session/update notifications.
    // Events carry turnId, so filtering keeps concurrent turns apart.
    const unsubscribes: Array<() => void> = [];

    unsubscribes.push(
      eng.bus.on('agent.text', (e) => {
        if (e.turnId !== turnId) return;
        void ctx.client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: e.delta },
          },
        });
      })
    );

    unsubscribes.push(
      eng.bus.on('agent.reasoning', (e) => {
        if (e.turnId !== turnId) return;
        void ctx.client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: e.delta },
          },
        });
      })
    );

    unsubscribes.push(
      eng.bus.on('agent.tool', (e) => {
        if (e.turnId !== turnId) return;
        if (e.phase === 'start') {
          void ctx.client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: e.id,
              title: e.name,
              kind: inferToolKind(e.name),
              status: 'in_progress',
              rawInput: e.input as Record<string, unknown> | undefined,
            },
          });
        } else {
          void ctx.client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: e.id,
              status: e.ok ? 'completed' : 'failed',
              rawOutput:
                typeof e.output === 'object' && e.output !== null
                  ? (e.output as Record<string, unknown>)
                  : { output: String(e.output ?? '') },
            },
          });
        }
      })
    );

    // Approvals → mode-dependent: bypass/acceptEdits auto-allow, otherwise
    // forward to the ACP client and answer back into the broker.
    unsubscribes.push(
      eng.bus.on('approval.request', async (e) => {
        const targetSession =
          [...sessions.values()].find((s) => s.container?.id === e.containerId) ?? session;

        if (targetSession.mode === 'bypassPermissions') {
          eng.approvals.respond(e.id, { decision: 'allow', remember: false });
          return;
        }
        if (
          targetSession.mode === 'acceptEdits' &&
          (e.action === 'fs.write' || e.action === 'fs.delete')
        ) {
          eng.approvals.respond(e.id, { decision: 'allow', remember: false });
          return;
        }

        try {
          const response = await ctx.client.request(methods.client.session.requestPermission, {
            sessionId: targetSession.sessionId,
            toolCall: {
              toolCallId: `approval-${e.id}`,
              title: `${e.action}: ${e.target}`,
              kind: 'execute',
              status: 'pending',
              rawInput: {
                action: e.action,
                target: e.target,
                ...(e.argv ? { argv: [...e.argv] } : {}),
                ...(e.reason ? { reason: e.reason } : {}),
              },
            },
            options: [
              { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
              { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' },
              { optionId: 'reject_always', name: 'Always deny', kind: 'reject_always' },
            ],
          });

          const outcome = response.outcome;
          if (outcome.outcome === 'cancelled') {
            eng.approvals.respond(e.id, { decision: 'deny', remember: false });
            return;
          }
          switch (outcome.optionId) {
            case 'allow_once':
              eng.approvals.respond(e.id, { decision: 'allow', remember: false });
              break;
            case 'allow_always':
              eng.approvals.respond(e.id, { decision: 'allow', remember: true });
              break;
            case 'reject_always':
              eng.approvals.respond(e.id, { decision: 'deny', remember: true });
              break;
            default:
              eng.approvals.respond(e.id, { decision: 'deny', remember: false });
          }
        } catch {
          eng.approvals.respond(e.id, { decision: 'deny', remember: false });
        }
      })
    );

    // Questions → answer with the first suggested option (headless behaviour,
    // same policy as the one-shot CLI).
    unsubscribes.push(
      eng.bus.on('question.asked', (e) => {
        const first = e.options?.[0];
        const answer =
          typeof first === 'string'
            ? first
            : (first && typeof first === 'object' && 'value' in first
                ? String((first as { value?: unknown }).value ?? '')
                : '');
        eng.questions.answer(e.id, answer);
      })
    );

    // Run the loop
    try {
      const result = await runLoop(history, {
        provider,
        container: session.container,
        questions: eng.questions,
        bus: eng.bus,
        turnId,
        signal: session.abortController.signal,
        memory: eng.memory,
        workspace: session.workspace,
        sessionId: params.sessionId,
        contextTokens: provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
        tools,
      });

      // Keep the updated history (minus the system prompt, rebuilt each turn)
      session.history = result.messages.filter((m) => m.role !== 'system');

      return { stopReason: mapStopReason(result.stop) };
    } finally {
      for (const unsub of unsubscribes) unsub();
    }
  });

  // ── session/cancel ─────────────────────────────────────────────────
  app.onNotification(methods.agent.session.cancel, (ctx) => {
    const params = ctx.params as { sessionId: string };
    const session = sessions.get(params.sessionId);
    if (session) {
      session.abortController.abort();
      getEngine()
        .then((eng) => eng.questions.abandonAll())
        .catch(() => undefined);
    }
  });

  // ── Connect ────────────────────────────────────────────────────────
  await app.connect(stream);
}

main().catch((err) => {
  process.stderr.write(`plif-acp fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
