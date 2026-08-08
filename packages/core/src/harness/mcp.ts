import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

import {
  McpOAuthCoordinator,
  type McpOAuthConfig,
  type McpOAuthProvider,
} from '../auth/mcp-oauth.js';
import type { CredentialRequest } from '../auth/secrets.js';
import { PlifError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import type { Tool, ToolContext, ToolResult } from './tools.js';

export interface StdioServerConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly enabled?: boolean;
}

export interface HttpServerConfig {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Variables a header asked for and did not get, so nothing was sent. */
  readonly unsetVariables?: readonly string[];
  readonly oauth?: McpOAuthConfig;
  readonly enabled?: boolean;
}

export interface McpLoginResult {
  readonly status: McpServerStatus;
  /** True only when the login actually produced credentials. */
  readonly authenticated: boolean;
  /** Credential variables the config wanted and the environment lacks. */
  readonly unsetVariables: readonly string[];
}

export interface McpRegistryOptions {
  readonly oauth?: McpOAuthCoordinator;
  readonly interactive?: boolean;
}

export type McpServerConfig = StdioServerConfig | HttpServerConfig;

export interface McpServerStatus {
  readonly name: string;
  readonly transport: 'stdio' | 'http';
  readonly connected: boolean;
  readonly toolCount: number;
  readonly detail: string;
}

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 24_000;

function isHttp(config: McpServerConfig): config is HttpServerConfig {
  return 'url' in config;
}

