/**
 * The MCP servers plif recommends, ready to add.
 *
 * plif is strong where it runs things itself — a jailed filesystem, policy-
 * checked execution, an audited container, web search and fetch, and four LSP
 * operations. It has no browser and no debugger, and building either natively
 * is a subsystem, not a feature. What it can do instead is stop making people
 * hunt: the servers that cover those gaps are known, and adding one should be
 * a keystroke rather than an afternoon of reading READMEs and hand-editing
 * TOML.
 *
 * ## What is deliberately not here
 *
 * A filesystem server and a memory server both exist and are popular, and
 * neither is listed. plif already does both natively — and more importantly, a
 * filesystem MCP server reads and writes **outside** the container: no path
 * jail, no policy engine, no audit log. Shipping it in a curated list would be
 * recommending the one addition that quietly disables plif's security model.
 * The duplicate is the smaller problem; the bypass is the real one.
 *
 * Puppeteer's server is likewise absent because Playwright's covers the same
 * ground and is the one still being developed.
 *
 * ## What every entry costs
 *
 * An MCP server is somebody else's program, run on this machine, usually
 * fetched by `npx` at first use. That is the existing MCP contract rather than
 * anything new here, but a curated list is an endorsement, so each entry says
 * what it runs and what it needs before it is added.
 */

import { loadGlobalConfig, saveGlobalConfig } from '../config/global.js';

export interface CuratedMcpServer {
  /** The name it is configured under, and how the model addresses its tools. */
  readonly id: string;
  readonly label: string;
  /** What the agent gains. One line, concrete. */
  readonly summary: string;
  /** The gap in plif this fills, shown so the choice is informed. */
  readonly fills: 'browser' | 'devtools' | 'docs' | 'vcs' | 'reasoning';
  readonly command: string;
  readonly args: readonly string[];
  /**
   * Environment variables the server needs to be useful.
   *
   * Named rather than prompted for: plif never puts a credential in a config
   * file, and the MCP header/env path already resolves `${VAR}` from the
   * environment and the encrypted store.
   */
  readonly requires?: readonly string[];
  /** Anything worth knowing before it runs, in one sentence. */
  readonly note?: string;
}

/**
 * The curated list.
 *
 * Every package here was checked to exist on the public registry rather than
 * recalled, because a curated list that installs a package that was never
 * published is worse than no list.
 */
export const CURATED_MCP_SERVERS: readonly CuratedMcpServer[] = Object.freeze([
  {
    id: 'playwright',
    label: 'Playwright browser',
    summary: 'Drive a real browser: open pages, click, fill forms, read the DOM, screenshot.',
    fills: 'browser',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    note: 'Downloads a browser on first use, which takes a minute and a few hundred megabytes.',
  },
  {
    id: 'chrome-devtools',
    label: 'Chrome DevTools',
    summary: 'Performance traces, console messages, network requests and DOM inspection from a live page.',
    fills: 'devtools',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
    note: 'Attaches to Chrome, so it complements Playwright rather than replacing it.',
  },
  {
    id: 'context7',
    label: 'Context7 library docs',
    summary: 'Current API documentation for a named library and version, instead of guessing from training data.',
    fills: 'docs',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@latest'],
  },
  {
    id: 'github',
    label: 'GitHub',
    summary: 'Issues, pull requests, reviews and repository contents through the GitHub API.',
    fills: 'vcs',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requires: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
  },
  {
    id: 'sequential-thinking',
    label: 'Sequential thinking',
    summary: 'A scratchpad for long multi-step reasoning that can revise its own earlier steps.',
    fills: 'reasoning',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
]);

export function findCuratedServer(id: string): CuratedMcpServer | undefined {
  return CURATED_MCP_SERVERS.find((server) => server.id === id);
}

/** The stdio config for one curated server, in the shape the config file takes. */
export function curatedServerConfig(server: CuratedMcpServer): Record<string, unknown> {
  return {
    command: server.command,
    args: [...server.args],
    // Credentials are referenced, never copied: the MCP loader resolves
    // `${VAR}` from the environment and the encrypted store, and drops the
    // variable entirely when it is unset rather than sending an empty one.
    ...(server.requires?.length
      ? { env: Object.fromEntries(server.requires.map((name) => [name, `\${${name}}`])) }
      : {}),
  };
}

export interface CuratedInstallResult {
  readonly id: string;
  readonly replaced: boolean;
  readonly configFile: string;
  readonly unsetVariables: readonly string[];
}

/**
 * Add one curated server to the config.
 *
 * The key choice mirrors the plugin installer for the same reason: plif reads
 * whichever of `mcp` and `mcpServers` exists first and never merges the two, so
 * writing into the other one hides every server already configured.
 */
export async function installCuratedServer(
  server: CuratedMcpServer,
  configFile: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<CuratedInstallResult> {
  const current = await loadGlobalConfig(configFile);
  const key = current.mcp === undefined && current.mcpServers !== undefined ? 'mcpServers' : 'mcp';
  const existing =
    current[key] && typeof current[key] === 'object' && !Array.isArray(current[key])
      ? (current[key] as Record<string, unknown>)
      : {};

  await saveGlobalConfig(
    { ...current, [key]: { ...existing, [server.id]: curatedServerConfig(server) } },
    configFile,
  );

  return {
    id: server.id,
    replaced: server.id in existing,
    configFile,
    // Reported rather than blocking: a server whose token is missing still
    // starts, and saying which variable it wants is more useful than refusing.
    unsetVariables: (server.requires ?? []).filter((name) => !environment[name]?.trim()),
  };
}
