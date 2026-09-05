#!/usr/bin/env node
/**
 * plif-acp — ACP (Agent Client Protocol) adapter for plif. SECURE EDITION.
 *
 * Same features as the original PR (sessions, permission modes, model picker,
 * skills as slash commands, MCP stdio/http/sse) with a hardened trust model:
 *
 * - The ACP host is treated as UNTRUSTED by default. Everything it could
 *   previously grant itself now requires a local opt-in file
 *   (~/.plif/acp-security.json). The only ACP environment override is the
 *   session-count ceiling, which can reduce or cap concurrency.
 * - No user skill is ever copied into the host's workspace. Skills stay in
 *   ~/.plif/skills and are loaded through the in-loop `skill` tool.
 * - MCP servers proposed by the host are rejected unless allowHostMcpServers
 *   is set, and their `command` must start with an allowed prefix.
 * - The host can never switch the persisted model without local consent;
 *   model switches are session-local by default.
 * - Container mounts mask secrets beyond the original .git/config/.env pair.
 * - Session count is capped; teardown shuts the engine down cleanly.
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
  SkillRegistry,
  skillTool,
  createSkillTool,
  loadStoredConfig,
  loadTokenSplitConfig,
  McpRegistry,
  QuestionBroker,
  type McpServerConfig,
  type Message,
  type Attachment,
  type LoopStop,
  type StoredConfig,
  type Session,
  eventBase,
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
import {
  loadSecurityPolicy,
  ACP_POLICY,
  isWorkspaceAllowed,
  securityPolicyPath,
  type AcpSecurityPolicy,
  type SecurityDecision,
} from './security.js';

// ── Container path helpers (mirror @plif/cli) ──────────────────────────
const CONTAINER_WORKDIR = '/project';
const TEMP_WORKDIR = '/temp';

/** Paths and name patterns the model must never see inside the mount. */
const MOUNT_MASKS: readonly string[] = [
  '/.git',
  '/.env',
  '/.env.*',
  '/.env.local',
  '/.env.production',
  '/.env.development',
  '/.npmrc',
  '/.pypirc',
  '/.netrc',
  '/.plif',
  '/*.pem',
  '/*.key',
  '/**/*.pem',
  '/**/*.key',
  '/secrets*',
  '/credentials*',
  '/**/secrets*',
  '/**/credentials*',
];

function containerMount(hostCwd: string) {
  return {
    source: hostCwd,
    target: CONTAINER_WORKDIR,
    mode: 'rw' as const,
    mask: MOUNT_MASKS,
  };
}

function containerTempMount(tempDir: string) {
  return { source: tempDir, target: TEMP_WORKDIR, mode: 'rw' as const, mask: [] as string[] };
}

// ── Logging (never echoes secrets, env maps or headers) ────────────────
function log(message: string): void {
  process.stderr.write(`plif-acp: ${message}\n`);
}

// ── MCP servers from the host ──────────────────────────────────────────
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

/** env entries whose names smell like credentials are dropped before spawn. */
const SENSITIVE_ENV = /(^|_)(KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?|API_KEY)(_|$)/i;

function sanitizeMcpEnv(
  env: Array<{ name: string; value: string }> | undefined,
): Array<{ name: string; value: string }> | undefined {
  if (!env?.length) return env;
  const kept = env.filter((entry) => !SENSITIVE_ENV.test(entry.name));
  if (kept.length !== env.length) {
    log(`dropped ${env.length - kept.length} sensitive env variable(s) from host MCP server`);
  }
  return kept;
}

function isAllowedMcpCommand(command: string, policy: AcpSecurityPolicy): boolean {
  const first = command.trim().split(/\s+/)[0] ?? '';
  return policy.hostMcpCommandPrefixes.some((prefix) => first === prefix);
}