export function qualifiedToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n… [${text.length - MAX_OUTPUT} characters elided]`;
}

function flattenContent(result: unknown): { text: string; ok: boolean } {
  const payload = result as {
    isError?: boolean;
    content?: readonly { type?: string; text?: string }[];
    structuredContent?: unknown;
  };

  const parts: string[] = [];
  for (const item of payload?.content ?? []) {
    if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text);
    else if (item?.type) parts.push(`[${item.type} content]`);
  }

  if (parts.length === 0 && payload?.structuredContent !== undefined) {
    parts.push(JSON.stringify(payload.structuredContent, null, 2));
  }

  return {
    text: clip(parts.join('\n').trim() || '(no content)'),
    ok: payload?.isError !== true,
  };
}

class McpServer {
  readonly name: string;
  readonly transport: 'stdio' | 'http';

  #config: McpServerConfig;
  #client: Client | null = null;
  #tools: Tool[] = [];
  #detail = 'not connected';
  #provider: McpOAuthProvider | undefined;
  #httpTransport: StreamableHTTPClientTransport | undefined;
  #bus: EventBus | undefined;

  constructor(name: string, config: McpServerConfig, bus?: EventBus, oauth?: McpOAuthCoordinator) {
    this.name = name;
    this.#config = config;
    this.transport = isHttp(config) ? 'http' : 'stdio';
    this.#bus = bus;
    if (isHttp(config) && oauth) {
      this.#provider = oauth.providerFor(name, new URL(config.url), config.oauth);
    }
  }

  get connected(): boolean {
    return this.#client !== null;
  }

  get tools(): readonly Tool[] {
    return this.#tools;
  }

  get authenticates(): boolean {
    return this.#provider !== undefined;
  }

  get unsetVariables(): readonly string[] {
    return isHttp(this.#config) ? this.#config.unsetVariables ?? [] : [];
  }

  /**
   * Resolves to whether credentials were actually obtained.
   *
   * Connecting is not authenticating. A server that serves anonymous callers
   * connects with no token at all, and reporting that as a successful login
   * would be a lie the developer only discovers when it matters.
   */
  async reauthenticate(): Promise<boolean> {
    const provider = this.#provider;
    if (!provider) {
      throw new PlifError('INVALID_ARGUMENT', `MCP server "${this.name}" has nothing to log in to`);
    }
    await this.close();
    await provider.invalidateCredentials('tokens');
    this.#detail = 'authenticating';
    this.#emitStatus();
    await this.connect();
    return (await provider.tokens()) !== undefined;
  }

  status(): McpServerStatus {
    return {
      name: this.name,
      transport: this.transport,
      connected: this.connected,
      toolCount: this.#tools.length,
      detail: this.#detail,
    };
  }

  async connect(retried = false): Promise<void> {
    const client = new Client(
      { name: 'plif', version: '0.1.0' },
      { capabilities: {} },
    );

    const transport = isHttp(this.#config)
      ? new StreamableHTTPClientTransport(new URL(this.#config.url), {
          requestInit: this.#config.headers ? { headers: { ...this.#config.headers } } : {},
          ...(this.#provider ? { authProvider: this.#provider } : {}),
        })
      : new StdioClientTransport({
          command: (this.#config as StdioServerConfig).command,
          args: [...((this.#config as StdioServerConfig).args ?? [])],
          ...((this.#config as StdioServerConfig).cwd
            ? { cwd: (this.#config as StdioServerConfig).cwd as string }
            : {}),
          env: {
            ...(process.env as Record<string, string>),
            ...((this.#config as StdioServerConfig).env ?? {}),
          },
        });
    this.#httpTransport = transport instanceof StreamableHTTPClientTransport ? transport : undefined;

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`did not respond within ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS,
      ).unref?.(),
    );

    try {
      await Promise.race([client.connect(transport), timeout]);
    } catch (error) {
      if (
        error instanceof UnauthorizedError &&
        transport instanceof StreamableHTTPClientTransport &&
        this.#provider?.hasPendingCallback() &&
        !retried
      ) {
        this.#detail = 'authenticating';
        this.#emitStatus();
        const code = await this.#provider.waitForCallback();
        await transport.finishAuth(code);
        await client.close().catch(() => undefined);
        return this.connect(true);
      }
      throw error;
    }
    this.#client = client;

    const listed = await client.listTools();
    this.#tools = listed.tools.map((tool) => this.#wrap(tool));
    this.#detail = `${this.#tools.length} tools`;
    this.#emitStatus();
  }

  #wrap(tool: { name: string; description?: string; inputSchema?: unknown }): Tool {
    const server = this.name;
    const client = (): Client => {
      if (!this.#client) {
        throw new PlifError('INTERNAL', `MCP server "${server}" is not connected`);
      }
      return this.#client;
    };

    return {
      spec: {
        name: qualifiedToolName(server, tool.name),
        description: `[${server}] ${tool.description ?? tool.name}`,
        parameters: (tool.inputSchema as Record<string, unknown>) ?? {
          type: 'object',
          properties: {},
        },
      },
      run: async (input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> =>
        this.#callTool(client, tool.name, input, context, false),
    };
  }

  async #callTool(
    client: () => Client,
    toolName: string,
    input: Record<string, unknown>,
    context: ToolContext,
    retried: boolean,
  ): Promise<ToolResult> {
    try {
      const result = await client().callTool(
          { name: toolName, arguments: input },
          undefined,
          {
            timeout: CALL_TIMEOUT_MS,
            ...(context.signal ? { signal: context.signal } : {}),
          },
      );
      const { text, ok } = flattenContent(result);
      return { output: text, ok };
    } catch (error) {
      if (error instanceof UnauthorizedError && this.#provider?.hasPendingCallback() && !retried) {
        const transport = this.#httpTransport;
        if (!transport) throw error;
        this.#detail = 'authenticating';
        this.#emitStatus();
        const code = await this.#provider.waitForCallback();
        await transport.finishAuth(code);
        const previous = this.#client;
        this.#client = null;
        await previous?.close().catch(() => undefined);
        await this.connect(true);
        return this.#callTool(client, toolName, input, context, true);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    this.#tools = [];
    this.#detail = 'closed';
    await client?.close().catch(() => undefined);
  }

  fail(reason: string): void {
    this.#detail = reason;
    this.#tools = [];
  }

  #emitStatus(): void {
    this.#bus?.emit('mcp.status', {
      server: this.name,
      transport: this.transport,
      connected: this.connected,
      toolCount: this.#tools.length,
      detail: this.#detail,
    });
  }
}

export class McpRegistry {
  #servers: McpServer[] = [];
  #bus: EventBus | undefined;
  #oauth: McpOAuthCoordinator;

  constructor(bus?: EventBus, options: McpRegistryOptions = {}) {
    this.#bus = bus;
    this.#oauth = options.oauth ?? new McpOAuthCoordinator(bus, { interactive: options.interactive ?? false });
  }

  static async connect(
    configs: Readonly<Record<string, McpServerConfig>>,
    bus?: EventBus,
    options?: McpRegistryOptions,
  ): Promise<McpRegistry> {
    const registry = new McpRegistry(bus, options);
    await registry.start(configs);
    return registry;
  }

