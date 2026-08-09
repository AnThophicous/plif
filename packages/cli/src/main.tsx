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

import { render } from 'ink';
import React from 'react';

import {
  CredentialBroker,
  DEVELOPER_POLICY,
  Engine,
  OpenAIProvider,
  WindowsDpapiSecretStore,
  resolveServerConfigs,
  PlifError,
  STRICT_POLICY,
  describe,
  loadStoredConfig,
  globalConfigPath,
  resolveConfig,
  saveStoredConfig,
  buildSystemPrompt,
  DEFAULT_TOOLS,
  McpRegistry,
  SkillRegistry,
  parseServerConfigs,
  DEFAULT_CONTEXT_TOKENS,
  runLoop,
  subagentTool,
  WEB_TOOLS,
  skillTool,
  createSkillTool,
  summariseMemory,
  validateModelConfig,
  isAutoApproveEnabled,
  loadGlobalConfig,
  permissionMode,
  TaskManager,
  LspManager,
  lspTools,
  EditCoordinator,
  agentsOf,
  mcpServersOf,
  profilesOf,
  readAgentInstructions,
  visionTools,
} from '@plif/core';
import type { GlobalConfig, Session } from '@plif/core';

import { App } from './app.js';
import { renderBanner } from './banner.js';
import { HELP_TOPICS, USAGE, parseArgv } from './argv.js';
import type { GlobalFlags, Invocation } from './argv.js';
import { formatDuration, formatRelative, plain } from './print.js';
import { containerMount, containerWorkdir } from './container-paths.js';
import { activateTheme, loadThemes } from './themes.js';
import { detachImmediateInkResize } from './terminal-resize.js';
import { disableBracketedPaste, enableBracketedPaste } from './paste.js';

const VERSION = '0.2.0';

function buildEngine(flags: GlobalFlags): Engine {
  return new Engine({
    ...(flags.root ? { root: flags.root } : {}),
    policy: flags.strict ? STRICT_POLICY : DEVELOPER_POLICY,
  });
}

/**
 * Wire teardown before anything can start a container.
 *
 * Containers hold OS resources that outlive this process if we exit badly, so
 * every path out goes through the same idempotent shutdown.
 */
