import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import { moduleDirectory, resolveAsset } from '../assets.js';
import { isPromptProfile, type PromptProfile } from '../agenting/types.js';
import { PlifError } from '../errors.js';
import { BUILTIN_AGENT_PRESETS } from './agent-presets.js';
import type { ConversationStateMode } from '../model/conversation-state.js';
import { withFileLock } from '../store/file-lock.js';

export type PermissionMode = 'ask' | 'auto-approve' | 'full' | 'deny';

export type ActivityHudMode = 'closed' | 'compact' | 'expanded';

export interface ActivityHudConfig {
  readonly mode?: ActivityHudMode;
}

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
  /** Optional role instructions applied only when this named agent runs. */
  readonly instructions?: string;
  /** How many passes through the loop this agent gets. */
  readonly maxIterations?: number;
  /** Explicit child effort; when absent, the engine derives one below the parent. */
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'ultracode' | 'plif';
  readonly disable?: boolean;
}

export interface PlifModeConfig {
  readonly reviewPasses?: 1 | 2 | 3;
  readonly adversarialReview?: boolean;
  readonly skillHarvest?: boolean;
  readonly maxReviewReminders?: number;
  readonly maxGoalRounds?: number;
  readonly runScriptMaxSteps?: number;
  readonly continuableSubagents?: boolean;
}

export interface ProfileConfig {
  readonly model?: string;
  readonly name?: string;
  /** Short human-readable purpose shown by `/persona list` and `/persona show`. */
  readonly description?: string;
  readonly systemPrompt: string;
}

