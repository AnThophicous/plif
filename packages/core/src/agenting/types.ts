import type { ToolSpec } from '../model/provider.js';
import type { ToolPresentationMode } from '../harness/code-mode/types.js';
import type { Effort } from '../model/config.js';
import type { CapabilitySet } from '../types.js';
import type { ShellReport } from '../harness/environment.js';
import type { Guidance } from '../harness/learning.js';

export type PromptMode = 'primary' | 'subagent' | 'explore' | 'review' | 'compaction';

export type PromptProfile = 'auto' | 'full' | 'compact';

export const PROMPT_PROFILES: readonly PromptProfile[] = Object.freeze(['auto', 'full', 'compact']);

export function isPromptProfile(value: unknown): value is PromptProfile {
  return typeof value === 'string' && (PROMPT_PROFILES as readonly string[]).includes(value);
}

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
  /**
   * Which instruction layer to compile, overriding the context-window rule.
   *
   * plif ships two versions of its heaviest instruction modules: a full one and
   * a compact one that says the same things in roughly a tenth of the words.
   * Until now the choice was made purely by context size — a 32k model got the
   * compact layer, everything larger got the full one — which meant a 200k
   * model paid about 15,000 tokens of system prompt on *every* request for the
   * whole session, whether or not the operator wanted to spend it that way.
   *
   * `auto` keeps the context-size rule. `compact` and `full` are the operator
   * saying which trade they want, and are what the setting exists for.
   */
  readonly promptProfile?: PromptProfile;
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

/**
 * Where the `auto` profile stops using the full instruction layer.
 *
 * The markdown twins already declare this boundary in their own metadata
 * (`maxContext=32767` on the compact side, `minContext=32768` on the full one).
 * A code module that ships two layers has no metadata to declare, so it reads
 * the same number from here and lands on the same side of the line.
 */
export const COMPACT_CONTEXT_CEILING = 32_767;

/**
 * Whether this context compiles the compact layer.
 *
 * `compileAgentInstructions` applies the profile to markdown modules by pairing
 * ids; a code module has no twin to pair with, so it asks this instead.
 */
export function usesCompactLayer(context: PromptContext): boolean {
  const profile = context.promptProfile ?? 'auto';
  if (profile !== 'auto') return profile === 'compact';
  return (context.contextTokens ?? Number.POSITIVE_INFINITY) <= COMPACT_CONTEXT_CEILING;
}
