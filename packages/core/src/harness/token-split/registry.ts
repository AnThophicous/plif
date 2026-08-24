import {
  TOKEN_SPLIT_TECHNIQUE_IDS,
  type TokenSplitConfig,
  type TokenSplitTechniqueDefinition,
  type TokenSplitTechniqueId,
  type TokenSplitTechniqueMap,
} from './types.js';

export { TOKEN_SPLIT_TECHNIQUE_IDS } from './types.js';

const TECHNIQUE_DEFINITIONS: readonly TokenSplitTechniqueDefinition[] = [
  { id: 'budgets', name: 'Section budgets', layer: 0, defaultOn: true, removable: false, runtime: 'existing-pipeline', description: 'Keeps instructions, tools, history and notes within explicit budgets.' },
  { id: 'lazy', name: 'Lazy content', layer: 0, defaultOn: true, removable: false, runtime: 'existing-pipeline', description: 'Prefers previews and bounded tool results before full content.' },
  { id: 'skills-disclosure', name: 'Skills disclosure', layer: 0, defaultOn: true, removable: false, runtime: 'existing-pipeline', description: 'Lists skill summaries and loads full instructions only when used.' },
  { id: 'state-notes', name: 'State notes', layer: 0, defaultOn: true, removable: false, runtime: 'existing-pipeline', description: 'Reserves authoritative facts for safe compaction and recovery.' },
  { id: 'spill', name: 'Spill large results', layer: 0, defaultOn: true, removable: false, runtime: 'projection', description: 'Provides an auditable path for results too large to keep inline.' },
  { id: 'cache-prefix', name: 'Stable cache prefix', layer: 0, defaultOn: true, removable: false, runtime: 'existing-pipeline', description: 'Stabilizes system/tool prefix ordering and records cache evidence.' },
  { id: 'diff-mode', name: 'Diff mode', layer: 0, defaultOn: true, removable: false, runtime: 'existing-pipeline', description: 'Keeps file changes as compact diffs instead of repeating whole files.' },
  { id: 'answer-first', name: 'Answer first', layer: 0, defaultOn: true, removable: false, runtime: 'telemetry-only', description: 'Reserves output limits without rewriting code, paths or errors.' },
  { id: 'terse', name: 'Terse output', layer: 0, defaultOn: false, removable: false, runtime: 'telemetry-only', description: 'Optional prose-only response limit; never touches operational data.' },
  { id: 'subagents', name: 'Subagents', layer: 0, defaultOn: true, removable: false, runtime: 'existing-pipeline', description: 'Delegates bounded exploration when the existing subagent policy allows it.' },
  { id: 'tool-clear', name: 'Tool clear', layer: 1, defaultOn: true, removable: true, runtime: 'projection', description: 'Trims old, cited-free tool results while preserving head, tail and errors.' },
  { id: 'prune-old', name: 'Prune old turns', layer: 1, defaultOn: true, removable: true, runtime: 'projection', description: 'Hides safe, complete old assistant prose in the request projection.' },
  { id: 'compaction', name: 'Verified compaction', layer: 2, defaultOn: false, removable: true, runtime: 'existing-pipeline', description: 'Optional lossy summary with explicit verification and rollback.' },
  { id: 'caveman', name: 'Caveman output', layer: 2, defaultOn: false, removable: true, runtime: 'telemetry-only', description: 'Optional prose-only aggressive brevity; disabled by default.' },
];

const DEFAULT_TECHNIQUE_CONFIGS: Record<TokenSplitTechniqueId, Record<string, unknown>> = {
  budgets: { sections: { instructions: 4000, toolResults: 8000, injected: 3000, history: 20000, skillsList: 400, notes: 1500 }, hard: true },
  lazy: { peekLines: 40, grepMaxResults: 200, smallFileBytes: 1536 },
  'skills-disclosure': { listBudgetFraction: 0.01, listBudgetTokens: 400, reloadAfterCompactionTokens: 3000, descriptionMaxChars: 500 },
  'state-notes': { path: '.plif/NOTES.md', archiveEveryKb: 50 },
  spill: { maxInlineChars: 50000, headChars: 1500, tailChars: 300, dir: '.plif/tmp/spill' },
  'cache-prefix': { provider: 'auto', breakpoints: 1 },
  'diff-mode': { mapTokens: 1000, exclude: ['.lock', '.png', '.bin', 'node_modules'] },
  'answer-first': { maxTokensChat: 4096, maxTokensCode: 8192, maxTokensReview: 2048 },
  terse: { maxWords: 30 },
  subagents: { timeoutMs: 120000, maxResultTokens: 1500, confidenceThreshold: 0.7 },
  'tool-clear': { ageMessages: 4, citeLookback: 3, headChars: 1500, tailChars: 300 },
  'prune-old': { ageMessages: 6, citeLookback: 6 },
  compaction: { triggerPressure: 0.8, minSpanTokens: 6000, maxSpanTurns: 30, summarizer: { model: 'auto', maxTokens: 1024, temperature: 0 }, keepRecentMessages: 3, verify: { questions: 5, rerunOnFail: false } },
  caveman: { proseOnly: true },
};