  async start(configs: Readonly<Record<string, McpServerConfig>>): Promise<void> {
    const previous = this.#servers;
    this.#servers = [];
    await Promise.all(previous.map((server) => server.close()));

    const enabled = Object.entries(configs).filter(([, config]) => config.enabled !== false);
    if (enabled.some(([, config]) => isHttp(config))) await this.#oauth.start();
    this.#servers = enabled.map(([name, config]) => new McpServer(name, config, this.#bus, this.#oauth));

    await Promise.all(
      this.#servers.map(async (server) => {
        try {
          await server.connect();
          this.#bus?.emit('mcp.connected', {
            server: server.name,
            transport: server.transport,
            tools: server.tools.map((tool) => tool.spec.name),
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          server.fail(reason);
          const status = server.status();
          this.#bus?.emit('mcp.status', { ...status, server: status.name });
          this.#bus?.emit('log', {
            level: 'warn',
            message: `MCP server "${server.name}" is unavailable`,
            detail: { reason },
          });
        }
      }),
    );

  }

  /**
   * Authenticate one server on demand, rather than waiting for a 401.
   *
   * Stored tokens are dropped first. A token the server still accepts would
   * connect straight through and never reach the browser, which is exactly the
   * case someone runs this to get out of.
   */
  async login(server: string): Promise<McpLoginResult> {
    const target = this.#servers.find((item) => item.name === server);
    if (!target) {
      throw new PlifError('INVALID_ARGUMENT', `no MCP server named "${server}"`, {
        detail: { known: this.#servers.map((item) => item.name) },
      });
    }
    if (!target.authenticates) {
      throw new PlifError(
        'INVALID_ARGUMENT',
        `MCP server "${server}" does not authenticate`,
        { hint: 'Only remote HTTP servers log in. A stdio server runs as a local process.' },
      );
    }

    let authenticated: boolean;
    try {
      authenticated = await target.reauthenticate();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      target.fail(reason);
      this.#bus?.emit('mcp.status', { ...target.status(), server: target.name });
      throw error;
    }

    this.#bus?.emit('mcp.connected', {
      server: target.name,
      transport: target.transport,
      tools: target.tools.map((tool) => tool.spec.name),
    });
    return { status: target.status(), authenticated, unsetVariables: target.unsetVariables };
  }

  names(): string[] {
    return this.#servers.map((server) => server.name);
  }

  tools(): Tool[] {
    return this.#servers.flatMap((server) => [...server.tools]);
  }

  statuses(): McpServerStatus[] {
    return this.#servers.map((server) => server.status());
  }

  get connectedCount(): number {
    return this.#servers.filter((server) => server.connected).length;
  }

  catalogue(): string {
    const connected = this.#servers.filter((server) => server.connected);
    if (connected.length === 0) return '';
    return connected
      .map((server) => `- ${server.name} (${server.transport}): ${server.tools.length} tools`)
      .join('\n');
  }

  async close(): Promise<void> {
    await Promise.all(this.#servers.map((server) => server.close()));
    await this.#oauth.close();
    this.#servers = [];
  }
}

