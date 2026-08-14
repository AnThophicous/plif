import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import { PlifError } from '../errors.js';

export type PermissionMode = 'ask' | 'auto-approve' | 'deny';

/**
 * A named agent, the way OpenCode declares one.
 *
 * `model` is the whole configuration most of the time: a ref like
 * `"opencode/longcat-2.0-free"` names the provider and the model together, so
 * pointing a subagent at a different model is one line and no other change.
 */
export interface AgentConfig {
  /** Provider-qualified model ref, e.g. "opencode/longcat-2.0-free". */
  readonly model?: string;
  /** Shown to the main agent so it can choose between them. */
  readonly description?: string;
  /** How many passes through the loop this agent gets. */
  readonly maxIterations?: number;
  readonly disable?: boolean;
}

export interface ProfileConfig {
  readonly model?: string;
  readonly name?: string;
  readonly systemPrompt: string;
}

export interface GlobalConfig {
  readonly $schema?: string;
  readonly autoApprove?: boolean;
  readonly permissionMode?: PermissionMode;
  /**
   * The main model, as a provider-qualified ref.
   *
   * `"opencode/deepseek-v4-flash-free"` is preferred and is what OpenCode
   * writes. The older split form — `preset` plus a bare `model` — still
   * resolves, because config files on disk outlive schema opinions.
   */
  readonly model?: string;
  /**
   * Named agents available for subagent spawning, keyed by name.
   *
   * The main agent is shown these and picks one per investigation. A cheap
   * free model for wide reading, an expensive one for the hard question, and
   * no code change to rearrange that.
   */
  readonly agent?: Readonly<Record<string, AgentConfig>>;
  readonly activeProfile?: string;
  /** Provider-qualified model chosen explicitly for future image delegation. */
  readonly visionModel?: string;
  /** Built-in id or the id of a ~/.plif/*.theme document. */
  readonly theme?: string;
  readonly profiles?: Readonly<Record<string, ProfileConfig>>;
  /** MCP servers. OpenCode's key; `mcpServers` is still read. */
  readonly mcp?: unknown;
  readonly mcpServers?: unknown;
  readonly baseURL?: string;
  readonly preset?: string;
  readonly apiKey?: string;
  readonly needKey?: boolean;
  readonly NeedKey?: boolean;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'ultracode' | 'plif';
  readonly providers?: unknown;
  /** OpenCode-style custom provider map. `providers` remains accepted. */
  readonly provider?: unknown;
  readonly models?: unknown;
  readonly context?: unknown;
  readonly [key: string]: unknown;
}

export function profilesOf(config: GlobalConfig): Record<string, ProfileConfig> {
  const profiles: Record<string, ProfileConfig> = {};
  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    if (!profile || typeof profile !== 'object' || typeof profile.systemPrompt !== 'string') continue;
    profiles[name] = profile;
  }
  return profiles;
}

export const CONFIG_SCHEMA_URL =
  'https://raw.githubusercontent.com/AnThophicous/plif/main/packages/core/schema/config.schema.json';

const CONFIG_SCHEMA_FILE = new URL('../../schema/config.schema.json', import.meta.url);

/**
 * MCP servers, from whichever key the file uses.
 *
 * `mcp` is OpenCode's name and the one to write; `mcpServers` is what plif
 * shipped with. Reading both costs one line and means nobody's working config
 * breaks to make a schema tidier.
 */
export function mcpServersOf(config: GlobalConfig): unknown {
  return config.mcp ?? config.mcpServers;
}

/**
 * The agents declared for subagent spawning, disabled ones removed.
 *
 * Returns an empty object rather than a default set. An agent list invented
 * here would be models the developer never chose and might be billed for.
 */
export function agentsOf(config: GlobalConfig): Record<string, AgentConfig> {
  const agents: Record<string, AgentConfig> = {};
  for (const [name, entry] of Object.entries(config.agent ?? {})) {
    if (!entry || typeof entry !== 'object' || entry.disable === true) continue;
    agents[name] = entry;
  }
  return agents;
}

export function globalConfigPath(home = os.homedir()): string {
  return path.join(home, '.plif', 'config.toml');
}

export function legacyGlobalConfigPath(home = os.homedir()): string {
  return path.join(home, '.config', 'PlifCode', 'config.jsonc');
}

/** JSON used by early Plif builds before personal configuration became TOML. */
export function legacyPlifConfigPath(home = os.homedir()): string {
  return path.join(home, '.plif', 'config.json');
}

