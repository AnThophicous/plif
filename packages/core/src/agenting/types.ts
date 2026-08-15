import type { ToolSpec } from '../model/provider.js';
import type { Effort } from '../model/config.js';
import type { CapabilitySet } from '../types.js';
import type { ShellReport } from '../harness/environment.js';
import type { Guidance } from '../harness/learning.js';

export type PromptMode = 'primary' | 'subagent' | 'explore' | 'review' | 'compaction';

export interface PromptContext {
  readonly workspace: string;
  readonly containerName: string;
  readonly workdir: string;
  readonly capabilities: CapabilitySet;
  readonly isolation: string;
  readonly mode?: PromptMode;
  readonly effort?: Effort;
  /** Provider context capacity, used to select full or compact instruction layers. */
  readonly contextTokens?: number;
  readonly tools?: readonly ToolSpec[];
  readonly skills?: string;
  readonly mcpServers?: string;
  readonly guidance?: Guidance;
  readonly memory?: string;
  readonly notes?: string;
  readonly platform?: string;
  readonly shell?: ShellReport;
  readonly sandboxGaps?: readonly string[];
  readonly profile?: { readonly name: string; readonly systemPrompt: string };
  readonly agentInstructions?: string;
}

export interface ResolvedPromptContext extends PromptContext {
  readonly mode: PromptMode;
}

export interface PromptModule {
  readonly id: string;
  readonly order: number;
  readonly enabled?: (context: ResolvedPromptContext) => boolean;
  readonly render: (context: ResolvedPromptContext) => string;
}

export function definePromptModule(module: PromptModule): PromptModule {
  return Object.freeze(module);
}

export function resolvePromptContext(context: PromptContext): ResolvedPromptContext {
  return { ...context, mode: context.mode ?? 'primary' };
}