export interface ComposerConfig {
  readonly autocomplete?: boolean;
  readonly language?: string;
  /** Legacy disk fields are accepted for config migration but ignored. */
  readonly spellcheck?: boolean;
  readonly autocorrect?: boolean;
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
  /** Default local projects folder used when PLIF starts outside a project. */
  readonly projectRoot?: string;
  /**
   * Named agents available for subagent spawning, keyed by name.
   *
   * The main agent is shown these and picks one per investigation. A cheap
   * free model for wide reading, an expensive one for the hard question, and
   * no code change to rearrange that.
   */
  readonly agent?: Readonly<Record<string, AgentConfig>>;
  /** Whether the primary agent may choose named agents without explicit user direction. */
  readonly agentAutoLaunch?: boolean;
  /**
   * Commands run at fixed points in the loop; see `harness/hooks.ts`.
   *
   * Kept as `unknown` here rather than typed: this interface is the shape of a
   * file a human edits, and `parseHooks` is where a malformed entry gets a
   * readable complaint instead of being silently coerced.
   */
  readonly hooks?: unknown;
  /**
   * Which instruction layer the system prompt is compiled from.
   *
   * "auto" picks by context window, which is what plif has always done.
   * "compact" uses the short layer at any context size and roughly halves the
   * fixed per-request cost; "full" forces the long one.
   */
  readonly promptProfile?: PromptProfile;
  readonly plif?: PlifModeConfig;
  /** Presentation preference for the runtime activity HUD. */
  readonly activityHud?: ActivityHudConfig;
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
  /** Legacy per-provider credentials; new CLI writes use CredentialBroker. */
  readonly providerKeys?: Readonly<Record<string, string>>;
  readonly needKey?: boolean;
  readonly NeedKey?: boolean;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /**
   * Token ceiling for one agent run, before the watchdog stops it.
   *
   * The stop exists so a looping agent cannot burn a budget unattended, and
   * the default is deliberately conservative. It is configurable because the
   * error raised on reaching the ceiling tells the operator to raise the run
   * budget — advice that needs somewhere to be acted on. Omitted means the
   * built-in default.
   */
  readonly maxRunTokens?: number;
  readonly timeoutMs?: number;
  /**
   * How the tool surface is presented to the model.
   *
   * `native` sends every tool schema on every request. `code` sends one —
   * `run_code` — and moves the catalogue into the cacheable system prefix,
   * where the model reaches tools by writing programs; that is a large token
   * saving on a wide tool surface and it needs a container able to spawn a
   * process. `both` ships both presentations and lets the model choose, which
   * costs the most and is mainly useful while comparing them.
   */
  readonly toolMode?: 'native' | 'code' | 'both';
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'ultracode' | 'plif';
  /** Opt-in Codex fast service tier; ignored by all other providers. */
  readonly codexFast?: boolean;
  /** Native continuation policy. Defaults to auto. */
  readonly conversationState?: ConversationStateMode;
  readonly composer?: ComposerConfig;
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

export function plifModeOf(config: GlobalConfig): PlifModeConfig {
  const value = (config as Record<string, unknown>)['plif'];
  if (!value || typeof value !== 'object') return {};
  return value as PlifModeConfig;
}

export function activityHudModeOf(config: GlobalConfig): ActivityHudMode {
  const mode = config.activityHud?.mode;
  return mode === 'closed' || mode === 'expanded' ? mode : 'compact';
}

export const CONFIG_SCHEMA_URL =
  'https://raw.githubusercontent.com/AnThophicous/plif/main/packages/core/schema/config.schema.toml';

/**
 * The schema shipped beside the compiled config module.
 *
 * Resolved rather than constructed as a URL so a bundled build, whose module
 * URL is the bundle's own path, still finds the copy placed next to it.
 */
function configSchemaFile(): string {
  const here = moduleDirectory(import.meta.url);
  const found = resolveAsset(import.meta.url, 'schema/config.schema.toml', [
    path.resolve(here, '../../schema/config.schema.toml'),
  ]);
  if (found === null) {
    throw new PlifError('INTERNAL', 'the plif config schema is missing from this install', {
      hint: 'Reinstall @plif/core.',
    });
  }
  return found;
}

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
 * The effective agents available for subagent spawning.
 *
 * Built-in roles are present by default and inherit the selected parent model.
 * A disable marker is an explicit opt-out, so a removed built-in does not
 * silently return on the next launch.
 */
export function agentsOf(config: GlobalConfig): Record<string, AgentConfig> {
  const agents: Record<string, AgentConfig> = {};
  for (const preset of BUILTIN_AGENT_PRESETS) {
    const configured = config.agent?.[preset.name];
    if (configured?.disable === true) continue;
    agents[preset.name] = configured
      ? {
          ...configured,
          description: configured.description ?? preset.description,
          instructions: configured.instructions ?? preset.instructions,
        }
      : {
          description: preset.description,
          instructions: preset.instructions,
        };
  }
  for (const [name, entry] of Object.entries(config.agent ?? {})) {
    if (!entry || typeof entry !== 'object' || entry.disable === true) continue;
    agents[name] = entry;
  }
  return agents;
}

export function globalConfigPath(home?: string): string {
  if (home === undefined) {
    const override = process.env['PLIF_CONFIG_PATH']?.trim();
    if (override) return path.resolve(override);
  }
  return path.join(home ?? os.homedir(), '.plif', 'config.toml');
}

export function legacyGlobalConfigPath(home = os.homedir()): string {
  return path.join(home, '.config', 'PlifCode', 'config.jsonc');
}

/** JSON used by early Plif builds before personal configuration became TOML. */
export function legacyPlifConfigPath(home = os.homedir()): string {
  return path.join(home, '.plif', 'config.json');
}

/** A legacy source parked until its credentials are durably in DPAPI. */
export function pendingLegacyGlobalConfigPath(legacy: string): string {
  return `${legacy}.pending-dpapi`;
}

/** Delete only legacy files that were already copied to canonical TOML. */
export async function removePendingLegacyGlobalConfigs(home = os.homedir()): Promise<void> {
  for (const legacy of [legacyGlobalConfigPath(home), legacyPlifConfigPath(home)]) {
    await fs.rm(pendingLegacyGlobalConfigPath(legacy), { force: true });
  }
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
      // An explicit path is normally used to isolate tests or automation. Do
      // not pull a legacy file out of the real home directory into it.
      if (process.env['PLIF_CONFIG_PATH']?.trim()) return {};
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
  options: { readonly preserveProviderKeys?: boolean } = {},
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await withFileLock(file, async () => {
    // Canonical writes never put model credentials back into config.toml. The
    // only exception is the one-time JSON/JSONC import below: it must preserve
    // the source long enough for startup to move every value into the encrypted
    // credential store. Ordinary callers cannot accidentally re-emit a secret
    // merely because they loaded a stale snapshot before changing another field.
    let nextConfig = withoutPlaintextModelCredentials(config);
    if (options.preserveProviderKeys === true) {
      let current: GlobalConfig = {};
      try {
        await fs.access(file);
        current = await loadGlobalConfig(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      nextConfig = mergeLegacyModelCredentials(current, config);
    }
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const withSchema = { ...nextConfig, $schema: CONFIG_SCHEMA_URL };
    // The canonical personal file is TOML. Keep an explicitly supplied legacy
    // .jsonc path round-trippable for marketplace imports and older callers;
    // production calls use ~/.plif/config.toml and never write JSON again.
    const serialized = path.extname(file).toLowerCase() === '.jsonc'
      ? JSON.stringify(withSchema, null, 2)
      : formatConfigToml(withSchema);
    try {
      await fs.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, file);
      await fs.chmod(file, 0o600).catch(() => undefined);
    } finally {
      // The import-only preserveProviderKeys path may briefly contain a
      // plaintext legacy credential. Never leave that temp copy behind when
      // a disk-full or rename failure interrupts the atomic replacement.
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  });
}

/** Remove every legacy location that can carry a model API key. */
function withoutPlaintextModelCredentials(config: GlobalConfig): GlobalConfig {
  const next: Record<string, unknown> = { ...config };
  delete next['apiKey'];
  delete next['providerKeys'];

  for (const field of ['providers', 'provider'] as const) {
    const providers = config[field];
    if (!providers || typeof providers !== 'object' || Array.isArray(providers)) continue;
    next[field] = Object.fromEntries(Object.entries(providers).map(([id, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [id, value];
      const entry = value as Record<string, unknown>;
      const options = entry['options'];
      if (!options || typeof options !== 'object' || Array.isArray(options)) return [id, value];
      const cleanOptions: Record<string, unknown> = { ...options as Record<string, unknown> };
      delete cleanOptions['apiKey'];
      return [id, { ...entry, options: cleanOptions }];
    }));
  }
  return next as GlobalConfig;
}

/**
 * Preserve legacy credentials only for an explicit import operation.
 *
 * Merging protects a credential already present in the destination when a
 * legacy caller writes a stale snapshot. This path is intentionally opt-in;
 * production mutations use the encrypted broker and the sanitizer above.
 */
function mergeLegacyModelCredentials(current: GlobalConfig, incoming: GlobalConfig): GlobalConfig {
  const next: Record<string, unknown> = { ...incoming };
  const currentKeys = asCredentialRecord(current.providerKeys);
  const incomingKeys = asCredentialRecord(incoming.providerKeys);
  const providerKeys = { ...currentKeys, ...incomingKeys };
  if (Object.keys(providerKeys).length > 0) next['providerKeys'] = providerKeys;
  if (typeof incoming.apiKey !== 'string' && typeof current.apiKey === 'string') {
    next['apiKey'] = current.apiKey;
  }

  for (const field of ['providers', 'provider'] as const) {
    const currentProviders = asObjectRecord(current[field]);
    const incomingProviders = asObjectRecord(incoming[field]);
    if (Object.keys(currentProviders).length === 0 && Object.keys(incomingProviders).length === 0) continue;
    const providers: Record<string, unknown> = { ...incomingProviders };
    for (const [id, currentValue] of Object.entries(currentProviders)) {
      const incomingValue = incomingProviders[id];
      if (!incomingValue || typeof incomingValue !== 'object' || Array.isArray(incomingValue)) {
        if (!(id in providers)) providers[id] = currentValue;
        continue;
      }
      if (!currentValue || typeof currentValue !== 'object' || Array.isArray(currentValue)) continue;
      const currentEntry = currentValue as Record<string, unknown>;
      const incomingEntry = incomingValue as Record<string, unknown>;
      const currentOptions = asObjectRecord(currentEntry['options']);
      const incomingOptions = asObjectRecord(incomingEntry['options']);
      if (typeof incomingOptions['apiKey'] !== 'string' && typeof currentOptions['apiKey'] === 'string') {
        providers[id] = {
          ...incomingEntry,
          options: { ...incomingOptions, apiKey: currentOptions['apiKey'] },
        };
      }
    }
    next[field] = providers;
  }
  return next as GlobalConfig;
}

function asCredentialRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, credential]) => typeof credential === 'string' && credential.trim()),
  ) as Record<string, string>;
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** Render configuration in the same format as the canonical config.toml. */
export function formatConfigToml(config: GlobalConfig): string {
  return stringifyToml(config as Record<string, unknown>) + '\n';
}

