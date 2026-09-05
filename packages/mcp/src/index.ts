#!/usr/bin/env node
/**
 * plif-mcp — plif's own tool surface, served as one MCP server.
 *
 * The point of this package is that a plif user should not have to assemble a
 * filesystem server, a search server, a shell server and a prompt library from
 * four unrelated projects, each with its own path handling and its own idea of
 * what a client may do. Plif already has those tools, and they already run
 * behind a container: the path jail, the policy engine, the sandbox and the
 * audit log all sit inside `Container`, so a tool reached over MCP is confined
 * by exactly the same machinery as the same tool called in-loop. This file
 * adds a transport and a grant model; it adds no new capability.
 *
 * Two surfaces come out of it:
 *
 * - **Tools** — read/search by default, editing and command execution only
 *   when the machine's owner has granted those tiers in
 *   ~/.plif/mcp-security.json. See `security.ts` for why the tiers are split.
 * - **Prompts** — plif's skill catalogue, builtin plus user plus project, each
 *   skill offered as an MCP prompt. A skill is a procedure written to be read
 *   by a model, which is what an MCP prompt is for; serving them means another
 *   agent can borrow this machine's accumulated way of working instead of
 *   rediscovering it.
 *
 * The server speaks stdio and is meant to be launched per client. stdout
 * carries JSON-RPC and nothing else — every diagnostic goes to stderr, because
 * one stray `console.log` on this channel corrupts the framing and the client
 * sees a parse error instead of the message that explains it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  Engine,
  QuestionBroker,
  SkillRegistry,
  skillTool,
  toolRegistry,
  toolsForEnvironment,
  type Skill,
  type Tool,
  type ToolContext,
} from '@plif/core';
import {
  MCP_POLICY,
  grantedTiers,
  isWorkspaceAllowed,
  loadSecurityPolicy,
  securityPolicyPath,
  type McpSecurityPolicy,
} from './security.js';
import { callTool, describeTool, exposedTools } from './tools.js';

const SERVER_NAME = 'plif';
const SERVER_VERSION = '0.4.0';

const CONTAINER_WORKDIR = '/project';
const TEMP_WORKDIR = '/temp';

/**
 * Paths the served workspace never shows, mirroring the ACP adapter.
 *
 * The mask is part of the mount rather than a filter over results, so it holds
 * for a shell command that globs as much as for `read_file` on a literal path.
 */
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

function log(message: string): void {
  process.stderr.write(`plif-mcp: ${message}\n`);
}

/**
 * The workspace this server serves.
 *
 * It comes from the launcher's cwd, never from the client: a client that could
 * name a directory could name `/`, and the mask list above would then be
 * protecting the wrong tree. `workspaceRoots`, when configured, turns the
 * inherited cwd into a checked value instead of a trusted one.
 */
function resolveWorkspace(policy: McpSecurityPolicy): string {
  let workspace = path.resolve(process.cwd());
  try {
    workspace = fs.realpathSync.native(workspace);
  } catch {
    throw new Error(`workspace does not exist: ${workspace}`);
  }
  if (policy.workspaceRoots.length > 0 && !isWorkspaceAllowed(workspace, policy.workspaceRoots)) {
    throw new Error(
      `workspace ${workspace} is outside the permitted roots. ` +
        `Add an absolute path to workspaceRoots in ${securityPolicyPath()}, or start the server inside a permitted root.`,
    );
  }
  return workspace;
}

/**
 * What the client's model is told about this server as a whole.
 *
 * Naming the ungranted tiers is deliberate. A client that does not know
 * editing is off spends its turns discovering that by having writes refused;
 * one that knows says so to its user and stops.
 */
function serverInstructions(policy: McpSecurityPolicy, workspace: string): string {
  const granted = grantedTiers(policy);
  const lines = [
    `plif serves the workspace at ${workspace}. Every call runs inside a plif container: ` +
      `paths are jailed to the workspace, the policy engine reviews each action, and everything is audited.`,
    `Granted tool tiers: ${granted.join(', ')}.`,
  ];
  if (!policy.allowEdit) {
    lines.push(
      'Writing is not granted. Do not attempt to modify files through this server; report the change you would make instead.',
    );
  }
  if (!policy.allowExec) {
    lines.push('Command execution is not granted. Do not plan work that depends on running a build or test here.');
  }
  if (policy.allowSkills) {
    lines.push(
      "This server's prompts are plif skills: procedures for specific kinds of work. " +
        'Read the matching one before starting work it covers.',
    );
  }
  return lines.join('\n\n');
}

/** A skill rendered as an MCP prompt entry. */
function promptDescriptor(skill: Skill): { name: string; title: string; description: string } {
  return {
    name: skill.name,
    title: skill.name,
    description: skill.description,
  };
}

/**
 * A bounded gate over concurrent tool calls.
 *
 * MCP clients pipeline requests, and a client that pipelines a hundred greps
 * would have plif's engine start a hundred sandboxed processes. The ceiling is
 * a queue rather than a rejection because a refused call reads to the model as
 * a broken tool, and it would then retry — turning a load problem into a loop.
 */
