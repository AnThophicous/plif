import { globalConfigPath, permissionMode } from '@plif/core';
import type { Effort, GlobalConfig, PermissionMode } from '@plif/core';

import { effortDisplay } from './effort-visuals.js';
import { binaryStateIndicator, shortenPath, type BinaryState } from './theme.js';

export type ConfigCategory = 'Interface' | 'Runtime' | 'Behavior' | 'Integrations' | 'Storage';
export type ConfigSettingKind = 'boolean' | 'enum' | 'number' | 'action' | 'readonly';
export type ConfigScope = 'global' | 'runtime' | 'action';

export interface ConfigOption {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
}

export interface ConfigActions {
  readonly setTheme: (id: string) => Promise<void>;
  readonly setEffort: (effort: Effort | undefined) => Promise<void>;
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>;
  readonly updateGlobal: (patch: Record<string, unknown>) => Promise<void>;
  readonly openModels: () => Promise<void>;
  readonly openProviders: () => Promise<void>;
  readonly openMcp: () => void;
  readonly openSkills: () => void;
}

export interface ConfigRuntime {
  readonly config: GlobalConfig;
  readonly activeThemeId: string;
  readonly themes: readonly { readonly id: string; readonly name: string; readonly description?: string }[];
  readonly provider: string;
  readonly model: string;
  readonly effort: Effort | undefined;
  readonly supportedEfforts: readonly Effort[];
  readonly mcpConnected: number;
  readonly mcpServers: number;
  readonly skills: number;
  readonly workspace: string;
}

export interface ConfigSetting {
  readonly id: string;
  readonly label: string;
  readonly category: ConfigCategory;
  readonly description: string;
  readonly kind: ConfigSettingKind;
  readonly scope: ConfigScope;
  /** Display value. It may be friendlier than the value sent to apply(). */
  readonly value: string;
  /** Optional semantic marker for a boolean display value. */
  readonly state?: BinaryState;
  /** Value used to initialise an editor and pass to apply(). */
  readonly inputValue: string;
  readonly options?: readonly ConfigOption[];
  readonly searchableTerms?: readonly string[];
  readonly apply?: (value: string) => Promise<void>;
  readonly action?: () => Promise<void> | void;
}

function option(value: string, label: string, detail?: string): ConfigOption {
  return { value, label, ...(detail ? { detail } : {}) };
}

function valueOf(input: unknown, fallback: string): string {
  return typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean'
    ? String(input)
    : fallback;
}

function numericSetting(
  id: string,
  label: string,
  description: string,
  key: 'temperature' | 'maxTokens' | 'timeoutMs',
  config: GlobalConfig,
  actions: ConfigActions,
  fallback: string,
): ConfigSetting {
  const value = valueOf(config[key], fallback);
  return {
    id,
    label,
    category: 'Runtime',
    description,
    kind: 'number',
    scope: 'global',
    value,
    // Keep the editor honest about values that are actually persisted. The
    // optional output-token limit intentionally starts blank; timeout and
    // temperature show their runtime defaults so Enter never writes an
    // accidental empty value.
    inputValue: config[key] === undefined && key === 'maxTokens' ? '' : value,
    searchableTerms: [key],
    apply: async (next) => {
      if (next.trim() === '') {
        if (key !== 'maxTokens') throw new Error(`${label} cannot be blank.`);
        await actions.updateGlobal({ [key]: undefined });
        return;
      }
      const parsed = Number(next.trim());
      if (!Number.isFinite(parsed) || parsed < 0 || (key !== 'temperature' && !Number.isInteger(parsed))) {
        throw new Error(`${label} must be a valid ${key === 'temperature' ? 'number' : 'integer'}.`);
      }
      if (key !== 'temperature' && parsed < 1) throw new Error(`${label} must be at least 1.`);
      await actions.updateGlobal({ [key]: parsed });
    },
  };
}

/**
 * Build the settings catalogue from the actual runtime and persisted config.
 * The renderer only receives this view model; it never guesses a setting's
 * current value or writes a second copy of provider/model/effort state.
 */