function installTeardown(engine: Engine): () => Promise<void> {
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

async function main(): Promise<void> {
  const invocation = parseArgv(process.argv.slice(2), process.cwd());

  switch (invocation.kind) {
    case 'version':
      process.stdout.write(`plif ${VERSION}\n`);
      return;

    case 'help': {
      const topic = invocation.topic;
      if (topic && HELP_TOPICS[topic]) {
        process.stdout.write(HELP_TOPICS[topic]);
      } else if (topic) {
        process.stderr.write(
          `plif: no help topic "${topic}". Available: ${Object.keys(HELP_TOPICS).join(', ')}\n`,
        );
        process.exitCode = 1;
      } else {
        process.stdout.write(USAGE);
      }
      return;
    }

    case 'error':
      process.stderr.write(`plif: ${invocation.message}\n`);
      if (invocation.hint) process.stderr.write(`      ${invocation.hint}\n`);
      process.exitCode = 2;
      return;

    case 'sessions':
      return await runSessions(invocation);

    case 'sandbox':
      return await runSandbox(invocation);

    case 'model':
      return await runModel(invocation);

    case 'skills':
      return await runSkills(invocation);

    case 'mcp':
      return await runMcp(invocation);

    case 'prompt':
      return await runPrompt(invocation);

    case 'continue':
    case 'resume':
    case 'interactive':
      return await runInteractive(invocation);
  }
}

// ---------------------------------------------------------------------------
// Non-interactive commands
// ---------------------------------------------------------------------------

async function runSessions(
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

async function runSandbox(invocation: Extract<Invocation, { kind: 'sandbox' }>): Promise<void> {
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

async function runSkills(invocation: Extract<Invocation, { kind: 'skills' }>): Promise<void> {
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

async function runMcp(invocation: Extract<Invocation, { kind: 'mcp' }>): Promise<void> {
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

/** Build a provider from the resolved configuration, or explain why not. */
async function buildProvider(engine: Engine, flags: GlobalFlags): Promise<OpenAIProvider> {
  const stored = await loadStoredConfig(engine.paths);
  const activeName = typeof stored.activeProfile === 'string' ? stored.activeProfile : undefined;
  const active = activeName ? profilesOf(stored)[activeName] : undefined;
  const config = resolveConfig(stored, {
    ...(flags.model ? { model: flags.model } : active?.model ? { model: active.model } : {}),
    ...(flags.baseURL ? { baseURL: flags.baseURL } : {}),
    ...(flags.preset ? { preset: flags.preset } : {}),
    ...(flags.apiKey ? { apiKey: flags.apiKey } : {}),
  });

  const check = validateModelConfig(config);
  if (!check.ok) {
    throw new PlifError('MODEL_NOT_CONFIGURED', check.problem ?? 'model is not configured', {
      detail: describe(config),
      ...(check.hint ? { hint: check.hint } : {}),
    });
  }
  return new OpenAIProvider(config);
}

async function runPrompt(invocation: Extract<Invocation, { kind: 'prompt' }>): Promise<void> {
  const engine = buildEngine(invocation.flags);
  const report = await engine.start();
  await configureGlobalApprovals(engine);
  const themeCatalogue = await loadThemes();
  for (const problem of themeCatalogue.problems) process.stderr.write(`plif theme: ${problem}\n`);
  const appearance = await loadGlobalConfig();
  activateTheme(
    themeCatalogue.themes.find((theme) => theme.id === appearance.theme) ?? themeCatalogue.themes[0]!,
  );
  const done = installTeardown(engine);

  const provider = await buildProvider(engine, invocation.flags);
  const session = await engine.sessions.create(invocation.flags.workspace);
  await session.append({ kind: 'user', at: new Date().toISOString(), text: invocation.text });

  // Ctrl+C during a long run should stop the stream and the tools, not orphan
  // them. One signal is threaded through the model call and every exec.
  const abort = new AbortController();
  process.on('SIGINT', () => abort.abort());

  // The agent works in a container with the current directory mounted. Read-only by
  // default: a one-shot question should never be able to edit the project,
  // and `--write` is the explicit opt-in.
  const image = await engine.ensureBaseImage();
  const container = await engine.run({
    image: image.reference,
    mounts: [
      { ...containerMount(invocation.flags.workspace), mode: invocation.flags.write ? 'rw' : 'ro' },
    ],
    workdir: containerWorkdir(invocation.flags.workspace),
    // Network is a ceiling, not a licence: policy still asks per host, and in a
    // one-shot run that question is answered by `--yes` or denied immediately.
    capabilities: { network: true, ...(invocation.flags.write ? { hostWrite: true } : {}) },
  });

  // Narrate tool use on stderr so stdout stays the answer and stays pipeable.
  engine.bus.on('agent.tool', (event) => {
    if (event.phase !== 'end') return;
    process.stderr.write(`  ${event.ok ? '·' : '!'} ${event.name} (${event.durationMs}ms)\n`);
  });
  engine.bus.on('agent.text', (event) => process.stdout.write(event.delta));

  // Thinking goes to stderr, never to stdout. `plif prompt` is meant to be
  // piped, and a reasoning model's interior monologue in the middle of the
  // answer would corrupt whatever is reading it — which is the same reason the
  // splitter exists at all for models that write `<think>` into content.
  engine.bus.on('agent.thinking', (event) => {
    if (event.phase !== 'end') return;
    process.stderr.write(`  ${'✦'} thought for ${Math.round((event.durationMs ?? 0) / 100) / 10}s\n`);
  });

  engine.bus.on('agent.compacting', (event) => {
    process.stderr.write(`  ~ compacting (${event.step}/${event.steps}): ${event.stage}\n`);
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

  const snapshot = await engine.memory.snapshot(invocation.flags.workspace);
  const agentInstructions = await readAgentInstructions(invocation.flags.workspace);
  const skills = await SkillRegistry.load({
    workspace: invocation.flags.workspace,
    root: engine.paths.root,
  });
  const stored = await loadStoredConfig(engine.paths);
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
      new CredentialBroker({ store: new WindowsDpapiSecretStore() }),
    ),
    engine.bus,
  );

  const tools = [...DEFAULT_TOOLS, skillTool(skills), createSkillTool(skills), ...mcp.tools()];
  const tasks = new TaskManager({ container, bus: engine.bus, approvals: engine.approvals });
  const lsp = new LspManager({ root: await container.hostPathFor(container.workdir), bus: engine.bus });
  await lsp.warmup();
  // The subagent inherits the LSP tools but not the parent's own subagent tool
  // — that is what stops recursion, and it is enforced here rather than trusted
  // to the prompt.
  const lspForAgent = lspTools(lsp);
  const edits = new EditCoordinator();
  const childOptions = {
    provider,
    isolation: report.isolation,
    stored,
    agents: agentsOf(stored),
    extraTools: [...lspForAgent, ...WEB_TOOLS],
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
    const result = await runLoop(
      [
        {
          role: 'system',
          content: buildSystemPrompt({
            workspace: invocation.flags.workspace,
            containerName: container.name,
            workdir: container.workdir,
            capabilities: container.capabilities,
            isolation: engine.sandboxReport.isolation,
            tools: agentTools.map((tool) => tool.spec),
            skills: skills.catalogue(),
            mcpServers: mcp.catalogue(),
            guidance: snapshot.guidance,
            memory: summariseMemory(snapshot),
            notes: snapshot.notes,
            sandboxGaps: engine.sandboxReport.degradations,
            ...(agentInstructions ? { agentInstructions } : {}),
            ...(activeProfile
              ? { profile: { name: activeProfile.name ?? activeProfileName!, systemPrompt: activeProfile.systemPrompt } }
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
        signal: abort.signal,
        memory: engine.memory,
        workspace: invocation.flags.workspace,
        sessionId: session.id,
        contextTokens: DEFAULT_CONTEXT_TOKENS,
        tools: agentTools,
        tasks,
        lsp,
        edits,
      },
    );

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

    if (result.text) {
      await session.append({
        kind: 'assistant',
        at: new Date().toISOString(),
        text: result.text,
      });
    }
  } finally {
    await tasks.stopAll();
    await lsp.stop();
    await mcp.close();
    await session.close();
    await done();
  }
}

async function runModel(invocation: Extract<Invocation, { kind: 'model' }>): Promise<void> {
  const engine = buildEngine(invocation.flags);
  await engine.start();

  const stored = await loadStoredConfig(engine.paths);
  const config = resolveConfig(stored, {
    ...(invocation.flags.model ? { model: invocation.flags.model } : {}),
    ...(invocation.flags.baseURL ? { baseURL: invocation.flags.baseURL } : {}),
    ...(invocation.flags.preset ? { preset: invocation.flags.preset } : {}),
    ...(invocation.flags.apiKey ? { apiKey: invocation.flags.apiKey } : {}),
  });

  // `set` writes the current resolution back to the store so it survives the
  // shell. The key is written only if it came from a flag — copying one out of
  // the environment into a file on disk is a decision the user should make
  // explicitly, not a side effect of running `plif model set`.
  if (invocation.action === 'set') {
    await saveStoredConfig(engine.paths, {
      ...stored,
      model: config.model,
      baseURL: config.baseURL,
      ...(invocation.flags.preset ? { preset: invocation.flags.preset } : {}),
      ...(invocation.flags.apiKey ? { apiKey: invocation.flags.apiKey } : {}),
    });
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

  const provider = new OpenAIProvider(config);

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

async function runInteractive(
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

  const startedAt = Date.now();
  const engine = buildEngine(invocation.flags);
  const report = await engine.start();
  await configureGlobalApprovals(engine);
  const themeCatalogue = await loadThemes();
  for (const problem of themeCatalogue.problems) process.stderr.write(`plif theme: ${problem}\n`);
  const appearance = await loadGlobalConfig();
  activateTheme(
    themeCatalogue.themes.find((theme) => theme.id === appearance.theme) ?? themeCatalogue.themes[0]!,
  );
  const done = installTeardown(engine);

  let session: Session | null = null;

  if (invocation.kind === 'continue') {
    session = await engine.sessions.latest(invocation.flags.workspace);
    if (!session) {
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

  // Printed before Ink mounts, so it is ordinary scrollback that Ink never
  // manages — and therefore cannot repaint when the frame outgrows the window.
  const sessionCount = (await engine.sessions.list(invocation.flags.workspace)).length;

  process.stdout.write(
    [
      '',
      renderBanner({
        report,
        workspace: invocation.flags.workspace,
        sessions: sessionCount,
        version: VERSION,
        width: process.stdout.columns ?? 80,
      }),
      '',
    ].join('\n'),
  );

  let provider: OpenAIProvider | null = null;
  let providerProblem: string | null = null;
  try {
    provider = await buildProvider(engine, invocation.flags);
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
  const credentials = new CredentialBroker({
    store: new WindowsDpapiSecretStore(),
    prompt: (request) =>
      engine.questions.ask({
        text: `${request.variable} for ${request.purpose}`,
        secret: true,
        ...(request.hint ? { context: request.hint } : {}),
      }),
  });

  const replay = session ? await session.replay() : [];

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
      replay={replay}
      sessionCount={sessionCount}
      version={VERSION}
      provider={provider}
      providerProblem={providerProblem}
      tools={tools}
      skillCatalogue={skills.catalogue()}
      mcpCatalogue=""
      skills={skills.list()}
      skillRegistry={skills}
      mcpStatuses={[]}
      mcpRegistry={mcp}
      credentials={credentials}
      themeCatalogue={themeCatalogue}
    />,
    // Ink's own Ctrl+C handling would exit before containers are reaped.
    { exitOnCtrlC: false },
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
}

async function configureGlobalApprovals(engine: Engine): Promise<void> {
  const config = await loadGlobalConfig();
  engine.approvals.setPermissionMode(permissionMode(config));
}

void formatDuration;

main().catch((error: unknown) => {
  if (PlifError.is(error)) {
    process.stderr.write(`plif: ${error.message} (${error.code})\n`);
    if (error.hint) process.stderr.write(`      ${error.hint}\n`);
  } else {
    process.stderr.write(`plif: ${error instanceof Error ? error.stack : String(error)}\n`);
  }
  process.exit(1);
});