class CallGate {
  #limit: number;
  #active = 0;
  #waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#limit) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#active += 1;
    try {
      return await work();
    } finally {
      this.#active -= 1;
      this.#waiting.shift()?.();
    }
  }
}

async function main(): Promise<void> {
  const policy = await loadSecurityPolicy();
  const workspace = resolveWorkspace(policy);
  log(
    `tiers: ${grantedTiers(policy).join(',')} · workspace: ${workspace} · ` +
      `policy: ${fs.existsSync(securityPolicyPath()) ? securityPolicyPath() : 'defaults'}`,
  );

  const engine = new Engine({ policy: MCP_POLICY });
  await engine.start();

  const image = await engine.ensureBaseImage();
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plif-mcp-'));
  /**
   * The workspace mount is read-only unless a tier that writes was granted.
   *
   * This is not belt-and-braces over the tool allowlist: a read-write host
   * mount makes the container demand OS-level write confinement from the
   * sandbox backend, and a machine whose backend cannot provide that refuses
   * to start the container at all. Asking for `rw` to serve a read-only tool
   * set would therefore take the default configuration — read and skills — off
   * every platform without full host-write isolation, to protect writes that
   * cannot happen because no write tool is on the menu.
   */
  const writable = policy.allowEdit || policy.allowExec;
  const container = await engine.run({
    image: image.reference,
    mounts: [
      {
        source: workspace,
        target: CONTAINER_WORKDIR,
        mode: writable ? ('rw' as const) : ('ro' as const),
        mask: [...MOUNT_MASKS],
      },
      { source: tempWorkspace, target: TEMP_WORKDIR, mode: 'rw' as const, mask: [] as string[] },
    ],
    workdir: CONTAINER_WORKDIR,
    /**
     * The container's capabilities are narrowed to the granted tiers.
     *
     * `exec` is dropped, not merely unused, when the exec tier is off. The
     * container refuses to start when it can spawn processes, cannot confine
     * host writes, and has a process-visible host mount — all three of which
     * hold on a backend without filesystem write isolation. Dropping the
     * ability to spawn anything removes the first leg, and the read tools do
     * not need it: they go through the container filesystem API, never through
     * a process. `network` follows exec because nothing else here can reach it.
     */
    capabilities: { exec: policy.allowExec, network: policy.allowExec, hostWrite: writable },
  });

  const skills = await SkillRegistry.load({ workspace, root: engine.paths.root }).catch(
    (error: unknown) => {
      log(`skills unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    },
  );

  const extras: Tool[] = skills && policy.allowSkills ? [skillTool(skills)] : [];
  const available = exposedTools(toolsForEnvironment(null, extras), policy);
  const registry = toolRegistry(available);
  log(`serving ${registry.size} tools and ${skills && policy.allowSkills ? skills.list().length : 0} prompts`);

  /**
   * One tool context for the process lifetime.
   *
   * There is no per-call session state to carry: memory is the engine's, and
   * the loop-scoped facilities a tool might otherwise reach for (goals, plans,
   * tasks) belong to tools this server does not expose. The question broker is
   * present but unreachable — nothing is listening on the bus for a question —
   * so a policy decision of `ask` times out into a refusal, which is the right
   * direction for a headless surface.
   */
  const context: ToolContext = {
    container,
    questions: new QuestionBroker(engine.bus, 1_000),
    signal: undefined,
    memory: engine.memory,
    readOnlyMemory: true,
    workspace: CONTAINER_WORKDIR,
    bus: engine.bus,
  };

  const gate = new CallGate(policy.maxConcurrentCalls);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        ...(skills && policy.allowSkills ? { prompts: {} } : {}),
      },
      instructions: serverInstructions(policy, workspace),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: available.map((tool) => describeTool(tool)),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = registry.get(request.params.name);
    if (!tool) {
      // An unknown name is a client mistake about the menu, not a tool that
      // ran and failed, so it is reported as a tool error the model can read
      // rather than a protocol error that reaches only the client's plumbing.
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `No tool named "${request.params.name}" is served here. ` +
              `Available: ${[...registry.keys()].join(', ')}.`,
          },
        ],
        isError: true,
      };
    }
    const input = (request.params.arguments ?? {}) as Record<string, unknown>;
    return await gate.run(() => callTool(tool, input, context));
  });

  if (skills && policy.allowSkills) {
    server.setRequestHandler(ListPromptsRequestSchema, () => ({
      prompts: skills.list().map(promptDescriptor),
    }));

    server.setRequestHandler(GetPromptRequestSchema, (request) => {
      const skill = skills.get(request.params.name);
      if (!skill) throw new Error(`No skill named "${request.params.name}"`);
      return {
        description: skill.description,
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: skill.instructions },
          },
        ],
      };
    });
  }

  const shutdown = async (reason: string): Promise<void> => {
    await container.remove().catch(() => undefined);
    await engine.shutdown(reason).catch(() => undefined);
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  };

  // The client closing stdin is the only orderly end a stdio server gets.
  process.stdin.on('end', () => {
    void shutdown('mcp stdin closed').then(() => process.exit(0));
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(`received ${signal}`).then(() => process.exit(0));
    });
  }

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  log(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