export async function configSchemaText(): Promise<string> {
  return await fs.readFile(configSchemaFile(), 'utf8');
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
    const pending = legacy.endsWith('.pending-dpapi')
      ? legacy
      : pendingLegacyGlobalConfigPath(legacy);
    if (pending !== legacy) await fs.rename(legacy, pending);
    // Keep credentials only during the format migration. Interactive startup
    // immediately moves them into the encrypted broker and rewrites clean TOML.
    await saveGlobalConfig(config, target, { preserveProviderKeys: true });
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
  const legacySources = [legacyGlobalConfigPath(), legacyPlifConfigPath()]
    .flatMap((legacy) => [legacy, pendingLegacyGlobalConfigPath(legacy)]);
  for (const legacy of legacySources) {
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
  const mode = permissionMode(config);
  return mode === 'auto-approve' || mode === 'full';
}

/**
 * Which tool presentation this session runs.
 *
 * The environment wins over the file because switching presentation is how you
 * measure one against the other, and a comparison you have to edit a config
 * file between runs to make is a comparison nobody makes. An unrecognised value
 * falls back to `native` rather than failing: the wrong presentation is a cost,
 * a refusal to start is an outage.
 */
/**
 * The prompt layer for this session.
 *
 * The environment wins over the file for the same reason it does for tool
 * mode: trying a cheaper prompt for one run should not mean editing config and
 * remembering to change it back.
 */
export function promptProfileOf(config: GlobalConfig): PromptProfile {
  const raw = (process.env['PLIF_PROMPT_PROFILE'] ?? config.promptProfile ?? '').trim().toLowerCase();
  return isPromptProfile(raw) ? raw : 'auto';
}

export function toolModeOf(config: GlobalConfig): 'native' | 'code' | 'both' {
  const raw = (process.env['PLIF_TOOLS_MODE'] ?? config.toolMode ?? '').trim().toLowerCase();
  return raw === 'code' || raw === 'both' || raw === 'native' ? raw : 'native';
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
  const next = { ...config, permissionMode: mode, autoApprove: mode === 'auto-approve' || mode === 'full' };
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
