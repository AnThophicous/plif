#!/usr/bin/env node
/**
 * Entry point.
 *
 * Two jobs: get the engine to a known-good state before anything renders, and
 * make sure that however the process dies, the containers die with it.
 *
 * Startup order matters. The engine is probed *before* Ink takes over the
 * terminal, so a failure to initialise prints a plain readable error instead of
 * being swallowed by an alternate screen buffer that then tears down.
 *
 * The non-interactive commands (`sessions`, `sandbox`, `prompt`) never mount
 * Ink at all. They print and exit, so they compose with pipes and scripts.
 */

import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// The development entrypoint is executed through tsx, whose TSX transform
// expects the React runtime in modules that contain JSX. The production
// TypeScript build injects react/jsx-runtime, so this was only exposed by
// `npm run dev` after the lazy command split moved <App> here.
import React from 'react';

import {
  CredentialBroker,
  credentialVariableForProvider,
  DEVELOPER_POLICY,
  Engine,
  createModelProvider,
  platformSecretStore,
  resolveServerConfigs,
  PlifError,
  STRICT_POLICY,
  describe,
  loadStoredConfig,
  migrateProviderCredentials,
  globalConfigPath,
  resolveConfig,
  saveStoredConfig,
  providerIdForConfig,
  providerForModel,
  findCatalogProvider,
  userCatalog,
  stripStoredCredentials,
  buildSystemPrompt,
  DEFAULT_TOOLS,
  McpRegistry,
  SkillRegistry,
  mandatorySkillsForEffort,
  parseServerConfigs,
  DEFAULT_CONTEXT_TOKENS,
  eventBase,
  runLoop,
  stableToolSpecs,
  subagentTool,
  WEB_TOOLS,
  skillTool,
  createSkillTool,
  summariseMemory,
  validateModelConfig,
  isAutoApproveEnabled,
  loadGlobalConfig,
  loadTokenSplitConfig,
  permissionMode,
  TaskManager,
  LspManager,
  lspTools,
  EditCoordinator,
  agentsOf,
  mcpServersOf,
  profilesOf,
  readAgentInstructions,
  removePendingLegacyGlobalConfigs,
  visionTools,
  ProviderCapabilityCache,
} from '@plif/core';
import type {
  EffortCapabilityCache,
  GlobalConfig,
  ModelApprovalRequest,
  ModelExecutionContext,
  ModelProvider,
  Session,
  Skill,
  StoredConfig,
} from '@plif/core';

import type { Invocation } from '../argv.js';
import type { GlobalFlags } from '../argv.js';
import { formatRelative, plain } from '../print.js';
import { color, workedSeparator } from '../theme.js';
import { containerMount, containerTempMount, containerWorkdir } from '../container-paths.js';
import { activateTheme, loadThemes } from '../themes.js';
import { detachImmediateInkResize } from '../terminal-resize.js';
import { disableBracketedPaste, enableBracketedPaste } from '../paste.js';
import { startInteractiveSurface } from '../startup.js';
import { createTerminalSurfaceStream } from '../terminal-surface-output.js';
import { VERSION, VERSION_LABEL } from '../version.js';
import { createSessionTempWorkspace } from '../temp-workspace.js';
import { resolveWorkspace } from '../project-root.js';

export function buildEngine(flags: GlobalFlags): Engine {
  return new Engine({
    ...(flags.root ? { root: flags.root } : {}),
    policy: flags.strict ? STRICT_POLICY : DEVELOPER_POLICY,
  });
}

/**
 * Windows Terminal/ConPTY may ignore CSI 3 J, leaving npm's scrollback above
 * the app even after the ANSI viewport clear. `cls` uses the console host's
 * native buffer operation, so interactive development starts on a genuinely
 * empty screen. Non-Windows terminals keep the portable ANSI path.
 */
export function clearNativeInteractiveTerminal(): void {
  if (!process.stdout.isTTY || process.platform !== 'win32') return;
  try {
    spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'cls'], {
      stdio: 'inherit',
      windowsHide: true,
    });
  } catch {
    // The ANSI clear in startInteractiveSurface remains the safe fallback.
  }
}

/**
 * Wire teardown before anything can start a container.
 *
 * Containers hold OS resources that outlive this process if we exit badly, so
 * every path out goes through the same idempotent shutdown.
 */
export function installTeardown(engine: Engine): () => Promise<void> {
  let shuttingDown = false;

  const teardown = async (reason: string, code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await engine.shutdown(reason).catch(() => undefined);
    process.exit(code);
  };

  process.on('SIGINT', () => void teardown('SIGINT', 130));
  process.on('SIGTERM', () => void teardown('SIGTERM', 143));
  process.on('uncaughtException', (error) => {
    process.stderr.write(`\nplif: uncaught exception: ${error.stack ?? error.message}\n`);
    void teardown('uncaught exception', 1);
  });
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`\nplif: unhandled rejection: ${String(reason)}\n`);
    void teardown('unhandled rejection', 1);
  });

  return () => engine.shutdown('exited');
}