function toPlifMcpConfigs(
  servers: AcpMcpServer[] | undefined,
  policy: AcpSecurityPolicy,
): Record<string, McpServerConfig> {
  const configs: Record<string, McpServerConfig> = {};
  for (const s of servers ?? []) {
    if (!s || !s.name) continue;
    if (s.type === 'acp') {
      log(`MCP server "${s.name}" uses the ACP transport, which plif does not support — skipping.`);
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
      if (!isAllowedMcpCommand(s.command, policy)) {
        log(
          `MCP server "${s.name}" command "${s.command}" is not in the allowed prefix ` +
            `list — skipping. Allow it in ~/.plif/acp-security.json (hostMcpCommandPrefixes).`,
        );
        continue;
      }
      configs[s.name] = {
        command: s.command,
        ...(s.args?.length ? { args: [...s.args] } : {}),
        ...(s.env?.length
          ? { env: Object.fromEntries(sanitizeMcpEnv(s.env)!.map((e) => [e.name, e.value])) }
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
  storedConfig: StoredConfig;
  busy: boolean;
  questions: QuestionBroker;
  durableSession: Session;
}

const sessions = new Map<string, PlifSession>();
/** Session/new can run concurrently; reserve slots before expensive setup. */
const creatingSessions = new Set<string>();
let engine: Engine | null = null;
let engineStarted = false;
let engineStart: Promise<Engine> | null = null;

async function getEngine(): Promise<Engine> {
  if (engine && engineStarted) return engine;
  if (!engineStart) {
    engineStart = (async () => {
      const active = engine ?? new Engine({ policy: ACP_POLICY });
      engine = active;
      await active.start();
      engineStarted = true;
      return active;
    })().finally(() => {
      engineStart = null;
    });
  }
  return await engineStart;
}

// ── Config options / modes builders ────────────────────────────────────
function permittedModes(policy: AcpSecurityPolicy): typeof MODES[number][] {
  return MODES.filter((mode) =>
    (mode.id !== 'acceptEdits' || policy.allowAcceptEdits) &&
    (mode.id !== 'bypassPermissions' || policy.allowBypassPermissions),
  );
}

function buildSessionConfigOptions(
  session: PlifSession,
  policy: AcpSecurityPolicy,
): SessionConfigOption[] {
  return [
    {
      id: 'mode',
      name: 'Mode',
      description: 'Session permission mode',
      category: 'mode',
      type: 'select',
      currentValue: session.mode,
      options: permittedModes(policy).map((m) => ({ value: m.id, name: m.name, description: m.description })),
    },
    {
      id: 'model',
      name: 'Model',
      description: 'AI model plif uses (session-local unless local opt-in allows persisting)',
      category: 'model',
      type: 'select',
      currentValue: session.modelPicker.currentValue,
      options: session.modelPicker.options,
    },
  ];
}

function buildModeState(session: PlifSession, policy: AcpSecurityPolicy): SessionModeState {
  return {
    currentModeId: session.mode,
    availableModes: permittedModes(policy).map((m) => ({ id: m.id, name: m.name, description: m.description })),
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
  const policy = await loadSecurityPolicy();
  log(`security policy: acceptEdits=${policy.allowAcceptEdits ? 'allowed' : 'DENIED'} ` +
    `bypass=${policy.allowBypassPermissions ? 'allowed' : 'DENIED'} ` +
    `hostMcp=${policy.allowHostMcpServers ? 'allowed' : 'DENIED'} ` +
    `modelSwitch=${policy.allowModelSwitch ? 'allowed' : 'DENIED'} ` +
    `maxSessions=${policy.maxSessions}`);

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
    const requestedWorkspace = path.resolve(params.cwd || process.cwd());
    const workspaceRoots = [process.cwd(), ...policy.workspaceRoots];
    let workspace = requestedWorkspace;
    try {
      workspace = fs.realpathSync.native(requestedWorkspace);
    } catch {
      throw new Error(`Workspace does not exist: ${requestedWorkspace}`);
    }
    if (!isWorkspaceAllowed(workspace, workspaceRoots)) {
      throw new Error(
        `ACP workspace is outside the permitted roots. Add an absolute path to workspaceRoots in ${securityPolicyPath()}.`,
      );
    }
    const sessionId = randomUUID();

    if (sessions.size + creatingSessions.size >= policy.maxSessions) {
      throw new Error(
        `Session limit reached (${policy.maxSessions}). Close a session before opening another.`,
      );
    }
    creatingSessions.add(sessionId);

    let mcp: McpRegistry | null = null;
    let tempDir: string | undefined;
    let container: Awaited<ReturnType<Engine['run']>> | undefined;
    let durableSession: Session | undefined;
    try {
      const eng = await getEngine();
      const bundle = await buildProviderFromStoredConfig(eng);
      const stored = bundle.stored;
      const modelPicker = await buildModelPicker(stored, bundle.credentials).catch(() => ({
        options: [],
        currentValue: '',
      }));

      const skills = await SkillRegistry.load({ workspace, root: eng.paths.root }).catch(
        () => null,
      );

      // MCP servers handed over by the host — gated by the local policy.
      const mcpConfigs = policy.allowHostMcpServers
        ? toPlifMcpConfigs(params.mcpServers, policy)
        : {};
      if (params.mcpServers?.length && !policy.allowHostMcpServers) {
        log(
          `host proposed ${params.mcpServers.length} MCP server(s); rejected — ` +
            `set allowHostMcpServers in ~/.plif/acp-security.json to accept them.`,
        );
      }
      if (Object.keys(mcpConfigs).length > 0) {
        try {
          mcp = await McpRegistry.connect(mcpConfigs, eng.bus, {
            authorizeNetwork: async (host, reason) => {
              if (!eng.policy.allowsHost(host)) {
                throw new Error(`MCP network target ${host} is not in the local policy allowlist (${reason})`);
              }
            },
          });
          for (const status of mcp.statuses()) {
            log(
              `MCP "${status.name}" ${status.connected ? 'connected' : 'FAILED'} ` +
                `(${status.toolCount} tools)${status.detail ? ` — ${status.detail}` : ''}`,
            );
          }
        } catch (err) {
          mcp = null;
          log(`MCP registry failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const image = await eng.ensureBaseImage();
      const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plif-acp-'));
      tempDir = tempWorkspace;
      container = await eng.run({
        image: image.reference,
        mounts: [
          { ...containerMount(workspace), mode: 'rw' as const },
          containerTempMount(tempWorkspace),
        ],
        workdir: CONTAINER_WORKDIR,
        capabilities: { network: true, hostWrite: true },
      });

      durableSession = await eng.sessions.create(workspace, {
        container: container.name,
        ...(bundle.provider.info.providerId ? { providerId: bundle.provider.info.providerId } : {}),
        modelId: bundle.provider.info.id,
        lifecycle: 'acp',
      });

      const session: PlifSession = {
        sessionId,
        workspace,
        history: [],
        abortController: new AbortController(),
        container,
        tempWorkspace,
        mode: 'default',
        skills,
        mcp,
        modelPicker,
        configOptions: [],
        storedConfig: stored,
        busy: false,
        questions: new QuestionBroker(eng.bus, 600_000, sessionId),
        durableSession,
      };
      session.configOptions = buildSessionConfigOptions(session, policy);
      sessions.set(sessionId, session);

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
        modes: buildModeState(session, policy),
        configOptions: session.configOptions,
      };
    } catch (error) {
      await durableSession?.close().catch(() => undefined);
      await container?.remove().catch(() => undefined);
      await mcp?.close().catch(() => undefined);
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    } finally {
      creatingSessions.delete(sessionId);
    }
  });

  // ── session/set_mode ───────────────────────────────────────────────
  app.onRequest(methods.agent.session.setMode, async (ctx) => {
    const params = ctx.params as { sessionId: string; modeId: string };
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Session ${params.sessionId} not found`);
    if (!isKnownMode(params.modeId)) throw new Error(`Unknown mode: ${params.modeId}`);
    if (params.modeId === 'acceptEdits' && !policy.allowAcceptEdits) {
      throw new Error(
        'acceptEdits is disabled. To enable it, set allowAcceptEdits: true in ' +
          '~/.plif/acp-security.json — this lets the host auto-approve workspace writes and deletes.',
      );
    }
    if (params.modeId === 'bypassPermissions' && !policy.allowBypassPermissions) {
      throw new Error(
        'bypassPermissions is disabled. To enable it, set allowBypassPermissions: true in ' +
          '~/.plif/acp-security.json — this grants the host automatic approval for EVERY action.',
      );
    }
    session.mode = params.modeId;
    session.configOptions = buildSessionConfigOptions(session, policy);
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
      if (params.value === 'acceptEdits' && !policy.allowAcceptEdits) {
        throw new Error(
          'acceptEdits is disabled. Enable it with allowAcceptEdits in ' +
            '~/.plif/acp-security.json — this lets the host auto-approve workspace writes and deletes.',
        );
      }
      if (params.value === 'bypassPermissions' && !policy.allowBypassPermissions) {
        throw new Error(
          'bypassPermissions is disabled. Enable it with allowBypassPermissions in ' +
            '~/.plif/acp-security.json.',
        );
      }
      session.mode = params.value;
    } else if (params.configId === 'model') {
      if (!policy.allowModelSwitch) {
        throw new Error(
          'Model switching from the host is disabled. Enable it with allowModelSwitch in ' +
            '~/.plif/acp-security.json.',
        );
      }
      const eng = await getEngine();
      const bundle = await buildProviderFromStoredConfig(eng, session.storedConfig);
      const stored = session.storedConfig;
      const next = await applyModelChoice(
        eng,
        stored,
        bundle.credentials,
        params.value,
        /* persist */ policy.persistModelSwitch,
      );
      session.storedConfig = next;
      session.modelPicker = await buildModelPicker(next, bundle.credentials).catch(() => ({
        options: [],
        currentValue: params.value as string,
      }));
      if (
        typeof params.value === 'string' &&
        session.modelPicker.currentValue !== params.value &&
        !session.modelPicker.options.some((g) =>
          g.options.some((o) => o.value === params.value),
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

    session.configOptions = buildSessionConfigOptions(session, policy);
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
    if (session.busy) throw new Error(`Session ${params.sessionId} is already processing a prompt`);
    session.busy = true;

    let eng: Engine;
    let bundle: Awaited<ReturnType<typeof buildProviderFromStoredConfig>>;
    try {
      eng = await getEngine();
      bundle = await buildProviderFromStoredConfig(eng, session.storedConfig);
    } catch (error) {
      session.busy = false;
      throw error;
    }
    const { provider } = bundle;

    const attachments: Attachment[] = [];
    const promptParts: string[] = [];
    let imageNumber = 0;
    try {
      for (const block of params.prompt) {
        if (block.type === 'text' && typeof block.text === 'string') {
          promptParts.push(block.text);
        } else if (block.type === 'image') {
          const data = typeof block.data === 'string' ? block.data : '';
          const mediaType = typeof block.mimeType === 'string' ? block.mimeType : '';
          if (!data || !/^image\/[A-Za-z0-9.+-]+$/i.test(mediaType)) {
            throw new Error('ACP image blocks require a non-empty base64 data field and image MIME type.');
          }
          if (data.length > 25_000_000) throw new Error('ACP image blocks are limited to 25 MB of base64 data.');
          imageNumber += 1;
          attachments.push({ kind: 'image', data, mediaType, name: `ACP image ${imageNumber}` });
        } else if (block.type === 'resource_link') {
          const uri = typeof block.uri === 'string' ? block.uri : '';
          if (uri) promptParts.push(`[Resource link: ${uri}]`);
        } else if (block.type === 'resource') {
          const resource = block.resource as { text?: unknown; uri?: unknown; blob?: unknown };
          if (typeof resource.text === 'string') promptParts.push(`[Resource]\n${resource.text}`);
          else if (typeof resource.uri === 'string') promptParts.push(`[Resource: ${resource.uri}]`);
          else if (typeof resource.blob === 'string') promptParts.push('[Binary resource attached; use the client-provided URI if available.]');
        } else if (block.type === 'audio') {
          throw new Error('ACP audio prompt blocks are not supported by the configured model adapter.');
        }
      }
    } catch (error) {
      session.busy = false;
      throw error;
    }
    const rawText = promptParts.join('\n');

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

    session.abortController = new AbortController();
    const turnId = `turn-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const tokenSplitConfig = await loadTokenSplitConfig().catch(() => undefined);

    const tools = [
      ...DEFAULT_TOOLS,
      ...(session.skills ? [skillTool(session.skills), createSkillTool(session.skills)] : []),
      ...(session.mcp ? session.mcp.tools() : []),
    ];

    const systemPrompt = buildSystemPrompt({
      workspace: session.workspace,
      containerName: session.container.name,
      workdir: session.container.workdir,
      tempWorkdir: TEMP_WORKDIR,
      capabilities: session.container.capabilities,
      isolation: eng.sandboxReport.isolation,
      contextTokens: provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
      modelId: provider.info.id,
      providerId: provider.info.providerId,
      endpointRoute: provider.info.endpoint,
      tools: tools.map((t) => t.spec),
      ...(session.skills ? { skills: session.skills.catalogue() } : {}),
      ...(session.mcp && session.mcp.connectedCount > 0
        ? { mcpServers: session.mcp.catalogue() }
        : {}),
    });

    const history: Message[] = [
      { role: 'system', content: systemPrompt },
      ...session.history,
      { role: 'user', content: userText, ...(attachments.length ? { attachments } : {}) },
    ];

    const unsubscribes: Array<() => void> = [];
    let failurePersisted = false;
    const persist = (event: Parameters<Session['append']>[0]): void => {
      void session.durableSession.append(event).catch((error) => {
        log(`could not persist ACP session event: ${error instanceof Error ? error.message : String(error)}`);
      });
    };
    const userEvent = { ...eventBase('user.message', turnId), text: userText };
    persist({ ...eventBase('turn.started', turnId), userEventId: userEvent.eventId });
    persist(userEvent);

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
      }),
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
      }),
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
      }),
    );

    unsubscribes.push(
      eng.bus.on('approval.request', async (e) => {
        if (e.containerId !== session.container?.id) return;
        const targetSession = session;

        // bypassPermissions is only reachable when the local policy allowed it
        // (enforced at setMode/setConfigOption). Never auto-allow otherwise.
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
          const response = await ctx.client.request(
            methods.client.session.requestPermission,
            {
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
            },
          );

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
      }),
    );

    unsubscribes.push(
      eng.bus.on('question.asked', async (e) => {
        if (e.scopeId !== session.sessionId) return;
        const choices = (e.options ?? []).map((option, index) => {
          const value = typeof option === 'string'
            ? option
            : String((option as { value?: unknown }).value ?? '');
          return { value, optionId: `answer-${index}`, name: value || `Option ${index + 1}`, kind: 'allow_once' as const };
        });
        if (choices.length === 0) {
          session.questions.answer(e.id, '');
          return;
        }
        try {
          const response = await ctx.client.request(methods.client.session.requestPermission, {
            sessionId: params.sessionId,
            toolCall: {
              toolCallId: `question-${e.id}`,
              title: e.text,
              kind: 'other',
              status: 'pending',
            },
            options: choices.map(({ optionId, name, kind }) => ({ optionId, name, kind })),
          }) as { outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } };
          const outcome = response.outcome;
          const answer = outcome.outcome === 'selected'
            ? choices.find((choice) => choice.optionId === outcome.optionId)?.value ?? ''
            : '';
          session.questions.answer(e.id, answer);
        } catch {
          session.questions.answer(e.id, '');
        }
      }),
    );

    try {
      const result = await runLoop(history, {
        provider,
        container: session.container,
        questions: session.questions,
        bus: eng.bus,
        turnId,
        signal: session.abortController.signal,
        memory: eng.memory,
        workspace: session.workspace,
        sessionId: params.sessionId,
        contextTokens: provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
        // Token-split pipeline (budgets, spill, tool-clear, prune, verified
        // compaction) applies to ACP sessions exactly like interactive ones.
        tokenSplit: tokenSplitConfig && {
          config: tokenSplitConfig,
          workspace: session.workspace,
          sessionId: params.sessionId,
        },
        tools,
      });

      session.history = result.messages.filter((m) => m.role !== 'system');

      if (result.error) {
        failurePersisted = true;
        persist({ ...eventBase('turn.failed', turnId), reason: result.error.message });
        throw result.error;
      }

      const finalAssistant = [...result.messages].reverse().find(
        (message) => message.role === 'assistant' && message.content.trim(),
      );
      if (finalAssistant) {
        persist({
          ...eventBase('assistant.message', turnId),
          phase: 'final',
          text: finalAssistant.content,
          ...(finalAssistant.reasoning ? { reasoning: finalAssistant.reasoning } : {}),
          ...(finalAssistant.toolCalls ? { toolCalls: finalAssistant.toolCalls } : {}),
        });
      }
      persist({ ...eventBase('turn.completed', turnId), durationMs: Date.now() - Date.parse(userEvent.at) });

      return { stopReason: mapStopReason(result.stop) };
    } catch (error) {
      if (!failurePersisted) {
        persist({ ...eventBase('turn.failed', turnId), reason: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    } finally {
      for (const unsub of unsubscribes) unsub();
      session.busy = false;
    }
  });

  // ── session/cancel ─────────────────────────────────────────────────
  app.onNotification(methods.agent.session.cancel, (ctx) => {
    const params = ctx.params as { sessionId: string };
    const session = sessions.get(params.sessionId);
    if (session) {
      session.abortController.abort();
      session.questions.abandonAll();
    }
  });

  // ── Connect ────────────────────────────────────────────────────────
  await app.connect(stream);

  // Clean teardown: when the host closes stdio, stop containers and flush.
  process.stdin.on('end', () => {
    void (async () => {
      for (const session of sessions.values()) {
        session.abortController.abort();
        session.questions.abandonAll();
        await session.durableSession.close().catch(() => undefined);
        if (session.tempWorkspace) {
          fs.rmSync(session.tempWorkspace, { recursive: true, force: true });
        }
      }
      sessions.clear();
      const eng = engine;
      if (eng) {
        await eng.shutdown('acp stdin closed').catch(() => undefined);
      }
      process.exit(0);
    })();
  });
}

main().catch((err) => {
  process.stderr.write(
    `plif-acp fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