export function createConfigSettings(runtime: ConfigRuntime, actions: ConfigActions): readonly ConfigSetting[] {
  const theme = runtime.themes.find((item) => item.id === runtime.activeThemeId);
  const permission = permissionMode(runtime.config);
  const effort = runtime.effort ?? runtime.config.effort;
  const effortOptions: ConfigOption[] = [
    option('default', 'Default', 'let the provider choose'),
    ...runtime.supportedEfforts.map((item) => option(item, effortDisplay(item))),
  ];

  return [
    {
      id: 'theme',
      label: 'Theme',
      category: 'Interface',
      description: 'The active PLIF palette and terminal chrome.',
      kind: 'enum',
      scope: 'global',
      value: theme?.name ?? runtime.activeThemeId,
      inputValue: runtime.activeThemeId,
      options: runtime.themes.map((item) => option(item.id, item.name, item.description)),
      searchableTerms: ['appearance', 'palette', 'colors', 'colours'],
      apply: actions.setTheme,
    },
    {
      id: 'permissionMode',
      label: 'Permission mode',
      category: 'Behavior',
      description: 'How tool actions are approved before they run.',
      kind: 'enum',
      scope: 'global',
      value: permission === 'auto-approve' ? 'Auto-approve' : permission === 'deny' ? 'Deny' : 'Ask',
      inputValue: permission,
      options: [
        option('ask', 'Ask', 'confirm tool actions'),
        option('auto-approve', 'Auto-approve', 'run allowed actions without a prompt'),
        option('deny', 'Deny', 'block tool actions'),
      ],
      searchableTerms: ['approval', 'security', 'tools'],
      apply: async (value) => {
        if (value !== 'ask' && value !== 'auto-approve' && value !== 'deny') {
          throw new Error('Choose ask, auto-approve, or deny.');
        }
        await actions.setPermissionMode(value);
      },
    },
    {
      id: 'autoApprove',
      label: 'Auto-approve actions',
      category: 'Behavior',
      description: 'Shortcut for allowing tool actions without a confirmation prompt.',
      kind: 'boolean',
      scope: 'global',
      value: binaryStateIndicator(permission === 'auto-approve' ? 'on' : 'off').icon,
      state: permission === 'auto-approve' ? 'on' : 'off',
      inputValue: permission === 'auto-approve' ? 'true' : 'false',
      searchableTerms: ['approval', 'permissions', 'security', 'tools', 'boolean'],
      apply: async (value) => {
        if (value !== 'true' && value !== 'false') throw new Error('Enter true or false.');
        await actions.setPermissionMode(value === 'true' ? 'auto-approve' : 'ask');
      },
    },
    {
      id: 'provider',
      label: 'Provider',
      category: 'Runtime',
      description: 'Open the existing provider → model selector.',
      kind: 'action',
      scope: 'action',
      value: runtime.provider || 'not configured',
      inputValue: runtime.provider,
      searchableTerms: ['model', 'endpoint'],
      action: actions.openProviders,
    },
    {
      id: 'model',
      label: 'Model',
      category: 'Runtime',
      description: 'Open the existing model picker without duplicating its catalog.',
      kind: 'action',
      scope: 'action',
      value: runtime.model || 'not configured',
      inputValue: runtime.model,
      searchableTerms: ['provider', 'model id'],
      action: actions.openModels,
    },
    {
      id: 'effort',
      label: 'Default effort',
      category: 'Runtime',
      description: 'The reasoning level used by the next model request.',
      kind: 'enum',
      scope: 'global',
      value: effort ? effortDisplay(effort) : 'Default',
      inputValue: effort ?? 'default',
      options: effortOptions,
      searchableTerms: ['reasoning', 'effort', 'plif'],
      apply: async (value) => {
        if (value !== 'default' && !runtime.supportedEfforts.includes(value as Effort)) {
          throw new Error(`${value} is not supported by the current model.`);
        }
        await actions.setEffort(value === 'default' ? undefined : value as Effort);
      },
    },
    numericSetting(
      'temperature',
      'Temperature',
      'Sampling temperature for compatible providers.',
      'temperature',
      runtime.config,
      actions,
      '0.2',
    ),
    numericSetting(
      'maxTokens',
      'Max output tokens',
      'Optional response limit; blank means provider default.',
      'maxTokens',
      runtime.config,
      actions,
      'provider default',
    ),
    numericSetting(
      'timeoutMs',
      'Request timeout (ms)',
      'How long a provider request may wait before it is cancelled.',
      'timeoutMs',
      runtime.config,
      actions,
      '120000',
    ),
    {
      id: 'mcp',
      label: 'MCP servers',
      category: 'Integrations',
      description: 'Open the MCP browser to inspect and test connected servers.',
      kind: 'action',
      scope: 'action',
      value: `${runtime.mcpConnected}/${runtime.mcpServers} connected`,
      inputValue: '',
      searchableTerms: ['tools', 'servers', 'integrations'],
      action: actions.openMcp,
    },
    {
      id: 'skills',
      label: 'Skills',
      category: 'Integrations',
      description: 'Open the existing skills browser.',
      kind: 'action',
      scope: 'action',
      value: `${runtime.skills} available`,
      inputValue: '',
      searchableTerms: ['extensions', 'plugins', 'integrations'],
      action: actions.openSkills,
    },
    {
      id: 'configFile',
      label: 'Config file',
      category: 'Storage',
      description: 'Global settings are written atomically to this TOML file.',
      kind: 'readonly',
      scope: 'global',
      value: shortenPath(globalConfigPath(), 72),
      inputValue: globalConfigPath(),
      searchableTerms: ['persistence', 'toml', 'path', 'storage'],
    },
    {
      id: 'workspace',
      label: 'Workspace',
      category: 'Storage',
      description: 'The working directory for this session.',
      kind: 'readonly',
      scope: 'runtime',
      value: shortenPath(runtime.workspace, 72),
      inputValue: runtime.workspace,
      searchableTerms: ['directory', 'cwd', 'project'],
    },
  ];
}

export function filterConfigSettings(
  settings: readonly ConfigSetting[],
  query: string,
): readonly ConfigSetting[] {
  const parts = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return settings;
  return settings.filter((setting) => {
    const haystack = [
      setting.id,
      setting.label,
      setting.category,
      setting.description,
      ...(setting.searchableTerms ?? []),
    ].join(' ').toLowerCase();
    return parts.every((part) => haystack.includes(part));
  });
}

export function configCategoryStarts(
  settings: readonly ConfigSetting[],
): readonly { readonly index: number; readonly category: ConfigCategory }[] {
  const starts: { index: number; category: ConfigCategory }[] = [];
  settings.forEach((setting, index) => {
    if (index === 0 || settings[index - 1]!.category !== setting.category) {
      starts.push({ index, category: setting.category });
    }
  });
  return starts;
}
