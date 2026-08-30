import { historicalContextModule, profileModule, projectContextModule } from './context.js';
import { compactionSystemPrompt } from './compaction.js';
import { environmentModule } from './environment.js';
import { loadMarkdownInstructions, renderInstruction } from './instruction-loader.js';
import { mcpModule, skillsModule, toolsModule } from './capabilities.js';
import type { PromptContext, PromptModule, ResolvedPromptContext } from './types.js';
import { resolvePromptContext } from './types.js';
import { securityModule } from '../harness/security-instructions.js';

export const DEFAULT_AGENTING_MODULES: readonly PromptModule[] = [
  securityModule,
  environmentModule,
  toolsModule,
  skillsModule,
  mcpModule,
  projectContextModule,
  profileModule,
  historicalContextModule,
];

export function compileAgentInstructions(
  source: PromptContext,
  modules: readonly PromptModule[] = DEFAULT_AGENTING_MODULES,
): string {
  const context = resolvePromptContext(source);
  if (context.mode === 'compaction') return compactionSystemPrompt();
  const availableTools = new Set(context.tools?.map((tool) => tool.name) ?? []);
  const contextTokens = context.contextTokens ?? Number.POSITIVE_INFINITY;

  const staticModules = loadMarkdownInstructions()
    .filter((module) => module.modes?.includes(context.mode) ?? true)
    .filter((module) => !module.effort || module.effort === context.effort)
    .filter((module) => module.minContext === undefined || contextTokens >= module.minContext)
    .filter((module) => module.maxContext === undefined || contextTokens <= module.maxContext)
    .filter((module) => module.tools?.every((name) => availableTools.has(name)) ?? true)
    .map((module) => ({ id: module.id, order: module.order, render: () => renderInstruction(module.source) }));

  const selected = [
    ...staticModules,
    ...modules.filter((module) => module.enabled?.(context) ?? true),
  ];

  assertUniqueIds(selected);
  return selected
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((module) => module.render(context).trim())
    .filter(Boolean)
    .join('\n\n');
}

function assertUniqueIds(modules: readonly Pick<PromptModule, 'id'>[]): void {
  const ids = new Set<string>();
  for (const module of modules) {
    if (ids.has(module.id)) throw new Error(`Duplicate agent instruction module: ${module.id}`);
    ids.add(module.id);
  }
}

export function promptModeOf(context: PromptContext): ResolvedPromptContext['mode'] {
  return context.mode ?? 'primary';
}
