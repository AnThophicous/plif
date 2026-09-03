import type { ToolSpec } from '../model/provider.js';
import type { ToolPresentationMode } from '../harness/code-mode/types.js';
import type { Effort } from '../model/config.js';
import type { CapabilitySet } from '../types.js';
import type { ShellReport } from '../harness/environment.js';
import type { Guidance } from '../harness/learning.js';

export type PromptMode = 'primary' | 'subagent' | 'explore' | 'review' | 'compaction';

export interface PromptContext {
  readonly workspace: string;
  readonly containerName: string;
  readonly workdir: string;
  /** Disposable session scratch path, normally /temp, separate from /project. */
  readonly tempWorkdir?: string;
  readonly capabilities: CapabilitySet;
  readonly isolation: string;
  readonly mode?: PromptMode;
  /** Native provider identity, used to describe provider-specific skill loading. */
  readonly providerId?: string;
  readonly modelId?: string;
  readonly modelDisplayName?: string;
  readonly endpointRoute?: string;
  readonly effort?: Effort;
  /** Provider context capacity, used to select full or compact instruction layers. */
  readonly contextTokens?: number;
  readonly tools?: readonly ToolSpec[];
  /**
   * How the tool surface is presented this turn.
   *
   * The prompt has to agree with the wire: in `code` the schemas are not sent,
   * so the catalogue the model works from is the SDK rendered here. A context
   * that said `code` while the loop sent native schemas — or the reverse —
   * would describe a machine the model is not talking to.
   */
  readonly toolMode?: ToolPresentationMode;
  readonly skills?: string;
  /** Skills already loaded into the carried conversation for this session. */
  readonly loadedSkills?: readonly string[];
  readonly mcpServers?: string;
  readonly guidance?: Guidance;
  readonly memory?: string;
  readonly notes?: string;
  readonly platform?: string;
  readonly shell?: ShellReport;
  readonly sandboxGaps?: readonly string[];
  readonly profile?: { readonly name: string; readonly description?: string; readonly systemPrompt: string };
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