const DEFAULT_PRICES = { inputPerM: 0.27, outputPerM: 1.10, cacheHitPerM: 0.027, cacheWritePerM: 0.337 } as const;

export function tokenSplitDefinitions(): readonly TokenSplitTechniqueDefinition[] {
  return TECHNIQUE_DEFINITIONS;
}

export function tokenSplitDefinition(id: string): TokenSplitTechniqueDefinition | undefined {
  return TECHNIQUE_DEFINITIONS.find((definition) => definition.id === id);
}

function validId(value: string): value is TokenSplitTechniqueId {
  return (TOKEN_SPLIT_TECHNIQUE_IDS as readonly string[]).includes(value);
}

export function defaultTokenSplitConfig(): TokenSplitConfig {
  const techniques = Object.fromEntries(TECHNIQUE_DEFINITIONS.map((definition) => [definition.id, {
    on: definition.defaultOn,
    config: DEFAULT_TECHNIQUE_CONFIGS[definition.id],
  }])) as TokenSplitTechniqueMap;
  return {
    version: 1,
    enabled: true,
    techniques,
    prices: DEFAULT_PRICES,
    sanity: { window: 10, autoDisableBelow: 0.95 },
  };
}

function mergeRecord(base: Record<string, unknown>, incoming: unknown): Record<string, unknown> {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return base;
  return { ...base, ...(incoming as Record<string, unknown>) };
}

export function normalizeTokenSplitConfig(value: unknown): TokenSplitConfig {
  const defaults = defaultTokenSplitConfig();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const rawTechniques = raw['techniques'];
  const techniques = { ...defaults.techniques } as TokenSplitTechniqueMap;
  if (rawTechniques && typeof rawTechniques === 'object' && !Array.isArray(rawTechniques)) {
    for (const [id, rawEntry] of Object.entries(rawTechniques)) {
      if (!validId(id) || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
      const entry = rawEntry as Record<string, unknown>;
      techniques[id] = {
        on: entry['on'] === true,
        config: mergeRecord(techniques[id]!.config as Record<string, unknown>, entry['config']),
      };
    }
  }
  const prices = mergeRecord(defaults.prices as unknown as Record<string, unknown>, raw['prices']);
  const sanity = mergeRecord(defaults.sanity as unknown as Record<string, unknown>, raw['sanity']);
  return {
    version: 1,
    enabled: raw['enabled'] !== false,
    techniques,
    prices: {
      inputPerM: typeof prices['inputPerM'] === 'number' ? prices['inputPerM'] : defaults.prices.inputPerM,
      outputPerM: typeof prices['outputPerM'] === 'number' ? prices['outputPerM'] : defaults.prices.outputPerM,
      cacheHitPerM: typeof prices['cacheHitPerM'] === 'number' ? prices['cacheHitPerM'] : defaults.prices.cacheHitPerM,
      cacheWritePerM: typeof prices['cacheWritePerM'] === 'number' ? prices['cacheWritePerM'] : defaults.prices.cacheWritePerM,
    },
    sanity: {
      window: typeof sanity['window'] === 'number' ? Math.max(1, Math.floor(sanity['window'])) : defaults.sanity.window,
      autoDisableBelow: typeof sanity['autoDisableBelow'] === 'number' ? sanity['autoDisableBelow'] : defaults.sanity.autoDisableBelow,
    },
  };
}

export function techniqueIsOn(config: TokenSplitConfig, id: TokenSplitTechniqueId): boolean {
  return config.enabled && config.techniques[id]?.on === true;
}
