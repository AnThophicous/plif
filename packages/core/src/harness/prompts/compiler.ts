import fs from 'node:fs';

import {
  historicalContextModule,
  profileModule,
  projectContextModule,
} from './context.js';
import { environmentModule } from './environment.js';
import { mcpModule } from './mcp.js';
import { plifModule } from './plif.js';
import { MODE_MODULES } from './modes/index.js';
import { skillsModule } from './skills.js';
import { toolsModule } from './tools.js';
import type { PromptContext, PromptModule, ResolvedPromptContext } from './types.js';
import { definePromptModule, resolvePromptContext } from './types.js';

const DEFAULT_MARKDOWN = loadDefaultMarkdown();

const defaultModule = definePromptModule({
  id: '00-default',
  order: 0,
  render: () => DEFAULT_MARKDOWN,
});

export const DEFAULT_PROMPT_MODULES: readonly PromptModule[] = [
  defaultModule,
  plifModule,
  ...MODE_MODULES,
  environmentModule,
  toolsModule,
  skillsModule,
  mcpModule,
  projectContextModule,
  profileModule,
  historicalContextModule,
];

export function compileSystemPrompt(
  source: PromptContext,
  modules: readonly PromptModule[] = DEFAULT_PROMPT_MODULES,
): string {
  const context = resolvePromptContext(source);
  const selected = modules
    .filter((module) => module.enabled?.(context) ?? true)
    .filter((module) => context.mode !== 'compaction' || module.id === '10-mode-compaction');
  assertUniqueIds(selected);
  return [...selected]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((module) => module.render(context).trim())
    .filter(Boolean)
    .join('\n\n');
}

function assertUniqueIds(modules: readonly PromptModule[]): void {
  const ids = new Set<string>();
  for (const module of modules) {
    if (ids.has(module.id)) throw new Error(`Duplicate prompt module: ${module.id}`);
    ids.add(module.id);
  }
}

export function promptModeOf(context: PromptContext): ResolvedPromptContext['mode'] {
  return context.mode ?? 'primary';
}

function loadDefaultMarkdown(): string {
  const candidates = [
    new URL('./default.md', import.meta.url),
    new URL('../../../src/harness/prompts/default.md', import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const source = fs.readFileSync(candidate, 'utf8').trim();
      if (source) return source;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Plif default prompt asset is missing.');
}
