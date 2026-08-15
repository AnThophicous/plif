/**
 * Slash commands.
 *
 * Held in one table rather than a switch so that `/help` is generated from the
 * same source that dispatches — a help text that can drift from behaviour is
 * worse than none, because it is confidently wrong.
 *
 * Commands return timeline entries; they never render. That keeps them testable
 * without a terminal and keeps all layout decisions inside components.
 */

import path from 'node:path';

import {
  CredentialBroker,
  credentialVariableForProvider,
  MODEL_CATALOG,
  discoverProviderModels,
  modelVisionBadge,
  rankFacts,
  rankModelIds,
  supportedEfforts,
  strategyStatus,
  userCatalog,
  visionCandidates,
} from '@plif/core';
import type {
  Container,
  Effort,
  Engine,
  ModelCatalogProvider,
  ModelCatalogModel,
  ModelProvider,
  ModelSelection,
  StoredConfig,
} from '@plif/core';
import {
  globalConfigPath,
  isAutoApproveEnabled,
  loadGlobalConfig,
  permissionMode,
  setAutoApprove,
  setPermissionMode,
  saveGlobalConfig,
  profilesOf,
  PlifError,
} from '@plif/core';

import { formatCapabilities } from './format.js';
import { effortLabel, effortPickerItems } from './components/Picker.js';
import { formatStatus } from './status.js';
import type { StatusInput } from './status.js';
import type { PickerGroup, PickerItem } from './components/Picker.js';

import { entry } from './session.js';
import type { BrowserTab, TimelineEntry } from './session.js';
import { formatBytes, formatDuration, glyph, shortenPath } from './theme.js';
import { containerMount, containerWorkdir } from './container-paths.js';
import type { ThemeDefinition } from './themes.js';

export interface CommandContext {
  readonly engine: Engine;
  /** The container input is currently aimed at, if any. */
  readonly current: Container | null;
  readonly setCurrent: (container: Container | null) => void;
  readonly clear: () => void;
  readonly exit: () => void;
  readonly cwd: string;
  readonly model: ModelProvider | null;
  readonly modelProblem: string | null;
  readonly switchModel: (selection: ModelSelection | string) => Promise<void>;
  readonly credentials?: CredentialBroker;
  readonly setEffort: (effort: Effort | undefined) => Promise<void>;
  readonly supportedEfforts?: () => readonly Effort[];
  /** Enter or leave the read-only planning mode. */
  readonly setPlanMode?: (enabled: boolean, description?: string) => Promise<void>;
  /** Start a session-scoped completion condition. */
  readonly startGoal?: (condition: string) => Promise<void>;
  readonly goalStatus?: () => { readonly condition: string; readonly status: 'active' } | null;
  readonly clearGoal?: () => void;
  readonly switchProfile: (name: string) => Promise<void>;
  /**
   * Shrink the conversation now, rather than waiting for the threshold.
   *
   * Resolves to what it did, so the command can report it. The conversation
   * itself lives in the app — commands never hold it — which is why this is a
   * callback rather than something `/compact` could do on its own.
   */
  readonly compactNow: (aggressive: boolean) => Promise<{ before: number; after: number }>;
  /** Open the MCP & skills browser on a given tab. */
  readonly openBrowser: (tab: BrowserTab) => void;
  /** Authenticate one MCP server by name, reporting what happened. */
  readonly loginMcp: (server: string) => Promise<TimelineEntry>;
  /** The MCP servers this session knows about, for naming them back. */
  readonly mcpNames: readonly string[];
  /** Pull an image off the clipboard and attach it to the line being typed. */
  readonly pasteImage: () => Promise<void>;
  readonly openPicker: (picker: FlatPickerRequest | CatalogPickerRequest) => void;
  readonly copySession?: () => Promise<void>;
  readonly saveSession?: () => Promise<void>;
  readonly themes: readonly ThemeDefinition[];
  readonly switchTheme: (id: string) => Promise<void>;
  readonly sessionStatus?: () => StatusInput;
}

export interface FlatPickerRequest {
  readonly title: string;
  readonly hint?: string;
  readonly items: readonly PickerItem[];
  readonly onPick: (value: string | ModelSelection) => void;
}

export interface CatalogPickerRequest {
  readonly title: string;
  readonly hint?: string;
  readonly groups: readonly PickerGroup[];
  readonly expanded: readonly string[];
  readonly selected: number;
  readonly onPick: (selection: string | ModelSelection) => void;
}

export interface CommandResult {
  readonly entries: readonly TimelineEntry[];
}

export interface Command {
  readonly name: string;
  readonly args?: string;
  readonly summary: string;
  readonly concurrent?: boolean;
  readonly run: (argv: readonly string[], context: CommandContext) => Promise<CommandResult>;
}

export function runsWhileWorking(name: string): boolean {
  return findCommand(name)?.concurrent === true;
}

const ok = (...entries: TimelineEntry[]): CommandResult => ({ entries });

const formatTokens = (value: number): string =>
  value < 1000 ? `${value} tokens` : `${(value / 1000).toFixed(1)}k tokens`;