// ---------------------------------------------------------------------------
// Non-interactive commands
// ---------------------------------------------------------------------------

export async function runSessions(
  invocation: Extract<Invocation, { kind: 'sessions' }>,
): Promise<void> {
  const engine = buildEngine(invocation.flags);
  await engine.start();

  if (invocation.all) {
    const workspaces = await engine.sessions.workspaces();
    if (invocation.flags.json) {
      process.stdout.write(JSON.stringify(workspaces, null, 2) + '\n');
      return;
    }
    if (workspaces.length === 0) {
      process.stdout.write('No sessions recorded yet.\n');
      return;
    }
    for (const entry of workspaces) {
      process.stdout.write(
        `${String(entry.sessions).padStart(4)}  ${plain(entry.workspace)}\n`,
      );
    }
    return;
  }

  const sessions = await engine.sessions.list(invocation.flags.workspace);

  if (invocation.flags.json) {
    process.stdout.write(JSON.stringify(sessions, null, 2) + '\n');
    return;
  }

  if (sessions.length === 0) {
    process.stdout.write(
      `No sessions for ${plain(invocation.flags.workspace)}.\n` +
        `Run \`plif\` here to start one.\n`,
    );
    return;
  }

  process.stdout.write(`Sessions for ${plain(invocation.flags.workspace)}\n\n`);
  for (const [index, session] of sessions.entries()) {
    // The most recent one is what `plif continue` will reopen, so mark it —
    // otherwise the user has to infer it from the sort order.
    const marker = index === 0 ? '*' : ' ';
    const age = formatRelative(session.updatedAt);
    const turns = `${session.turns} turn${session.turns === 1 ? '' : 's'}`;
    process.stdout.write(
      `${marker} ${session.id}  ${age.padEnd(12)} ${turns.padEnd(10)} ${
        session.title || '(no messages)'
      }\n`,
    );
  }
  process.stdout.write(`\n* \`plif continue\` reopens this one.\n`);
}

