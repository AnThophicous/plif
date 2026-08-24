import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeContextBudget,
  stableToolSpecs,
} from '../src/harness/context-budget.js';
import { compact, estimateTokens } from '../src/harness/compaction.js';
import {
  mergeTokenUsage,
  normalizeAnthropicUsage,
  normalizeOpenAIUsage,
} from '../src/model/token-usage.js';
import type { ProviderCapabilities } from '../src/model/provider.js';

describe('canonical provider token accounting', () => {
  it('keeps adapter capability semantics explicit without claiming remote metadata', () => {
    const capabilities: ProviderCapabilities = {
      usageSemantics: 'openai-compatible',
      cacheSupport: 'reported',
      cacheAccounting: 'separate-if-reported',
      reasoningAccounting: 'reported',
    };
    assert.equal(capabilities.cacheSupport, 'reported');
    assert.equal(capabilities.cacheAccounting, 'separate-if-reported');
  });

  it('does not double-count DeepSeek/OpenAI cached input', () => {
    const usage = normalizeOpenAIUsage({
      prompt_tokens: 100_000,
      prompt_cache_hit_tokens: 90_000,
      prompt_cache_miss_tokens: 10_000,
      completion_tokens: 20,
      completion_tokens_details: { reasoning_tokens: 12 },
    });

    assert.deepEqual(usage?.tokenUsage, {
      inputNewTokens: 10_000,
      inputCachedTokens: 90_000,
      outputTokens: 20,
      reasoningTokens: 12,
      totalPromptTokens: 100_000,
      totalTokens: 100_020,
      requestCount: 1,
      source: 'derived',
    });
  });

  it('keeps Anthropic cache reads and writes separate from new input', () => {
    const usage = normalizeAnthropicUsage({
      input_tokens: 100,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 25,
      output_tokens: 10,
    });

    assert.equal(usage?.promptTokens, 175);
    assert.deepEqual(usage?.tokenUsage, {
      inputNewTokens: 100,
      inputCachedTokens: 50,
      cacheWriteTokens: 25,
      outputTokens: 10,
      totalPromptTokens: 175,
      totalTokens: 185,
      requestCount: 1,
      source: 'reported',
    });
  });

  it('does not turn missing prompt usage into a fictional zero', () => {
    const usage = normalizeOpenAIUsage({ completion_tokens: 10 });
    assert.equal(usage?.tokenUsage.inputNewTokens, undefined);
    assert.equal(usage?.tokenUsage.totalPromptTokens, undefined);
    assert.equal(usage?.tokenUsage.outputTokens, 10);
  });

  it('merges requests while preserving unknown fields as unknown', () => {
    const first = normalizeOpenAIUsage({ prompt_tokens: 10, completion_tokens: 2 })!.tokenUsage;
    const second = normalizeOpenAIUsage({ completion_tokens: 3 })!.tokenUsage;
    const merged = mergeTokenUsage(first, second);
    assert.equal(merged.inputNewTokens, undefined);
    assert.equal(merged.outputTokens, 5);
    assert.equal(merged.totalPromptTokens, undefined);
    assert.equal(merged.source, 'reported');
  });
});

describe('context budget and stable prefix accounting', () => {
  it('includes tool schemas and reserves output before calculating pressure', () => {
    const budget = computeContextBudget({
      contextWindow: 1_000,
      reservedOutputTokens: 100,
      safetyMarginTokens: 50,
      messages: [{ role: 'system', content: 'stable instructions' }, { role: 'user', content: 'task' }],
      tools: [{ name: 'read', description: 'read files', parameters: { z: { type: 'string' }, a: { type: 'string' } } }],
    });

    assert.equal(budget.availableInputBudget, 850);
    assert.ok(budget.effectiveInputTokens > 0);
    assert.ok(budget.breakdown.toolSchemaTokens > 0);
    assert.ok(budget.breakdown.cacheEligibleTokens > 0);
  });

  it('serializes tool order and schema keys deterministically', () => {
    const stable = stableToolSpecs([
      { name: 'z', description: 'z', parameters: { b: 1, a: 2 } },
      { name: 'a', description: 'a', parameters: { y: 1, x: 2 } },
    ]);
    assert.deepEqual(stable.map((tool) => tool.name), ['a', 'z']);
    assert.deepEqual(Object.keys(stable[1]!.parameters), ['a', 'b']);
  });

  it('keeps the stable prefix hash across conversation-only changes', () => {
    const messages = [
      { role: 'system' as const, content: 'fixed instructions' },
      { role: 'user' as const, content: 'first question' },
    ];
    const tools = [{
      name: 'read',
      description: 'read files',
      parameters: { type: 'object' },
    }];
    const first = computeContextBudget({ contextWindow: 10_000, messages, tools });
    messages.push({ role: 'user', content: 'second question' });
    const second = computeContextBudget({ contextWindow: 10_000, messages, tools });

    assert.equal(second.breakdown.stablePrefixHash, first.breakdown.stablePrefixHash);
    assert.ok(second.effectiveInputTokens > first.effectiveInputTokens);
  });

  it('invalidates the prefix hash when a system message is replaced', () => {
    const messages = [
      { role: 'system' as const, content: 'instructions v1' },
      { role: 'user' as const, content: 'question' },
    ];
    const tools = [{ name: 'read', description: 'read', parameters: {} }];
    const first = computeContextBudget({ contextWindow: 10_000, messages, tools });
    messages[0] = { role: 'system', content: 'instructions v2' };
    const second = computeContextBudget({ contextWindow: 10_000, messages, tools });

    assert.notEqual(second.breakdown.stablePrefixHash, first.breakdown.stablePrefixHash);
  });

  it('keeps repeated short message estimates exact across fresh objects', () => {
    const content = 'same prompt fragment';
    const first = estimateTokens([{ role: 'user', content }]);
    const repeated = estimateTokens([
      { role: 'assistant', content },
      { role: 'tool', content },
    ]);

    assert.equal(repeated, first * 2);
  });

  it('updates the append-only aggregate without trusting arbitrary replacements', () => {
    const messages = [{ role: 'user' as const, content: 'first' }];
    const first = computeContextBudget({ contextWindow: 10_000, messages, appendOnly: true });
    messages.push({ role: 'assistant', content: 'second' });
    const appended = computeContextBudget({ contextWindow: 10_000, messages, appendOnly: true });

    assert.ok(appended.effectiveInputTokens > first.effectiveInputTokens);

    messages[0] = { role: 'user', content: 'replacement with different size' };
    const replaced = computeContextBudget({ contextWindow: 10_000, messages });
    assert.equal(
      replaced.effectiveInputTokens,
      computeContextBudget({ contextWindow: 10_000, messages, appendOnly: false }).effectiveInputTokens,
    );
  });

  it('reports a no-progress compaction instead of allowing a retry loop', async () => {
    const messages = [
      { role: 'system' as const, content: 'system '.repeat(500) },
      { role: 'user' as const, content: 'task '.repeat(500) },
    ];
    const result = await compact(messages, { maxTokens: Math.floor(estimateTokens(messages) / 2) });
    assert.equal(result.progressed, false);
    assert.equal(result.failure?.stage, 'compaction progress');
    assert.equal(result.failure?.fallback, 'raw history preserved');
  });
});
