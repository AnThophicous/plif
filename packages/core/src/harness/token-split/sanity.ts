import { estimateTokens } from '../context-budget.js';
import { renderToolsSdk } from '../code-mode/sdk.js';
import { defaultTokenSplitConfig, tokenSplitDefinition } from './registry.js';
import { projectTokenSplitInput } from './pipeline.js';
import type { Message, ToolSpec } from '../../model/provider.js';
import type { TokenSplitSanityResult, TokenSplitTechniqueId } from './types.js';

const wired = new Set<TokenSplitTechniqueId>([
  'budgets', 'code-mode', 'lazy', 'skills-disclosure', 'cache-prefix', 'diff-mode',
  'subagents', 'tool-clear', 'prune-old', 'compaction',
]);

const syntheticSpecs: readonly ToolSpec[] = [
  {
    name: 'zeta',
    description: 'Last by name, first by declaration order.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'alpha',
    description: 'First by name.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

/**
 * The collapse only pays if the prefix it moves the catalogue into is cacheable,
 * and a prefix is only cacheable if it renders identically every turn. So the
 * check that matters is not that the SDK exists but that two orderings of the
 * same tool set produce the same bytes.
 */
function checkCodeMode(): void {
  const rendered = renderToolsSdk(syntheticSpecs);
  if (!rendered.includes('declare const tools')) {
    throw new Error('the generated SDK did not declare the tools namespace');
  }
  if (rendered !== renderToolsSdk([...syntheticSpecs].reverse())) {
    throw new Error('the generated SDK is not stable across tool ordering');
  }
  if (rendered.indexOf('alpha:') > rendered.indexOf('zeta:')) {
    throw new Error('the generated SDK is not in lexicographic order');
  }
}

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
      if (definition.id === 'code-mode') {
        checkCodeMode();
        return { technique: definition.id, status: 'pass', detail: 'the generated SDK is deterministic and ordered', durationMs: Date.now() - started };
      }
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