export function parseServerConfigs(
  value: unknown,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, McpServerConfig> {
  if (!value || typeof value !== 'object') return {};

  const expand = (input: string): string => expandMcpEnvironment(input, environment);

  const expandRecord = (input: unknown): Record<string, string> | undefined => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([key, item]) => [key, expand(item)]),
    );
  };

  /**
   * Headers, with the empty ones dropped and their variables remembered.
   *
   * `"Authorization": "${API_KEY:-}"` means "omit this when the key is unset",
   * not "send an empty credential". Remembering the name is what lets the CLI
   * say which variable to set instead of reporting a bare refusal.
   */
  const expandHeaders = (
    input: unknown,
    unset: string[],
  ): Record<string, string> | undefined => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      if (typeof item !== 'string') continue;
      // Judged by the variables, not by the result. `"Bearer ${KEY:-}"` expands
      // to a non-empty "Bearer " that is not a credential, and sending it is
      // both useless and a header the server has to reject.
      const gaps = credentialGaps(item, environment);
      if (gaps.length > 0) {
        unset.push(...gaps);
        continue;
      }
      const value = expand(item);
      if (value.trim()) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const out: Record<string, McpServerConfig> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const config = raw as Record<string, unknown>;

    if (typeof config['url'] === 'string') {
      const unsetVariables: string[] = [];
      const headers = expandHeaders(config['headers'], unsetVariables);
      const oauthRaw = config['oauth'];
      const oauth = oauthRaw && typeof oauthRaw === 'object'
        ? {
            ...(typeof (oauthRaw as Record<string, unknown>)['clientMetadataUrl'] === 'string'
              ? { clientMetadataUrl: expand((oauthRaw as Record<string, string>)['clientMetadataUrl']!) }
              : {}),
            ...(typeof (oauthRaw as Record<string, unknown>)['scope'] === 'string'
              ? { scope: expand((oauthRaw as Record<string, string>)['scope']!) }
              : {}),
          }
        : undefined;
      out[name] = {
        url: expand(config['url']),
        ...(headers ? { headers } : {}),
        ...(unsetVariables.length ? { unsetVariables: [...new Set(unsetVariables)] } : {}),
        ...(oauth ? { oauth } : {}),
        ...(config['enabled'] === false ? { enabled: false } : {}),
      };
      continue;
    }

    if (typeof config['command'] === 'string') {
      const args = Array.isArray(config['args'])
        ? config['args'].filter((arg): arg is string => typeof arg === 'string').map(expand)
        : undefined;
      const env = expandRecord(config['env']);
      out[name] = {
        command: expand(config['command']),
        ...(args ? { args } : {}),
        ...(env ? { env } : {}),
        ...(typeof config['cwd'] === 'string' ? { cwd: expand(config['cwd']) } : {}),
        ...(config['enabled'] === false ? { enabled: false } : {}),
      };
    }
  }
  return out;
}

/**
 * The credentials a parsed configuration asked for and did not get.
 *
 * Parsing stays pure and synchronous: it reports what is missing rather than
 * going looking for it. The caller resolves these however it can — a store, a
 * prompt — and parses once more with the answers.
 */
export function missingMcpCredentials(
  configs: Readonly<Record<string, McpServerConfig>>,
): { variable: string; servers: string[] }[] {
  const byVariable = new Map<string, string[]>();
  for (const [server, config] of Object.entries(configs)) {
    if (!isHttp(config)) continue;
    for (const variable of config.unsetVariables ?? []) {
      const servers = byVariable.get(variable) ?? [];
      if (!servers.includes(server)) servers.push(server);
      byVariable.set(variable, servers);
    }
  }
  return [...byVariable.entries()].map(([variable, servers]) => ({ variable, servers }));
}

/**
 * Parse, find what is missing, fetch it, parse again.
 *
 * Two passes because parsing is pure: the first reports which credentials the
 * configuration wanted, and the second builds the headers now that they exist.
 * A broker that cannot ask simply returns nothing and the configuration stands
 * as parsed, so a non-interactive run still uses whatever is already stored.
 */
export async function resolveServerConfigs(
  raw: unknown,
  credentials: {
    resolveAll(requests: readonly CredentialRequest[]): Promise<Record<string, string>>;
  },
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Record<string, McpServerConfig>> {
  const parsed = parseServerConfigs(raw, environment);
  const missing = missingMcpCredentials(parsed);
  if (missing.length === 0) return parsed;

  const found = await credentials.resolveAll(
    missing.map(({ variable, servers }) => ({
      variable,
      purpose: servers.join(' and '),
      hint: `${servers.join(' and ')} cannot authenticate without it.`,
    })),
  );
  return Object.keys(found).length > 0
    ? parseServerConfigs(raw, { ...environment, ...found })
    : parsed;
}

/**
 * Variables this template needs and cannot get.
 *
 * A reference with a non-empty default is not a gap — `${MODE:-fast}` is fully
 * satisfied by its own default and nobody should be asked for it.
 */
export function credentialGaps(
  value: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const gaps: string[] = [];
  for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}/g)) {
    const name = match[1] as string;
    if (environment[name]?.trim()) continue;
    if (match[2]?.trim()) continue;
    gaps.push(name);
  }
  return gaps;
}

export function expandMcpEnvironment(
  value: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}/g,
    (_match, name: string, fallback: string | undefined) => {
      const resolved = environment[name];
      if (resolved) return resolved;
      if (fallback !== undefined) return fallback;
      if (resolved !== undefined) return resolved;
      throw new PlifError(
        'INVALID_ARGUMENT',
        `MCP configuration references missing environment variable ${name}`,
      );
    },
  );
}
