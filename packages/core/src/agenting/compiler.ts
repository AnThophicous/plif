import { codeModeNoticeModule, codeModeSdkModule } from './code-mode.js';
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
  codeModeNoticeModule,
  toolsModule,
  codeModeSdkModule,
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

  /**
   * Pick the full or the compact layer, by profile or by context size.
   *
   * The two layers are already distinguished by id: every compact module is
   * `<something>-compact`, and the full one it replaces is `<something>`. So an
   * explicit profile needs no new frontmatter — it keeps one side of each pair
   * and every module that has no twin. `auto` falls through to the
   * context-window rule the modules already declare.
   */
  const loaded = loadMarkdownInstructions();
  const compactIds = new Set(
    loaded.map((module) => module.id).filter((id) => id.endsWith('-compact')),
  );
  const hasCompactTwin = (id: string): boolean => compactIds.has(`${id}-compact`);
  const profile = context.promptProfile ?? 'auto';
  const layerFilter = (module: { id: string; minContext?: number; maxContext?: number }): boolean => {
    if (profile === 'compact') {
      return module.id.endsWith('-compact') || !hasCompactTwin(module.id);
    }
    if (profile === 'full') return !module.id.endsWith('-compact');
    return (
      (module.minContext === undefined || contextTokens >= module.minContext) &&
      (module.maxContext === undefined || contextTokens <= module.maxContext)
    );
  };

  const staticModules = loaded
    .filter((module) => module.modes?.includes(context.mode) ?? true)
    .filter((module) => !module.effort || module.effort === context.effort)
    .filter(layerFilter)
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