/** Keep verified built-ins visible while adding everything the endpoint reports. */
export function providerModelIds(
  catalog: ModelCatalogProvider,
  discoveredIds: readonly string[],
  live: boolean,
): string[] {
  if (!live) return catalog.models.map((item) => item.id);
  return [...new Set([
    ...catalog.models.map((item) => item.id),
    ...discoveredIds,
  ])];
}

/** Built-ins hidden by a user provider with the same id. */
export function builtInPickerProviders(
  custom: readonly ModelCatalogProvider[],
  builtins: readonly ModelCatalogProvider[] = MODEL_CATALOG,
): readonly ModelCatalogProvider[] {
  const customIds = new Set(custom.map((provider) => provider.id));
  return builtins.filter((provider) => !customIds.has(provider.id));
}

function pickerBadges(
  candidate: ModelCatalogModel | undefined,
  hasVisionHelper: boolean,
): readonly string[] {
  if (!candidate) return [];
  const vision = modelVisionBadge(candidate, hasVisionHelper);
  return vision ? [...new Set([...candidate.badges, vision])] : candidate.badges;
}

/**
 * One provider, as a picker group.
 *
 * Asks the endpoint what it serves and shows that; the curated list is the
 * fallback, not the source. Discovery declines instantly when no credential is
 * available, so opening the picker costs a round trip only for the providers
 * the developer has actually signed in to.
 */
async function providerGroup(
  catalog: ModelCatalogProvider,
  section: string,
  currentModel: string | undefined,
  stored: StoredConfig,
  credentials: CredentialBroker | undefined,
): Promise<PickerGroup> {
  const variable = credentialVariableForProvider(catalog.id, stored);
  const key = credentials
    ? await credentials.lookup(variable) ?? (
        variable === 'PLIF_API_KEY' ? undefined : await credentials.lookup('PLIF_API_KEY')
      )
    : undefined;
  const discovered = await discoverProviderModels(catalog.id, {
    stored,
    ...(key ? { apiKey: key } : {}),
  });

  const known = new Map(catalog.models.map((item) => [item.id, item]));
  const hasVisionHelper = visionCandidates(stored).length > 0;
  const ids = rankModelIds(catalog.id, providerModelIds(catalog, discovered.ids, discovered.live));
  const items: PickerItem[] = discovered.live
    ? ids.map((id) => {
        const curated = known.get(id);
        return {
          value: id,
          label: curated?.label ?? prettyModelId(id),
          detail: curated?.description ?? id,
          badges: pickerBadges(curated, hasVisionHelper),
          current: id === currentModel,
        };
      })
    : catalog.models.map((item) => ({
        value: item.id,
        label: item.label,
        detail: item.description,
        badges: pickerBadges(item, hasVisionHelper),
        current: item.id === currentModel,
      }));

  return {
    id: catalog.id,
    label: catalog.label,
    section,
    detail: discovered.live ? `${catalog.description} · live` : catalog.description,
    items,
  };
}

/** `moonshotai/kimi-k2-instruct` reads better as `kimi k2 instruct`. */
function prettyModelId(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1).replace(/[-_]+/g, ' ');
}

/** Keep several provider catalogues moving without creating one unbounded wave. */
async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await work(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return result;
}