export async function runSandbox(invocation: Extract<Invocation, { kind: 'sandbox' }>): Promise<void> {
  const engine = buildEngine(invocation.flags);
  const report = await engine.start();

  if (invocation.flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const flags: readonly (readonly [string, boolean])[] = [
    ['kill process tree', report.killProcessTree],
    ['memory ceiling', report.memoryLimit],
    ['process ceiling', report.processLimit],
    ['cpu throttle', report.cpuLimit],
    ['fs write block', report.filesystemWriteBlock],
    ['network block', report.networkBlock],
    ['accounting', report.accounting],
  ];

  process.stdout.write(`sandbox   ${report.backend} (${report.isolation})\n`);
  process.stdout.write(`encoding  ${report.textEncoding}\n\n`);
  for (const [label, on] of flags) {
    process.stdout.write(`  ${on ? '+' : '-'} ${label}\n`);
  }
  if (report.degradations.length) {
    process.stdout.write('\nnot enforced:\n');
    for (const note of report.degradations) process.stdout.write(`  ! ${note}\n`);
  }

  // A machine that cannot confine anything is a scriptable failure, not just a
  // cosmetic warning — so it exits non-zero and CI can gate on it.
  if (report.isolation === 'none') process.exitCode = 1;
}

export async function runSkills(invocation: Extract<Invocation, { kind: 'skills' }>): Promise<void> {
  const engine = buildEngine(invocation.flags);
  await engine.start();

  const registry = await SkillRegistry.load({
    workspace: invocation.flags.workspace,
    root: engine.paths.root,
  });
  const skills = registry.list();

  if (invocation.flags.json) {
    process.stdout.write(
      JSON.stringify(
        skills.map(({ name, description, scope, file }) => ({ name, description, scope, file })),
        null,
        2,
      ) + '\n',
    );
    return;
  }

  if (skills.length === 0) {
    process.stdout.write('No skills. Add one at .plif/skills/<name>/SKILL.md\n');
    return;
  }

  const width = Math.max(...skills.map((skill) => skill.name.length)) + 2;
  for (const skill of skills) {
    process.stdout.write(
      `${skill.name.padEnd(width)}${skill.scope.padEnd(10)}${skill.description}\n`,
    );
  }
  process.stdout.write(`\n${skills.length} skills. Project skills override user ones.\n`);
}

export async function runMcp(invocation: Extract<Invocation, { kind: 'mcp' }>): Promise<void> {
  const engine = buildEngine(invocation.flags);
  await engine.start();

  const stored = await loadStoredConfig(engine.paths);
  const configs = parseServerConfigs(mcpServersOf(stored as GlobalConfig));

  if (Object.keys(configs).length === 0) {
    process.stdout.write(
      'No MCP servers configured.\n\n' +
        `Add them under "mcp" in ${globalConfigPath()}:\n\n` +
        '  "mcpServers": {\n' +
        '    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }\n' +
        '  }\n',
    );
    return;
  }

  const registry = await McpRegistry.connect(configs, engine.bus);
  const statuses = registry.statuses();

  if (invocation.flags.json) {
    process.stdout.write(JSON.stringify(statuses, null, 2) + '\n');
  } else {
    const width = Math.max(...statuses.map((status) => status.name.length)) + 2;
    for (const status of statuses) {
      process.stdout.write(
        `${status.name.padEnd(width)}${status.connected ? '+' : '-'} ${status.transport.padEnd(7)}${status.detail}\n`,
      );
    }
    const tools = registry.tools();
    if (tools.length > 0) {
      process.stdout.write('\n');
      for (const tool of tools) process.stdout.write(`  ${tool.spec.name}\n`);
    }
  }

  await registry.close();
  if (statuses.some((status) => !status.connected)) process.exitCode = 1;
}

/** Resolve exactly one provider's encrypted/environment credential. */
export async function lookupProviderCredential(
  credentials: CredentialBroker,
  provider: string,
  stored: StoredConfig,
): Promise<string | undefined> {
  return await credentials.lookup(credentialVariableForProvider(provider, stored));
}

/** Move legacy config credentials before a canonical config write can touch them. */
export async function migrateStoredCredentials(
  engine: Engine,
  stored: StoredConfig,
  credentials: CredentialBroker,
  fallbackProvider: string,
): Promise<StoredConfig> {
  try {
    const migration = await migrateProviderCredentials(stored, credentials, fallbackProvider);
    if (migration.migrated) {
      await saveStoredConfig(engine.paths, migration.config, { preserveProviderKeys: false });
    }
    // JSON/JSONC was renamed before TOML was written. Remove that parked copy
    // only after DPAPI migration and the clean canonical write have succeeded.
    await removePendingLegacyGlobalConfigs();
    return migration.config;
  } catch (error) {
    // The vault is written before the plaintext fields are removed and the
    // config write is atomic. A failure therefore leaves the source config
    // intact; fail closed instead of quietly continuing with plaintext.
    throw new PlifError('INTERNAL', 'could not migrate the model credential securely', {
      cause: error,
      hint: 'The plaintext configuration was left untouched. Fix the Windows DPAPI error and retry.',
    });
  }
}

/** Build a provider from the resolved configuration, or explain why not. */
export async function buildProvider(
  engine: Engine,
  flags: GlobalFlags,
  capabilityCache: EffortCapabilityCache = new ProviderCapabilityCache({
    file: path.join(engine.paths.root, 'model-capabilities.json'),
  }),
  credentials?: CredentialBroker,
): Promise<ModelProvider> {
  const loaded = await loadStoredConfig(engine.paths);
  const activeName = typeof loaded.activeProfile === 'string' ? loaded.activeProfile : undefined;
  const active = activeName ? profilesOf(loaded)[activeName] : undefined;
  const selectedModel = flags.model ?? active?.model;
  const inferredProvider = selectedModel ? providerForModel(selectedModel) : undefined;
  const providerId = providerIdForConfig(loaded, {
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(flags.preset ? { preset: flags.preset } : {}),
  });
  const effectiveProvider = inferredProvider ?? providerId;
  const stored = credentials
    ? await migrateStoredCredentials(engine, loaded, credentials, effectiveProvider ?? '')
    : loaded;

  // A clean install should be usable immediately. This is deliberately a
  // provider-level fallback, not a model-id auth exception: OpenCode is the
  // built-in anonymous route and the selected model travels through its normal
  // resolver and validation path. Explicit model/provider/base-url choices
  // still win and are never silently redirected here.
  const hasExplicitRoute = Boolean(
    selectedModel || stored.model || stored.preset || effectiveProvider || flags.baseURL || flags.apiKey || stored.baseURL ||
    process.env['PLIF_MODEL'] || process.env['PLIF_PRESET'] || process.env['PLIF_BASE_URL'],
  );
  if (!hasExplicitRoute) {
    const fallback = { preset: 'opencode', model: 'deepseek-v4-flash-free' } as const;
    const fallbackConfig = resolveConfig(stored, fallback);
    const fallbackCheck = validateModelConfig(fallbackConfig);
    if (fallbackCheck.ok) {
      const next = { ...stored, ...fallback };
      await saveStoredConfig(engine.paths, next, { preserveProviderKeys: false });
      return createModelProvider(fallbackConfig, { capabilityCache, bus: engine.bus });
    }
  }

  // A provider can disappear from config while its old preset/model remains
  // persisted. Do not keep launching into an unusable route: fall back only
  // for that stale-provider case, never for an explicit CLI selection or a
  // known provider that merely needs its key.
  const knownCustom = new Set(userCatalog(stored).map((entry) => entry.id));
  const staleProvider = Boolean(
    !flags.model && !flags.preset && effectiveProvider &&
    !findCatalogProvider(effectiveProvider) && !knownCustom.has(effectiveProvider),
  );
  if (staleProvider) {
    const fallback = { preset: 'opencode', model: 'deepseek-v4-flash-free' } as const;
    const fallbackConfig = resolveConfig(stored, fallback);
    const fallbackCheck = validateModelConfig(fallbackConfig);
    if (fallbackCheck.ok) {
      const next = { ...stored, ...fallback };
      await saveStoredConfig(engine.paths, next, { preserveProviderKeys: false });
      return createModelProvider(fallbackConfig, { capabilityCache, bus: engine.bus });
    }
  }
  const credentialVariable = effectiveProvider === undefined
    ? credentialVariableForProvider('', stored)
    : credentialVariableForProvider(effectiveProvider, stored);
  const storedKey = credentials
    ? await credentials.lookup(credentialVariable)
    : undefined;
  const config = resolveConfig(stored, {
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(flags.baseURL ? { baseURL: flags.baseURL } : {}),
    ...(flags.preset ? { preset: flags.preset } : {}),
    ...(!flags.preset && inferredProvider ? { preset: inferredProvider } : {}),
    ...((flags.apiKey ?? storedKey) ? { apiKey: flags.apiKey ?? storedKey } : {}),
  });

  const check = validateModelConfig(config);
  if (!check.ok) {
    throw new PlifError('MODEL_NOT_CONFIGURED', check.problem ?? 'model is not configured', {
      detail: describe(config),
      ...(check.hint ? { hint: check.hint } : {}),
    });
  }
  return createModelProvider(config, { capabilityCache, bus: engine.bus });
}

export async function runPrompt(invocation: Extract<Invocation, { kind: 'prompt' }>): Promise<void> {
  const startupAppearance = await loadGlobalConfig();
  invocation = {
    ...invocation,
    flags: {
      ...invocation.flags,
      workspace: await resolveWorkspace(
        invocation.flags.workspace,
        startupAppearance.projectRoot,
        invocation.flags.workspaceExplicit,
      ),
    },
  };
  const engine = buildEngine(invocation.flags);
  const report = await engine.start();
  const [appearance, themeCatalogue] = await Promise.all([
    Promise.resolve(startupAppearance),
    loadThemes(),
  ]);
  await configureGlobalApprovals(engine, appearance);
  for (const problem of themeCatalogue.problems) process.stderr.write(`plif theme: ${problem}\n`);
  const initialTheme = themeCatalogue.themes.find((theme) => theme.id === appearance.theme)
    ?? themeCatalogue.themes[0]!;
  activateTheme(
    initialTheme,
  );
  const done = installTeardown(engine);
  const tempWorkspace = await createSessionTempWorkspace({ root: engine.paths.root });

  try {

  const capabilityCache = new ProviderCapabilityCache({
    file: path.join(engine.paths.root, 'model-capabilities.json'),
  });
  const credentials = new CredentialBroker({ store: platformSecretStore() });
  const provider = await buildProvider(engine, invocation.flags, capabilityCache, credentials);
  const promptConfig = resolveConfig(await loadStoredConfig(engine.paths), {
    ...(invocation.flags.model ? { model: invocation.flags.model } : {}),
    ...(invocation.flags.baseURL ? { baseURL: invocation.flags.baseURL } : {}),
    ...(invocation.flags.preset ? { preset: invocation.flags.preset } : {}),
    ...(invocation.flags.apiKey ? { apiKey: invocation.flags.apiKey } : {}),
  });
  const session = await engine.sessions.create(invocation.flags.workspace);
  const userEvent = {
    ...eventBase('user.message', randomUUID()),
    text: invocation.text,
  };
  const turnId = userEvent.turnId;
  await session.append(userEvent);
  await session.append({
    ...eventBase('turn.started', turnId),
    userEventId: userEvent.eventId,
  });
  const stopPersisting = engine.bus.on('conversation.event', (event) => {
    void session.append(event);
  });

  // Ctrl+C during a long run should stop the stream and the tools, not orphan
  // them. One signal is threaded through the model call and every exec.
  const abort = new AbortController();
  process.on('SIGINT', () => abort.abort());

  // The first prompt needs several independent inputs. Start their I/O
  // together so memory/instructions/config latency overlaps image/container
  // preparation instead of extending time to provider dispatch.
  const snapshotPromise = engine.memory.snapshot(invocation.flags.workspace);
  const instructionsPromise = readAgentInstructions(invocation.flags.workspace);
  const storedPromise = loadStoredConfig(engine.paths);
  const skillsPromise = SkillRegistry.load({
    workspace: invocation.flags.workspace,
    root: engine.paths.root,
  });
  const containerPromise = engine.ensureBaseImage().then((image) => engine.run({
    image: image.reference,
    mounts: [
      { ...containerMount(invocation.flags.workspace), mode: invocation.flags.write ? 'rw' : 'ro' },
      containerTempMount(tempWorkspace.hostPath),
    ],
    workdir: containerWorkdir(invocation.flags.workspace),
    // Network is a ceiling, not a licence: policy still asks per host, and in
    // a one-shot run that question is answered by `--yes` or denied immediately.
    capabilities: { network: true, ...(invocation.flags.write ? { hostWrite: true } : {}) },
  }));

  // Narrate tool use on stderr so stdout stays the answer and stays pipeable.
  engine.bus.on('agent.tool', (event) => {
    if (event.phase !== 'end') return;
    process.stderr.write(`  ${event.ok ? '·' : '!'} ${event.name} (${event.durationMs}ms)\n`);
  });
  // stdout is committed only after the provider finishes a valid attempt.
  // A pipe cannot erase partial bytes when a failed stream is reset.

  // Thinking goes to stderr, never to stdout. `plif prompt` is meant to be
  // piped, and a reasoning model's interior monologue in the middle of the
  // answer would corrupt whatever is reading it — which is the same reason the
  // splitter exists at all for models that write `<think>` into content.
  engine.bus.on('agent.thinking', (event) => {
    if (event.phase !== 'end') return;
    process.stderr.write(`  ${'•'} thought for ${Math.round((event.durationMs ?? 0) / 100) / 10}s\n`);
  });

  engine.bus.on('agent.cycle', (event) => {
    process.stderr.write(`  ${workedSeparator(event.durationMs, Math.max(20, (process.stderr.columns ?? 80) - 2))}\n`);
  });

  engine.bus.on('agent.compacting', (event) => {
    process.stderr.write(`  ~ compacting (${event.step}/${event.steps}): ${event.stage}\n`);
  });

  engine.bus.on('agent.compacted', (event) => {
    if (!event.failure) return;
    const outcome = event.failure.fallback === 'raw history preserved'
      ? 'raw history preserved'
      : 'mechanical fallback applied';
    process.stderr.write(
      `  ! compaction: ${event.failure.message}; ${outcome} ` +
      `(${event.failure.attempts} attempt${event.failure.attempts === 1 ? '' : 's'})\n`,
    );
  });

  // Nothing can answer a question in a one-shot run, so say so immediately
  // instead of making the agent wait out the timeout.
  engine.bus.on('question.asked', (event) => {
    process.stderr.write(`  ? ${event.text}\n`);
    engine.questions.answer(
      event.id,
      'There is no human available in this non-interactive run. Pick the most ' +
        'defensible default and state the assumption you made.',
    );
  });

  // Same for approvals, and this one is not optional: with nobody to answer,
  // the broker sits on the request until it times out five minutes later and
  // then denies. The command appears to hang and then produce nothing, which
  // is the worst of both outcomes. Answer immediately instead.
  engine.bus.on('approval.request', (request) => {
    const what = request.argv?.join(' ') ?? request.target;
    if (invocation.flags.yes) {
      process.stderr.write(`  + ${request.action} ${what}\n`);
      engine.approvals.respond(request.id, { decision: 'allow', remember: true });
      return;
    }
    process.stderr.write(`  ! denied (no --yes): ${request.action} ${what}\n`);
    engine.approvals.respond(request.id, { decision: 'deny', remember: true });
  });

  const [container, snapshot, agentInstructions, skills, stored] = await Promise.all([
    containerPromise,
    snapshotPromise,
    instructionsPromise,
    skillsPromise,
    storedPromise,
  ]);
  const activeProfileName = typeof stored.activeProfile === 'string' ? stored.activeProfile : undefined;
  const activeProfile = activeProfileName ? profilesOf(stored)[activeProfileName] : undefined;
  const mcp = await McpRegistry.connect(
    // Either key. `mcp` is what OpenCode writes and what the schema documents;
    // `mcpServers` is what plif shipped with and what is already on people's
    // disks. Reading both costs one call and breaks nobody's config.
    //
    // No prompt here: a one-shot run has nobody to ask, but it still reads what
    // an interactive session already saved, so `plif prompt` inherits the login.
    await resolveServerConfigs(
      mcpServersOf(stored as GlobalConfig),
      credentials,
    ),
    engine.bus,
  );

  const tools = [...DEFAULT_TOOLS, skillTool(skills), createSkillTool(skills), ...mcp.tools()];
  const tasks = new TaskManager({
    container,
    bus: engine.bus,
    approvals: engine.approvals,
    sessionId: session.id,
  });
  const lsp = new LspManager({
    root: await container.hostPathFor(container.workdir),
    tempRoot: tempWorkspace.hostPath,
    bus: engine.bus,
  });
  void lsp.warmup().catch(() => undefined);
  // The subagent inherits the LSP tools but not the parent's own subagent tool
  // — that is what stops recursion, and it is enforced here rather than trusted
  // to the prompt.
  const lspForAgent = lspTools(lsp);
  const edits = new EditCoordinator();
  // Native Codex runs cannot execute PLIF's host-only `skill` tool. Preload
  // the same mandatory skills used by the interactive app into the native
  // developer instructions so `plif prompt` follows the same contract.
  const codexMandatoryNames = mandatorySkillsForEffort(promptConfig.effort);
  const codexSkillBootstrap = provider.info.providerId === 'codex'
    ? codexMandatoryNames
        .map((name) => skills.get(name))
        .filter((skill): skill is Skill => skill !== undefined)
        .map((skill) => ({ name: skill.name, instructions: skill.instructions }))
    : [];
  const childOptions = {
    provider,
    isolation: report.isolation,
    stored,
    resolveCredential: async (providerId: string, childStored: StoredConfig) =>
      await lookupProviderCredential(credentials, providerId, childStored),
    agents: agentsOf(stored),
    agentAutoLaunch: stored.agentAutoLaunch !== false,
    extraTools: [skillTool(skills), ...lspForAgent, ...WEB_TOOLS],
    skillCatalogue: skills.catalogue(),
    skillBootstrap: codexSkillBootstrap,
    edits,
    ...(agentInstructions ? { agentInstructions } : {}),
  };
  const agentTools = [
    ...tools,
    ...lspForAgent,
    ...WEB_TOOLS,
    ...visionTools(childOptions),
    subagentTool(childOptions),
  ];

  try {
    const tokenSplitConfig = await loadTokenSplitConfig();
    const result = await runLoop(
      [
        {
          role: 'system',
            content: buildSystemPrompt({
            workspace: invocation.flags.workspace,
            containerName: container.name,
            workdir: container.workdir,
            tempWorkdir: '/temp',
            capabilities: container.capabilities,
            isolation: engine.sandboxReport.isolation,
            contextTokens: provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
            tools: stableToolSpecs(agentTools.map((tool) => tool.spec)),
            skills: skills.catalogue(),
            loadedSkills: codexSkillBootstrap.map((skill) => skill.name),
            providerId: provider.info.providerId,
            mcpServers: mcp.catalogue(),
            guidance: snapshot.guidance,
            memory: summariseMemory(snapshot),
            notes: snapshot.notes,
            sandboxGaps: engine.sandboxReport.degradations,
            effort: promptConfig.effort,
            ...(agentInstructions ? { agentInstructions } : {}),
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
        { role: 'user', content: invocation.text },
      ],
      {
        provider,
        container,
        questions: engine.questions,
        bus: engine.bus,
        turnId,
        signal: abort.signal,
        memory: engine.memory,
        workspace: invocation.flags.workspace,
        execution: {
          cwd: invocation.flags.workspace,
          workspaceRoots: [invocation.flags.workspace],
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
            });
            return answer.decision === 'allow' ? 'allow' : 'deny';
          },
        } satisfies ModelExecutionContext,
        sessionId: session.id,
        contextTokens: provider.info.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
        tokenSplit: {
          config: tokenSplitConfig,
          workspace: invocation.flags.workspace,
          sessionId: session.id,
        },
        enableHarnessCycle: promptConfig.effort === 'plif',
        tools: agentTools,
        tasks,
        lsp,
        edits,
        skillBootstrap: codexSkillBootstrap,
      },
    );

    if (result.text) process.stdout.write(result.text);
    process.stdout.write('\n');
    if (result.stop !== 'complete') {
      process.stderr.write(`\n(stopped: ${result.stop})\n`);
      if (result.error) process.stderr.write(`${result.error.message}\n`);
      process.exitCode = result.stop === 'cancelled' ? 130 : 1;
    }
    if (invocation.flags.json) {
      process.stderr.write(
        `${result.iterations} turns, ${result.toolCalls} tool calls, ` +
          `${result.promptTokens} in / ${result.completionTokens} out\n`,
      );
    }

  } finally {
    stopPersisting();
    await tasks.stopAll();
    await lsp.stop();
    await mcp.close();
    await session.close();
    await done();
  }
  } finally {
    await tempWorkspace.cleanup();
  }
}

export async function runModel(invocation: Extract<Invocation, { kind: 'model' }>): Promise<void> {
  const engine = buildEngine(invocation.flags);
  await engine.start();

  const loaded = await loadStoredConfig(engine.paths);
  const credentials = new CredentialBroker({ store: platformSecretStore() });
  const providerId = providerIdForConfig(loaded, {
    ...(invocation.flags.model ? { model: invocation.flags.model } : {}),
    ...(invocation.flags.preset ? { preset: invocation.flags.preset } : {}),
  });
  const stored = await migrateStoredCredentials(engine, loaded, credentials, providerId ?? '');
  const credentialVariable = providerId === undefined
    ? credentialVariableForProvider('', stored)
    : credentialVariableForProvider(providerId, stored);
  const brokerKey = await credentials.lookup(credentialVariable);
  const config = resolveConfig(stored, {
    ...(invocation.flags.model ? { model: invocation.flags.model } : {}),
    ...(invocation.flags.baseURL ? { baseURL: invocation.flags.baseURL } : {}),
    ...(invocation.flags.preset ? { preset: invocation.flags.preset } : {}),
    ...((invocation.flags.apiKey ?? brokerKey) ? { apiKey: invocation.flags.apiKey ?? brokerKey } : {}),
  });

  // `set` writes the current resolution back to the store so it survives the
  // shell. The key is written only if it came from a flag — copying one out of
  // the environment into a file on disk is a decision the user should make
  // explicitly, not a side effect of running `plif model set`.
  if (invocation.action === 'set') {
    const credentialProvider = providerId ?? '';
    try {
      if (invocation.flags.apiKey && invocation.flags.apiKey !== 'local') {
        await credentials.remember(
          credentialVariableForProvider(credentialProvider, stored),
          invocation.flags.apiKey,
        );
      }
    } catch (error) {
      throw new PlifError('INTERNAL', 'could not save the model credential securely', { cause: error });
    }
    await saveStoredConfig(engine.paths, stripStoredCredentials({
      ...stored,
      model: config.model,
      baseURL: config.baseURL,
      ...(invocation.flags.preset
        ? { preset: invocation.flags.preset }
        : providerId
          ? { preset: providerId }
          : {}),
    }, credentialProvider), { preserveProviderKeys: false });
    process.stdout.write(`saved: ${config.model} at ${config.baseURL}\n`);
    return;
  }

  if (invocation.flags.json) {
    process.stdout.write(JSON.stringify(describe(config), null, 2) + '\n');
    return;
  }

  for (const [key, value] of Object.entries(describe(config))) {
    process.stdout.write(`${key.padEnd(12)}${value}\n`);
  }

  const check = validateModelConfig(config);
  if (!check.ok) {
    process.stderr.write(`\nnot usable: ${check.problem}\n`);
    if (check.hint) process.stderr.write(`            ${check.hint}\n`);
    process.exitCode = 1;
    return;
  }

  const provider = createModelProvider(config);

  if (invocation.action === 'list') {
    const models = await provider.list();
    process.stdout.write('\n');
    if (models.length === 0) {
      process.stdout.write('this endpoint does not advertise a model list\n');
    } else {
      for (const id of models) process.stdout.write(`${id}\n`);
    }
    return;
  }

  process.stdout.write('\nchecking… ');
  const result = await provider.probe();
  process.stdout.write(result.ok ? `ok — ${result.detail}\n` : `failed — ${result.detail}\n`);
  if (!result.ok) process.exitCode = 1;
}


// ---------------------------------------------------------------------------
// Interactive
// ---------------------------------------------------------------------------

export async function runInteractive(
  invocation: Extract<Invocation, { kind: 'interactive' | 'continue' | 'resume' }>,
): Promise<void> {
  // Check for a terminal before touching the store. Ink needs one, and the
  // earlier form of this created a session first — so every piped `plif` left
  // an empty conversation behind for a run that could never have started.
  if (!process.stdout.isTTY) {
    process.stderr.write(
      'plif: the interactive session needs a terminal.\n' +
        '      Use `plif prompt "..."` or `plif sessions` when piping.\n',
    );
    process.exitCode = 1;
    return;
  }

  const [{ render }, { App }] = await Promise.all([import('ink'), import('../app.js')]);

  const startupAppearance = await loadGlobalConfig();
  invocation = {
    ...invocation,
    flags: {
      ...invocation.flags,
      workspace: await resolveWorkspace(
        invocation.flags.workspace,
        startupAppearance.projectRoot,
        invocation.flags.workspaceExplicit,
      ),
    },
  };
  clearNativeInteractiveTerminal();
  startInteractiveSurface(process.stdout, {
    version: VERSION_LABEL,
    workspace: invocation.flags.workspace,
  });

  const startedAt = Date.now();
  const engine = buildEngine(invocation.flags);
  const report = await engine.start();
  const [appearance, themeCatalogue] = await Promise.all([
    Promise.resolve(startupAppearance),
    loadThemes(),
  ]);
  await configureGlobalApprovals(engine, appearance);
  for (const problem of themeCatalogue.problems) process.stderr.write(`plif theme: ${problem}\n`);
  const initialTheme = themeCatalogue.themes.find((theme) => theme.id === appearance.theme)
    ?? themeCatalogue.themes[0]!;
  activateTheme(initialTheme);
  const done = installTeardown(engine);
  const tempWorkspace = await createSessionTempWorkspace({ root: engine.paths.root });
  // Ink's erase sequence can briefly expose the terminal's default (usually
  // black) on the reserved row below the live frame. Paint that row with the
  // active panel colour after every frame without changing Ink's line count.
  const surfaceStdout = createTerminalSurfaceStream(process.stdout, () => color('panel'));

  try {
  let session: Session | null = null;

  if (invocation.kind === 'continue') {
    session = invocation.id
      ? await engine.sessions.resolve(invocation.flags.workspace, invocation.id)
      : await engine.sessions.latest(invocation.flags.workspace);
    if (!session) {
      if (invocation.id) {
        process.stderr.write(
          `plif: no session "${invocation.id}" in ${plain(invocation.flags.workspace)}.\n` +
            '      Run `plif sessions` to see what is here.\n',
        );
        process.exitCode = 1;
        await done();
        return;
      }
      process.stderr.write(
        `plif: no session to continue in ${plain(invocation.flags.workspace)}.\n` +
          '      Run `plif` to start one.\n',
      );
      process.exitCode = 1;
      await done();
      return;
    }
  } else if (invocation.kind === 'resume') {
    session = await engine.sessions.resolve(invocation.flags.workspace, invocation.id);
    if (!session) {
      process.stderr.write(
        `plif: no session "${invocation.id}" in ${plain(invocation.flags.workspace)}.\n` +
          '      Run `plif sessions` to see what is here.\n',
      );
      process.exitCode = 1;
      await done();
      return;
    }
  }
  // A fresh interactive run deliberately starts with no session. The App
  // creates one on the first message, so quitting without saying anything
  // leaves no empty row in `plif sessions`.

  let provider: ModelProvider | null = null;
  let providerProblem: string | null = null;
  const capabilityCache = new ProviderCapabilityCache({
    file: path.join(engine.paths.root, 'model-capabilities.json'),
  });
  // One broker is shared by startup resolution, model adoption, and MCP. A
  // typed model key therefore has one encrypted home and survives restart.
  const credentials = new CredentialBroker({
    store: platformSecretStore(),
    prompt: (request) =>
      engine.questions.ask({
        text: `${request.variable} for ${request.purpose}`,
        secret: true,
        ...(request.hint ? { context: request.hint } : {}),
      }),
  });
  try {
    provider = await buildProvider(engine, invocation.flags, capabilityCache, credentials);
  } catch (error) {
    providerProblem = PlifError.is(error)
      ? [error.message, error.hint].filter(Boolean).join('\n')
      : String(error);
  }

  const skills = await SkillRegistry.load({
    workspace: invocation.flags.workspace,
    root: engine.paths.root,
  });
  const mcp = new McpRegistry(engine.bus, { interactive: true });
  const tools = [...DEFAULT_TOOLS, skillTool(skills), createSkillTool(skills)];
  // The value comes back through the broker's promise and is written to the
  // encrypted store. It is never put on the bus, so no subscriber — timeline,
  // transcript, audit log — is in a position to leak it.
  const [replay, history] = session
    ? await Promise.all([session.replay(), session.history()])
    : [[], []] as const;

  const resizeListenersBefore = new Set(
    process.stdout.listeners('resize') as Array<(...args: unknown[]) => void>,
  );
  enableBracketedPaste();
  const instance = render(
    <App
      engine={engine}
      report={report}
      cwd={invocation.flags.workspace}
      session={session}
      replay={history}
      contextReplay={replay}
      version={VERSION}
      provider={provider}
      tempDir={tempWorkspace.hostPath}
      capabilityCache={capabilityCache}
      providerProblem={providerProblem}
      effort={appearance.effort}
      initialThemeId={initialTheme.id}
      tools={tools}
      skillCatalogue={skills.catalogue()}
      mcpCatalogue=""
      skills={skills.list()}
      skillRegistry={skills}
      mcpStatuses={[]}
      mcpRegistry={mcp}
      credentials={credentials}
      projectRootSetup={!appearance.projectRoot}
      themeCatalogue={themeCatalogue}
    />,
    // Ink's own Ctrl+C handling would exit before containers are reaped.
    { exitOnCtrlC: false, stdout: surfaceStdout },
  );
  detachImmediateInkResize(process.stdout, resizeListenersBefore);

  await instance.waitUntilExit();
  disableBracketedPaste();
  await mcp.close();

  // Mark the session closed, if one exists. It may have been created lazily by
  // the App after this function already ran, so re-read rather than reusing the
  // `session` binding — and only touch it if this run is what last wrote to it.
  const latest = await engine.sessions.latest(invocation.flags.workspace);
  if (latest && Date.parse(latest.meta.updatedAt) >= startedAt) {
    await latest.close();
  }
  await done();
  } finally {
    await tempWorkspace.cleanup();
  }
}

export async function configureGlobalApprovals(engine: Engine, loaded?: GlobalConfig): Promise<void> {
  const config = loaded ?? await loadGlobalConfig();
  engine.approvals.setPermissionMode(permissionMode(config));
}