export async function loadGlobalConfig(file = globalConfigPath()): Promise<GlobalConfig> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = parseConfig(raw, file);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('root must be an object');
    }
    return parsed as GlobalConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (path.resolve(file) !== path.resolve(globalConfigPath())) return {};
      return await migrateFirstLegacyGlobalConfig();
    }
    if (PlifError.is(error)) throw error;
    throw new PlifError('INVALID_ARGUMENT', 'global config.toml could not be parsed', {
      cause: error,
      detail: { file },
      hint: 'Fix the TOML, or remove the file to use defaults.',
    });
  }
}

export async function saveGlobalConfig(
  config: GlobalConfig,
  file = globalConfigPath(),
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const withSchema = config.$schema ? config : { $schema: CONFIG_SCHEMA_URL, ...config };
  // The canonical personal file is TOML. Keep an explicitly supplied legacy
  // .jsonc path round-trippable for marketplace imports and older callers;
  // production calls use ~/.plif/config.toml and never write JSON again.
  const serialized = path.extname(file).toLowerCase() === '.jsonc'
    ? JSON.stringify(withSchema, null, 2)
    : stringifyToml(withSchema as Record<string, unknown>) + '\n';
  await fs.writeFile(temporary, serialized, 'utf8');
  await fs.rename(temporary, file);
  await fs.chmod(file, 0o600).catch(() => undefined);
}

export async function configSchemaText(): Promise<string> {
  return await fs.readFile(CONFIG_SCHEMA_FILE, 'utf8');
}

export async function migrateLegacyGlobalConfig(
  target = globalConfigPath(),
  legacy = legacyGlobalConfigPath(),
): Promise<GlobalConfig> {
  try {
    const raw = await fs.readFile(legacy, 'utf8');
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('root must be an object');
    }
    const config = parsed as GlobalConfig;
    await saveGlobalConfig(config, target);
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new PlifError('INVALID_ARGUMENT', 'legacy global config.jsonc could not be parsed', {
      cause: error,
      detail: { file: legacy },
      hint: 'Fix the legacy JSONC before Plif can migrate it to ~/.plif/config.toml.',
    });
  }
}

async function migrateFirstLegacyGlobalConfig(): Promise<GlobalConfig> {
  const target = globalConfigPath();
  for (const legacy of [legacyGlobalConfigPath(), legacyPlifConfigPath()]) {
    try {
      await fs.access(legacy);
      return await migrateLegacyGlobalConfig(target, legacy);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return {};
}

function parseConfig(source: string, file: string): unknown {
  return path.extname(file).toLowerCase() === '.jsonc'
    ? JSON.parse(stripJsonComments(source))
    : parseToml(source);
}

export async function setAutoApprove(
  enabled: boolean,
  file = globalConfigPath(),
): Promise<GlobalConfig> {
  return await setPermissionMode(enabled ? 'auto-approve' : 'ask', file);
}

export function isAutoApproveEnabled(config: GlobalConfig): boolean {
  return permissionMode(config) === 'auto-approve';
}

export function permissionMode(config: GlobalConfig): PermissionMode {
  if (config.permissionMode) return config.permissionMode;
  return config.autoApprove === true ? 'auto-approve' : 'ask';
}

export async function setPermissionMode(
  mode: PermissionMode,
  file = globalConfigPath(),
): Promise<GlobalConfig> {
  const config = await loadGlobalConfig(file);
  const next = { ...config, permissionMode: mode, autoApprove: mode === 'auto-approve' };
  await saveGlobalConfig(next, file);
  return next;
}

/**
 * JSONC to JSON: comments and trailing commas removed, strings untouched.
 *
 * The trailing comma is dropped during the scan rather than by a pass over the
 * finished text. A regex cannot tell a value from a delimiter, so `"a, ]"` —
 * an ordinary argument in an MCP `args` array — was being rewritten to `"a]"`
 * with nothing to indicate the config had been altered.
 */
export function stripJsonComments(source: string): string {
  const out: string[] = [];
  let quoted = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let pendingComma: number | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] as string;
    const next = source[index + 1] as string | undefined;

    if (lineComment) {
      if (current === '\n' || current === '\r') {
        lineComment = false;
        out.push(current);
      }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (current === '\n' || current === '\r') {
        out.push(current);
      }
      continue;
    }
    if (quoted) {
      out.push(current);
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') quoted = false;
      continue;
    }
    if (current === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }

    if (current === '"') {
      quoted = true;
      pendingComma = null;
    } else if (current === ',') {
      pendingComma = out.length;
    } else if ((current === '}' || current === ']') && pendingComma !== null) {
      out[pendingComma] = '';
      pendingComma = null;
    } else if (current.trim()) {
      pendingComma = null;
    }
    out.push(current);
  }

  return out.join('');
}