export const COMMANDS: readonly Command[] = [
  {
    name: 'theme',
    concurrent: true,
    summary: 'Choose a built-in or ~/.plif/*.theme appearance',
    run: async (_argv, context) => {
      const stored = await loadGlobalConfig();
      context.openPicker({
        title: 'Choose a theme',
        items: context.themes.map((theme) => ({
          value: theme.id,
          label: theme.name,
          detail: theme.description ?? (theme.source === 'user' ? '~/.plif' : 'built in'),
          current: (stored.theme ?? 'minimal') === theme.id,
        })),
        onPick: (value) => { void context.switchTheme(String(value)); },
      });
      return ok();
    },
  },
  {
    name: 'compact',
    args: '[hard]',
    summary: 'Summarise the conversation so far and free up context',
    /**
     * Compaction on demand.
     *
     * The loop compacts on its own at the threshold, so this is not about
     * necessity — it is about timing. Compaction costs a model call over the
     * whole transcript, and having it fire in the middle of a task, unasked,
     * is exactly when a developer least wants to wait for it. Doing it between
     * tasks, when the last thing finished and the next has not started, is
     * free in every way that matters.
     *
     * `hard` targets a third of the window instead of the usual seventy
     * percent, for when the next task is a large one.
     */
    run: async (argv, context) => {
      const aggressive = argv[0] === 'hard';
      const { before, after } = await context.compactNow(aggressive);
      if (before === after) {
        return ok(
          entry('notice', 'nothing to compact', {
            tone: 'muted',
            subtitle: `the conversation is ${formatTokens(before)} and already lean`,
          }),
        );
      }
      return ok(
        entry('notice', `compacted ${formatTokens(before)} → ${formatTokens(after)}`, {
          tone: 'accent',
          subtitle: `${Math.round((1 - after / Math.max(1, before)) * 100)}% of the context freed`,
        }),
      );
    },
  },
  {
    name: 'mcp',
    concurrent: true,
    args: '[<server> login]',
    summary: 'Browse MCP servers, skills, and the Claude plugin marketplace',
    /**
     * Both word orders are accepted. `/mcp github login` reads as a sentence
     * and `/mcp login github` is the shape every other CLI uses; guessing
     * wrong should not cost a round trip to the help text.
     */
    run: async (argv, context) => {
      const words = argv.map((word) => word.trim()).filter(Boolean);
      const verb = words.findIndex((word) => word.toLowerCase() === 'login');

      if (verb === -1) {
        if (words.length === 0) {
          context.openBrowser('mcp');
          return ok();
        }
        return ok(
          entry('notice', `/mcp does not know "${words.join(' ')}"`, {
            tone: 'warn',
            subtitle: '/mcp to browse · /mcp <server> login to authenticate one',
          }),
        );
      }

      const server = words.filter((_, index) => index !== verb).join(' ');
      if (!server) {
        return ok(
          entry('notice', 'name a server to log in to', {
            tone: 'warn',
            subtitle: context.mcpNames.length
              ? `known: ${context.mcpNames.join(', ')}`
              : 'no MCP servers are configured',
          }),
        );
      }

      return ok(await context.loginMcp(server));
    },
  },
  {
    name: 'memory',
    concurrent: true,
    args: '[forget]',
    summary: 'What Plif remembers about this workspace, and how to drop it',
    /**
     * Memory the developer cannot read is memory they cannot trust.
     *
     * The store is already consulted on every turn and already survives
     * restarts; what it lacked was a way to see what it had decided. A wrong
     * fact that keeps steering the agent is invisible until you can list it,
     * and then it is one command to clear.
     */
    run: async (argv, context) => {
      const workspace = context.cwd;
      const verb = argv.map((word) => word.trim().toLowerCase()).filter(Boolean)[0];

      if (verb === 'forget') {
        await context.engine.memory.forget(workspace);
        return ok(
          entry('notice', 'memory for this workspace is gone', {
            tone: 'accent',
            subtitle: 'facts, failures, strategies and notes',
          }),
        );
      }

      if (verb) {
        return ok(
          entry('notice', `/memory does not know "${verb}"`, {
            tone: 'warn',
            subtitle: '/memory to read it · /memory forget to drop it',
          }),
        );
      }

      const snapshot = await context.engine.memory.snapshot(workspace);
      const lines: string[] = [];
      const section = (title: string, rows: readonly string[]): void => {
        if (rows.length === 0) return;
        lines.push(lines.length ? `\n${title}` : title, ...rows);
      };

      section(
        'Facts',
        rankFacts(snapshot.facts, 20).map(
          (fact) =>
            `  ${fact.text}${fact.confirmations > 1 ? `  (seen ${fact.confirmations}x)` : ''}`,
        ),
      );
      section('Known not to work', rankFacts(snapshot.failures, 20).map((fact) => `  ${fact.text}`));
      section(
        'Strategies',
        snapshot.strategies.slice(-10).map((strategy) => `  ${strategy.approach} — ${strategyStatus(strategy)}`),
      );
      const notes = snapshot.notes.trim();
      if (notes) section('Notes', notes.split('\n').map((line) => `  ${line}`));

      if (lines.length === 0) {
        return ok(
          entry('notice', 'nothing remembered about this workspace yet', {
            tone: 'muted',
            subtitle: 'it fills in as the agent works here',
          }),
        );
      }

      return ok(
        entry('notice', `memory for ${shortenPath(workspace, 48)}`, {
          tone: 'accent',
          subtitle: `${snapshot.facts.length} facts · ${snapshot.failures.length} failures · ${snapshot.strategies.length} strategies`,
          detail: lines.join('\n'),
          expand: true,
        }),
      );
    },
  },
  {
    name: 'skills',
    concurrent: true,
    summary: 'The same browser, opened on the skills tab',
    /**
     * Two names for one screen, on purpose.
     *
     * Someone looking for a skill and someone looking for an MCP server are
     * doing the same thing — finding a capability to add — and they are found
     * in the same catalogue. Two separate half-screens would mean discovering
     * each list twice and learning two sets of keys.
     */
    run: async (_argv, context) => {
      context.openBrowser('skills');
      return ok();
    },
  },
  {
    name: 'marketplace',
    concurrent: true,
    summary: 'Open the browser straight on the Claude plugin catalogue',
    run: async (_argv, context) => {
      context.openBrowser('marketplace');
      return ok();
    },
  },
  {
    name: 'paste',
    concurrent: true,
    summary: 'Attach the image currently on the clipboard',
    /**
     * The same thing Ctrl+V does, for terminals that keep Ctrl+V to themselves.
     *
     * Windows Terminal binds it to its own paste, which sends the clipboard's
     * *text* — so when the clipboard holds only an image, nothing arrives and
     * the keystroke appears to do nothing at all. A command cannot be
     * intercepted, so this is the path that always works.
     */
    run: async (_argv, context) => {
      await context.pasteImage();
      return ok();
    },
  },
  {
    name: 'status',
    concurrent: true,
    summary: 'Show the model, the context window and everything this session has used',
    run: async (_argv, context) => {
      const read = context.sessionStatus;
      if (!read) {
        throw new PlifError('INVALID_ARGUMENT', 'status is only available in an interactive session');
      }
      const snapshot = read();
      const config = await loadGlobalConfig();
      return ok(
        entry('notice', 'status', {
          tone: 'accent',
          subtitle: snapshot.model || 'no model configured',
          detail: formatStatus({
            ...snapshot,
            permission: permissionMode(config),
            autoApprove: isAutoApproveEnabled(config),
          }),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'help',
    concurrent: true,
    summary: 'List every command',
    run: async () => {
      // Column width comes from the longest *name*, not name+args. Including
      // args pushes the column past the terminal width and the summaries
      // collide with them; args get their own indented line instead.
      const nameWidth = Math.max(...COMMANDS.map((command) => command.name.length)) + 3;
      const lines: string[] = [];

      for (const command of COMMANDS) {
        lines.push(`/${command.name}`.padEnd(nameWidth) + command.summary);
        if (command.args) lines.push(' '.repeat(nameWidth) + command.args);
      }

      return ok(
        entry('notice', 'commands', {
          tone: 'accent',
          detail: lines.join('\n'),
          expand: true,
        }),
        entry('notice', 'Anything not starting with / runs as a command in the active container.', {
          tone: 'muted',
        }),
      );
    },
  },

  {
    name: 'new',
    args: '[image] [--name n] [--mount host:target[:ro|rw]]',
    summary: 'Create and start a container',
    run: async (argv, context) => {
      const flags = parseFlags(argv);
      const image = flags.positional[0] ?? (await context.engine.ensureBaseImage()).reference;
      const mounts = (flags.repeated['mount'] ?? []).length > 0
        ? (flags.repeated['mount'] ?? []).map(parseMount)
        : [containerMount(context.cwd)];

      const container = await context.engine.run({
        image,
        mounts,
        ...(flags.values['name'] ? { name: flags.values['name'] } : {}),
        // A mount asked for rw is pointless without the capability to use it,
        // so grant it implicitly rather than making the user say it twice.
        ...(mounts.some((mount) => mount.mode === 'rw')
          ? { capabilities: { hostWrite: true } }
          : {}),
        ...((flags.repeated['mount'] ?? []).length === 0
          ? { workdir: containerWorkdir(context.cwd) }
          : {}),
      });
      context.setCurrent(container);

      return ok(
        entry('step', `container ${container.name}`, {
          subtitle: `${image} · ${container.id}`,
          status: 'done',
          tag: '[running]',
          detail:
            formatCapabilities(container.capabilities) +
            (mounts.length
              ? '\n' + mounts.map((m) => `mount  ${m.source} -> ${m.target} (${m.mode})`).join('\n')
              : ''),
        }),
      );
    },
  },

  {
    name: 'ps',
    concurrent: true,
    summary: 'List containers',
    run: async (_argv, context) => {
      const containers = context.engine.list();
      if (containers.length === 0) {
        return ok(entry('notice', 'No containers. Run /new to create one.', { tone: 'muted' }));
      }
      return ok(
        entry('notice', 'containers', {
          tone: 'accent',
          detail: containers
            .map((container) => {
              const status = container.status();
              const marker = container.name === context.current?.name ? glyph.caret : ' ';
              return [
                `${marker} ${container.name.padEnd(18)}`,
                container.id.slice(0, 8).padEnd(10),
                status.state.padEnd(9),
                `${status.usage.execCount} execs`.padEnd(10),
                formatBytes(status.usage.peakMemoryBytes),
              ].join(' ');
            })
            .join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'use',
    args: '<container>',
    summary: 'Aim input at a container',
    run: async (argv, context) => {
      const ref = argv[0];
      if (!ref) throw new PlifError('INVALID_ARGUMENT', 'usage: /use <container>');
      const container = context.engine.require(ref);
      context.setCurrent(container);
      return ok(entry('notice', `now targeting ${container.name}`, { tone: 'accent' }));
    },
  },

  {
    name: 'stop',
    args: '[container]',
    summary: 'Stop a container and reap its process tree',
    run: async (argv, context) => {
      const container = resolveTarget(argv[0], context);
      await container.stop('stopped from the CLI');
      const usage = container.status().usage;
      return ok(
        entry('step', `stopped ${container.name}`, {
          status: 'done',
          subtitle: `${usage.execCount} execs · ${formatBytes(usage.peakMemoryBytes)} peak · ${formatDuration(usage.cpuMillis)} cpu`,
        }),
      );
    },
  },

  {
    name: 'rm',
    args: '[container]',
    summary: 'Remove a container and discard its layer',
    run: async (argv, context) => {
      const container = resolveTarget(argv[0], context);
      const name = container.name;
      await context.engine.remove(container.id);
      if (context.current?.id === container.id) context.setCurrent(null);
      return ok(entry('step', `removed ${name}`, { status: 'done', tone: 'muted' }));
    },
  },

  {
    name: 'commit',
    args: '<layer-name> [container]',
    summary: 'Snapshot the container workspace into a layer',
    run: async (argv, context) => {
      const name = argv[0];
      if (!name) throw new PlifError('INVALID_ARGUMENT', 'usage: /commit <layer-name>');
      const container = resolveTarget(argv[1], context);
      const layer = await container.commit(name);
      return ok(
        entry('step', `committed ${name}`, {
          status: 'done',
          subtitle: `${layer.digest.slice(0, 12)} · ${layer.entries.length} entries · ${formatBytes(layer.size)}`,
        }),
      );
    },
  },

  {
    name: 'build',
    args: '<reference> <directory>',
    summary: 'Build an image from a host directory',
    run: async (argv, context) => {
      const [reference, source] = argv;
      if (!reference || !source) {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /build <reference> <directory>');
      }
      const image = await context.engine.buildImage({
        reference,
        source: path.resolve(context.cwd, source),
      });
      return ok(
        entry('step', `built ${image.reference}`, {
          status: 'done',
          subtitle: `${image.digest.slice(0, 12)} · ${image.layers.length} layers`,
        }),
      );
    },
  },

  {
    name: 'images',
    concurrent: true,
    summary: 'List images in the store',
    run: async (_argv, context) => {
      const images = await context.engine.images.list();
      if (images.length === 0) {
        return ok(entry('notice', 'No images yet. Run /build to make one.', { tone: 'muted' }));
      }
      return ok(
        entry('notice', 'images', {
          tone: 'accent',
          detail: images
            .map(
              (image) =>
                `${image.reference.padEnd(28)} ${image.digest.slice(0, 12)}  ${image.layers.length} layers`,
            )
            .join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'store',
    concurrent: true,
    summary: 'Show what the content store is holding',
    run: async (_argv, context) => {
      const { blobs, bytes } = await context.engine.content.size();
      const layers = await context.engine.layers.list();
      const logical = layers.reduce((total, layer) => total + layer.size, 0);
      const saved = Math.max(0, logical - bytes);
      return ok(
        entry('notice', 'content store', {
          tone: 'accent',
          detail: [
            `blobs      ${blobs}`,
            `on disk    ${formatBytes(bytes)}`,
            `logical    ${formatBytes(logical)} across ${layers.length} layers`,
            `saved      ${formatBytes(saved)} by deduplication`,
          ].join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'model',
    concurrent: true,
    args: '[id]',
    summary: 'Show the model, or pick a different one',
    run: async (argv, context) => {
      if (argv[0]) {
        await context.switchModel(argv[0]);
        return ok(entry('notice', `switched to ${argv[0]}`, { tone: 'accent' }));
      }

      // Opening the catalog is deliberately independent of the global config:
      // a malformed config or missing key must not hide the model chooser.
      const currentModel = context.model?.info.id;
      const stored = (await loadGlobalConfig().catch(() => ({}))) as StoredConfig;

      // The developer's own providers come first, and under their own heading.
      // Somebody who wrote an endpoint into their config should find it at the
      // top, not somewhere inside a list of things Plif happens to ship.
      const mine = userCatalog(stored);
      const providers = [
        ...mine.map((entryProvider) => ({ entryProvider, section: 'your providers' })),
        ...builtInPickerProviders(mine).map((entryProvider) => ({ entryProvider, section: 'built into PLIF' })),
      ];
      const groups: PickerGroup[] = await mapWithConcurrency(providers, 3, ({ entryProvider, section }) =>
        providerGroup(entryProvider, section, currentModel, stored, context.credentials),
      );

      const currentGroup = groups.find((group) =>
        group.items.some((item) => item.current),
      );
      const expanded = currentGroup ? [currentGroup.id] : [];

      context.openPicker({
        title: 'select a provider and model',
        hint: '[vision] reads images directly · [vision helper] delegates through inspect_image',
        groups,
        expanded,
        selected: Math.max(0, groups.findIndex((group) => group.id === currentGroup?.id)),
        onPick: (selection) => {
          if (typeof selection !== 'string') void context.switchModel(selection);
        },
      });
      return ok();
    },
  },

  {
    name: 'effort',
    concurrent: true,
    args: '[low|medium|high|xhigh|max|ultra|ultracode|plif|default]',
    summary: 'Show or change model reasoning effort',
    run: async (argv, context) => {
      const stored = await loadGlobalConfig();
      const current = stored.effort ?? 'default';
      const value = argv[0];
      if (!value) {
        context.openPicker({
          title: `Select effort · ${context.model?.info.id ?? 'current model'}`,
          items: [
            { value: 'default', label: 'Default', detail: 'let the provider choose', current: current === 'default' },
            ...effortPickerItems(context.supportedEfforts?.() ?? [], current === 'default' ? undefined : current as Effort),
          ],
          selected: Math.max(0, (context.supportedEfforts?.() ?? []).indexOf(current as Effort)),
          onPick: async (picked) => {
            await context.setEffort(picked === 'default' ? undefined : picked as Effort);
          },
        });
        return ok(entry('notice', 'select reasoning effort', { tone: 'accent', subtitle: `current: ${effortLabel(current)}` }));
      }
      if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode', 'plif', 'default'].includes(value)) {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /effort [low|medium|high|xhigh|max|ultra|ultracode|plif|default]');
      }
      if (value !== 'default' && context.supportedEfforts && !context.supportedEfforts().includes(value as Effort)) {
        throw new PlifError('INVALID_ARGUMENT', `${value} is not supported by the selected model`);
      }
      await context.setEffort(value === 'default' ? undefined : value as Effort);
      return ok(entry('notice', `effort: ${effortLabel(value)}`, {
        tone: 'accent',
        subtitle: 'conversation reset for the new model settings',
      }));
    },
  },

  {
    name: 'plan',
    args: '[description|off]',
    summary: 'Enter read-only planning mode, or leave it',
    run: async (argv, context) => {
      if (!context.setPlanMode) {
        return ok(entry('notice', 'plan mode is unavailable in this session', { tone: 'warn' }));
      }
      const value = argv.join(' ').trim();
      const command = value.toLowerCase();
      if (command === 'off' || command === 'clear' || command === 'execute' || command === 'work') {
        await context.setPlanMode(false);
        return ok(entry('notice', 'plan mode off', {
          tone: 'accent',
          subtitle: 'the next agent turn may make workspace changes',
        }));
      }
      await context.setPlanMode(true, value || undefined);
      return ok(entry('notice', 'plan mode on', {
        tone: 'accent',
        subtitle: value
          ? 'the plan request was sent without write tools'
          : 'inspect files and propose a plan; use /plan off to resume work',
      }));
    },
  },

  {
    name: 'goal',
    args: '[condition|clear]',
    summary: 'Work until a verifiable completion condition is met',
    run: async (argv, context) => {
      if (!context.goalStatus || !context.startGoal || !context.clearGoal) {
        return ok(entry('notice', 'goals are unavailable in this session', { tone: 'warn' }));
      }
      const value = argv.join(' ').trim();
      const command = value.toLowerCase();
      if (!value) {
        const goal = context.goalStatus();
        return ok(entry('notice', goal
          ? `goal ${goal.status}: ${goal.condition}`
          : 'no active goal', {
            tone: goal ? 'accent' : 'muted',
          }));
      }
      if (command === 'clear' || command === 'off' || command === 'reset') {
        context.clearGoal();
        return ok(entry('notice', 'goal cleared', { tone: 'accent' }));
      }
      if (value.length > 2000) {
        throw new PlifError('INVALID_ARGUMENT', 'goal condition must be 2000 characters or fewer');
      }
      await context.startGoal(value);
      return ok(entry('notice', 'goal active', {
        tone: 'accent',
        subtitle: value,
      }));
    },
  },

  {
    name: 'export',
    concurrent: true,
    args: '[clipboard|file]',
    summary: 'Copy or save the complete session transcript',
    run: async (argv, context) => {
      if (!context.copySession || !context.saveSession) {
        return ok(entry('notice', 'session export is unavailable', { tone: 'warn' }));
      }
      const choice = argv[0]?.toLowerCase();
      if (choice === 'clipboard' || choice === 'copy') {
        await context.copySession();
        return ok();
      }
      if (choice === 'file' || choice === 'save') {
        await context.saveSession();
        return ok();
      }
      context.openPicker({
        title: 'export session',
        items: [
          { value: 'clipboard', label: 'Copy to clipboard', detail: 'the full transcript' },
          { value: 'file', label: 'Save .txt in project', detail: 'creates a new file in the workspace' },
        ],
        selected: 0,
        onPick: (value) => {
          void (value === 'clipboard' ? context.copySession!() : context.saveSession!());
        },
      });
      return ok(entry('notice', 'export session', {
        tone: 'accent',
        subtitle: 'choose copy to clipboard or save a .txt in the project',
      }));
    },
  },

  {
    name: 'sandbox',
    concurrent: true,
    summary: 'Show exactly what the sandbox enforces',
    run: async (_argv, context) => {
      const report = context.engine.sandboxReport;
      const flags = [
        ['kill process tree', report.killProcessTree],
        ['memory ceiling', report.memoryLimit],
        ['process ceiling', report.processLimit],
        ['cpu throttle', report.cpuLimit],
        ['fs write block', report.filesystemWriteBlock],
        ['network block', report.networkBlock],
        ['accounting', report.accounting],
      ] as const;

      return ok(
        entry('notice', `sandbox: ${report.backend} (${report.isolation})`, {
          tone: report.isolation === 'none' ? 'danger' : 'accent',
          detail: [
            ...flags.map(([label, on]) => `${on ? glyph.done : glyph.failed} ${label}`),
            '',
            `output decoded as ${report.textEncoding}`,
            ...(report.degradations.length
              ? ['', ...report.degradations.map((note) => `! ${note}`)]
              : []),
          ].join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'policy',
    concurrent: true,
    summary: 'Show the active policy rules',
    run: async (_argv, context) => {
      const document = context.engine.policy.document;
      return ok(
        entry('notice', `policy: trust=${document.trust} fallback=${document.fallback}`, {
          tone: 'accent',
          detail: [
            ...document.rules.map(
              (rule) =>
                `${rule.decision.padEnd(6)} ${rule.name.padEnd(24)} ${
                  rule.match ?? rule.argvPattern ?? '*'
                }`,
            ),
            '',
            `network allowlist: ${
              document.networkAllowlist.length ? document.networkAllowlist.join(', ') : '(empty)'
            }`,
          ].join('\n'),
          expand: true,
        }),
      );
    },
  },

  {
    name: 'config',
    concurrent: true,
    args: 'auto-approve [on|off|show]',
    summary: 'Show or change global Plif configuration',
    run: async (argv, context) => {
      const config = await loadGlobalConfig();
      const action = argv[0] === 'auto-approve' ? (argv[1] ?? 'show') : (argv[0] ?? 'show');
      if (action === 'show') {
        return ok(entry('notice', `auto approve: ${isAutoApproveEnabled(config) ? 'on' : 'off'}`, {
          tone: 'accent',
          subtitle: globalConfigPath(),
        }));
      }
      if (action !== 'on' && action !== 'off') {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /config auto-approve [on|off|show]');
      }
      const next = await setAutoApprove(action === 'on');
      context.engine.approvals.setAutoApprove(isAutoApproveEnabled(next));
      return ok(entry('notice', `auto approve: ${action}`, {
        tone: action === 'on' ? 'warn' : 'accent',
        subtitle: globalConfigPath(),
      }));
    },
  },

  {
    name: 'permission',
    concurrent: true,
    args: '[ask|auto-approve|deny]',
    summary: 'Show or set the global approval mode',
    run: async (argv, context) => {
      const current = await loadGlobalConfig();
      const mode = argv[0];
      if (!mode) {
        return ok(entry('notice', `permission: ${permissionMode(current)}`, {
          tone: 'accent',
          subtitle: globalConfigPath(),
        }));
      }
      if (mode !== 'ask' && mode !== 'auto-approve' && mode !== 'deny') {
        throw new PlifError('INVALID_ARGUMENT', 'usage: /permission [ask|auto-approve|deny]');
      }
      const next = await setPermissionMode(mode);
      context.engine.approvals.setPermissionMode(permissionMode(next));
      return ok(entry('notice', `permission: ${mode}`, {
        tone: mode === 'auto-approve' ? 'warn' : mode === 'deny' ? 'danger' : 'accent',
        subtitle: globalConfigPath(),
      }));
    },
  },

  {
    name: 'agent',
    args: 'list | add <name> <model> [description] | remove <name>',
    summary: 'Manage persistent named subagents',
    run: async (argv) => {
      const config = await loadGlobalConfig();
      const action = argv[0] ?? 'list';
      const agents = { ...(config.agent ?? {}) };
      if (action === 'list') {
        const names = Object.entries(agents).map(([name, agent]) =>
          `${name} → ${agent.model ?? '(parent model)'}${agent.description ? ` — ${agent.description}` : ''}`,
        );
        return ok(entry('notice', names.length ? names.join('\n') : 'no named agents configured', {
          tone: 'accent', subtitle: globalConfigPath(), expand: names.length > 0,
        }));
      }
      if (action === 'add') {
        const name = argv[1]?.trim();
        const model = argv[2]?.trim();
        if (!name || !model) throw new PlifError('INVALID_ARGUMENT', 'usage: /agent add <name> <model> [description]');
        agents[name] = { model, ...(argv.slice(3).join(' ').trim() ? { description: argv.slice(3).join(' ').trim() } : {}) };
        await saveGlobalConfig({ ...config, agent: agents });
        return ok(entry('notice', `agent ${name} saved`, { tone: 'success', subtitle: globalConfigPath() }));
      }
      if (action === 'remove') {
        const name = argv[1]?.trim();
        if (!name || !agents[name]) throw new PlifError('INVALID_ARGUMENT', 'usage: /agent remove <name>');
        delete agents[name];
        await saveGlobalConfig({ ...config, agent: agents });
        return ok(entry('notice', `agent ${name} removed`, { tone: 'accent', subtitle: globalConfigPath() }));
      }
      throw new PlifError('INVALID_ARGUMENT', 'usage: /agent list | add <name> <model> [description] | remove <name>');
    },
  },

  {
    name: 'profile',
    args: 'list | add <name> <model> <system prompt> | use <name> | remove <name>',
    summary: 'Manage the persistent main-agent identity',
    run: async (argv, context) => {
      const config = await loadGlobalConfig();
      const profiles = { ...profilesOf(config) };
      const action = argv[0] ?? 'list';
      if (action === 'list') {
        const names = Object.entries(profiles).map(([name, profile]) =>
          `${name}${config.activeProfile === name ? ' (active)' : ''} → ${profile.model ?? '(current model)'}${profile.name ? ` — ${profile.name}` : ''}`,
        );
        return ok(entry('notice', names.length ? names.join('\n') : 'no profiles configured', { tone: 'accent', subtitle: globalConfigPath(), expand: true }));
      }
      if (action === 'add') {
        const name = argv[1]?.trim();
        const model = argv[2]?.trim();
        const systemPrompt = argv.slice(3).join(' ').trim();
        if (!name || !model || !systemPrompt) throw new PlifError('INVALID_ARGUMENT', 'usage: /profile add <name> <model> <system prompt>');
        profiles[name] = { model, name, systemPrompt };
        await saveGlobalConfig({ ...config, profiles });
        return ok(entry('notice', `profile ${name} saved`, { tone: 'success', subtitle: globalConfigPath() }));
      }
      if (action === 'use') {
        const name = argv[1]?.trim();
        if (!name || !profiles[name]) throw new PlifError('INVALID_ARGUMENT', 'unknown profile; use /profile list');
        await context.switchProfile(name);
        return ok(entry('notice', `profile is now ${name}`, { tone: 'accent', subtitle: 'conversation reset for the new identity' }));
      }
      if (action === 'remove') {
        const name = argv[1]?.trim();
        if (!name || !profiles[name]) throw new PlifError('INVALID_ARGUMENT', 'usage: /profile remove <name>');
        delete profiles[name];
        await saveGlobalConfig({ ...config, profiles, ...(config.activeProfile === name ? { activeProfile: undefined } : {}) });
        return ok(entry('notice', `profile ${name} removed`, { tone: 'accent' }));
      }
      throw new PlifError('INVALID_ARGUMENT', 'usage: /profile list | add | use | remove');
    },
  },

  {
    name: 'audit',
    concurrent: true,
    args: '[--verify]',
    summary: 'Tail the audit log, or verify its hash chain',
    run: async (argv, context) => {
      await context.engine.audit.flush();

      if (argv.includes('--verify')) {
        const result = await context.engine.audit.verify();
        return ok(
          entry('notice', result.ok ? 'audit chain intact' : 'AUDIT CHAIN BROKEN', {
            tone: result.ok ? 'success' : 'danger',
            subtitle: result.ok ? undefined : `first bad record: seq ${result.brokenAt}`,
          }),
        );
      }

      const records: string[] = [];
      for await (const record of context.engine.audit.read()) {
        records.push(
          `${record.at.slice(11, 19)}  ${record.type.padEnd(20)} ${JSON.stringify(record.data).slice(0, 90)}`,
        );
      }
      return ok(
        entry('notice', `audit — ${records.length} records today`, {
          tone: 'accent',
          detail: records.slice(-20).join('\n') || '(empty)',
        }),
      );
    },
  },

  {
    name: 'clear',
    summary: 'Clear the timeline',
    run: async (_argv, context) => {
      context.clear();
      return ok();
    },
  },

  {
    name: 'exit',
    summary: 'Stop every container and quit',
    run: async (_argv, context) => {
      context.exit();
      return ok(entry('notice', 'shutting down…', { tone: 'muted' }));
    },
  },
];

export function findCommand(name: string): Command | null {
  return COMMANDS.find((command) => command.name === name) ?? null;
}

/** Prefix completions for the tab key. */
export function completeCommand(partial: string): string[] {
  return matchCommands(partial).map((command) => command.name);
}

/**
 * Commands matching what has been typed so far.
 *
 * Prefix matches rank above substring matches, so typing "st" offers `/stop`
 * before `/store`-adjacent things it merely contains. Anything more clever
 * (fuzzy scoring, frecency) would reorder the menu between keystrokes, and a
 * menu whose items move while you aim at them is worse than a dumb one.
 */
export function matchCommands(partial: string): Command[] {
  const needle = partial.toLowerCase();
  if (needle === '') return [...COMMANDS];

  const prefix = COMMANDS.filter((command) => command.name.startsWith(needle));
  const contains = COMMANDS.filter(
    (command) => !command.name.startsWith(needle) && command.name.includes(needle),
  );
  return [...prefix, ...contains];
}

/** Return the command word while the user is typing a slash command. */
export function commandPrefix(input: string): string | null {
  const match = /^\/([^\s]*)/.exec(input);
  return match ? match[1] ?? '' : null;
}

// ---------------------------------------------------------------------------

function resolveTarget(ref: string | undefined, context: CommandContext): Container {
  if (ref) return context.engine.require(ref);
  if (context.current) return context.current;
  throw new PlifError('CONTAINER_NOT_FOUND', 'no container is active', {
    hint: 'Run /new to create one, or /use <name> to pick one.',
  });
}

interface ParsedFlags {
  readonly positional: string[];
  readonly values: Record<string, string>;
  readonly repeated: Record<string, string[]>;
  readonly booleans: Set<string>;
}

/**
 * A deliberately small flag parser.
 *
 * Handles `--key value`, repeated `--key`, and bare `--flag`. It does not
 * handle `-k`, `--key=value` or quoting, because pulling in a full parser for
 * an internal command table trades a dependency for problems it does not have.
 */
function parseFlags(argv: readonly string[]): ParsedFlags {
  const positional: string[] = [];
  const values: Record<string, string> = {};
  const repeated: Record<string, string[]> = {};
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      booleans.add(key);
      continue;
    }
    values[key] = next;
    (repeated[key] ??= []).push(next);
    index += 1;
  }
  return { positional, values, repeated, booleans };
}

/** `host:target` or `host:target:ro|rw`, with Windows drive letters allowed. */
function parseMount(spec: string): { source: string; target: string; mode: 'ro' | 'rw' } {
  // Split from the right so a Windows drive letter stays intact.
  const parts = spec.split(':');
  let mode: 'ro' | 'rw' = 'ro';
  if (parts.length > 2 && (parts[parts.length - 1] === 'ro' || parts[parts.length - 1] === 'rw')) {
    mode = parts.pop() as 'ro' | 'rw';
  }
  const target = parts.pop();
  const source = parts.join(':');

  if (!target || !source) {
    throw new PlifError(
      'INVALID_ARGUMENT',
      `could not parse mount "${spec}"`,
      { hint: 'Use --mount <host-path>:<container-path>[:ro|rw]' },
    );
  }
  return { source: path.resolve(source), target, mode };
}
