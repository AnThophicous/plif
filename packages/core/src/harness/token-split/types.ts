import type { Message } from '../../model/provider.js';

export const TOKEN_SPLIT_TECHNIQUE_IDS = [
  'budgets',
  'lazy',
  'skills-disclosure',
  'state-notes',
  'spill',
  'cache-prefix',
  'diff-mode',
  'answer-first',
  'terse',
  'subagents',
  'tool-clear',
  'prune-old',
  'compaction',
  'caveman',
] as const;

export type TokenSplitTechniqueId = (typeof TOKEN_SPLIT_TECHNIQUE_IDS)[number];
export type TokenSplitLayer = 0 | 1 | 2;

export interface TokenSplitTechniqueConfig {
  readonly on: boolean;
  readonly config: Readonly<Record<string, unknown>>;
}

export type TokenSplitTechniqueMap = Record<TokenSplitTechniqueId, TokenSplitTechniqueConfig>;

export interface TokenSplitPrices {
  readonly inputPerM: number;
  readonly outputPerM: number;
  readonly cacheHitPerM: number;
  readonly cacheWritePerM: number;
}

export interface TokenSplitConfig {
  readonly version: 1;
  readonly enabled: boolean;
  readonly techniques: TokenSplitTechniqueMap;
  readonly prices: TokenSplitPrices;
  readonly sanity: {
    readonly window: number;
    readonly autoDisableBelow: number;
  };
}

export interface TokenSplitTechniqueDefinition {
  readonly id: TokenSplitTechniqueId;
  readonly name: string;
  readonly layer: TokenSplitLayer;
  readonly defaultOn: boolean;
  readonly removable: boolean;
  readonly runtime: 'projection' | 'existing-pipeline' | 'telemetry-only';
  readonly description: string;
}

export interface TokenSplitTransformation {
  readonly technique: TokenSplitTechniqueId;
  readonly action: string;
  readonly tokensAffected: number;
  readonly reversible: boolean;
  readonly marker?: string;
}

export interface TokenSplitProjection {
  readonly messages: readonly Message[];
  readonly baselineTokens: number;
  readonly effectiveTokens: number;
  readonly transformations: readonly TokenSplitTransformation[];
}

export interface TokenSplitMetricRecord {
  readonly version: 1;
  readonly turn: number;
  readonly ts: string;
  readonly inputTokens: {
    readonly enviados: number;
    readonly baseline: number;
  };
  readonly outputTokens: number;
  readonly cache: {
    readonly hit: number | null;
    readonly miss: number | null;
  };
  readonly custo: {
    readonly inputUsd: number | null;
    readonly outputUsd: number | null;
    readonly totalUsd: number | null;
  };
  readonly pressao: string;
  readonly transformacoes: readonly TokenSplitTransformation[];
  readonly sanidade: readonly {
    readonly tec: TokenSplitTechniqueId;
    readonly taxa: number | null;
  }[];
}

export interface TokenSplitSanityResult {
  readonly technique: TokenSplitTechniqueId;
  readonly status: 'pass' | 'fail' | 'not-wired';
  readonly detail: string;
  readonly durationMs: number;
}

export interface TokenSplitSanityObservation {
  readonly ts: string;
  readonly technique: TokenSplitTechniqueId;
  readonly status: 'pass' | 'fail' | 'not-wired';
}
