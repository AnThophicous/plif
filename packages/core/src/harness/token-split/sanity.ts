import { estimateTokens } from '../context-budget.js';
import { defaultTokenSplitConfig, tokenSplitDefinition } from './registry.js';
import { projectTokenSplitInput } from './pipeline.js';
import type { Message } from '../../model/provider.js';
import type { TokenSplitSanityResult, TokenSplitTechniqueId } from './types.js';

const wired = new Set<TokenSplitTechniqueId>([
  'budgets', 'lazy', 'skills-disclosure', 'cache-prefix', 'diff-mode',
  'subagents', 'tool-clear', 'prune-old', 'compaction',
]);

function syntheticMessages(): Message[] {
  return [
    { role: 'user', content: 'objective: preserve packages/core/src/example.ts and error ERR_SYNTHETIC' },
    { role: 'assistant', content: 'A'.repeat(1800) },
    { role: 'tool', toolCallId: 'call_old', content: 'old result ' + 'x'.repeat(8000) },
    { role: 'user', content: 'continue with the task' },
    { role: 'assistant', content: 'recent answer' },
    { role: 'user', content: 'last message' },
    { role: 'assistant', content: 'latest answer' },
  ];
}

export function runTokenSplitSanity(only?: string): TokenSplitSanityResult[] {
  const ids = only ? [only] : Object.keys(defaultTokenSplitConfig().techniques);
  return ids.map((rawId) => {
    const started = Date.now();
    const definition = tokenSplitDefinition(rawId);
    if (!definition) return { technique: rawId as TokenSplitTechniqueId, status: 'fail', detail: 'unknown technique id', durationMs: Date.now() - started };
    if (!wired.has(definition.id)) return { technique: definition.id, status: 'not-wired', detail: 'registered contract has no safe runtime hook yet', durationMs: Date.now() - started };
    try {
      const source = syntheticMessages();
      const projected = projectTokenSplitInput(source, defaultTokenSplitConfig());
      const protectedText = projected.messages.map((message) => message.content).join('\n');
      if (!protectedText.includes('packages/core/src/example.ts') || !protectedText.includes('ERR_SYNTHETIC')) {
        throw new Error('protected path/error anchor was not preserved');
      }
      if (definition.id === 'tool-clear' && projected.effectiveTokens >= estimateTokens(source)) {
        throw new Error('tool-clear did not reduce the safe synthetic tool result');
      }
      return { technique: definition.id, status: 'pass', detail: 'deterministic safety/projection checks passed', durationMs: Date.now() - started };
    } catch (error) {
      return { technique: definition.id, status: 'fail', detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started };
    }
  });
}
