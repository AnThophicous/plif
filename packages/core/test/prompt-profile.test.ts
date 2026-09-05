/**
 * Choosing the instruction layer, and what it costs.
 *
 * plif ships two versions of its heaviest instruction modules. Until now the
 * choice was made only by context window, so a large-context model paid the
 * long layer on every request for the whole session whether or not that was
 * the trade the operator wanted.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSystemPrompt } from '../src/harness/prompt.js';
import { DEFAULT_TOOLS, toolSpecs } from '../src/harness/tools.js';
import type { PromptContext } from '../src/agenting/types.js';

const capabilities = {
  fsRead: true,
  fsWrite: true,
  hostWrite: false,
  exec: true,
  network: true,
  envRead: false,
  spawnContainers: false,
} as const;

function context(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    workspace: 'C:/project',
    containerName: 'plif-1',
    workdir: '/project',
    tempWorkdir: '/temp',
    capabilities,
    isolation: 'process',
    contextTokens: 200_000,
    tools: toolSpecs(DEFAULT_TOOLS),
    effort: 'medium',
    ...overrides,
  };
}

describe('prompt layer selection', () => {
  it('defaults to the context-window rule, which is the old behaviour', () => {
    assert.equal(
      buildSystemPrompt(context()),
      buildSystemPrompt(context({ promptProfile: 'auto' })),
    );
  });

  it('gives a large-context model the full layer under auto', () => {
    const prompt = buildSystemPrompt(context({ contextTokens: 200_000 }));
    assert.match(prompt, /Plif default instructions/);
    assert.doesNotMatch(prompt, /Plif compact operating contract/);
  });

  it('gives a small-context model the compact layer under auto', () => {
    const prompt = buildSystemPrompt(context({ contextTokens: 16_000 }));
    assert.match(prompt, /Plif compact operating contract/);
    assert.doesNotMatch(prompt, /Plif default instructions/);
  });

  it('uses the compact layer at any context size when asked', () => {
    const prompt = buildSystemPrompt(context({ contextTokens: 200_000, promptProfile: 'compact' }));
    assert.match(prompt, /Plif compact operating contract/);
    assert.doesNotMatch(prompt, /Plif default instructions/);
  });

  it('uses the full layer at any context size when asked', () => {
    const prompt = buildSystemPrompt(context({ contextTokens: 8_000, promptProfile: 'full' }));
    assert.match(prompt, /Plif default instructions/);
    assert.doesNotMatch(prompt, /Plif compact operating contract/);
  });

  it('is substantially cheaper compact than full', () => {
    // The claim the setting is sold on. Held as a floor rather than an exact
    // figure so editing an instruction file does not fail the suite, but a
    // change that quietly erased the saving would.
    const full = buildSystemPrompt(context({ promptProfile: 'full' })).length;
    const compact = buildSystemPrompt(context({ promptProfile: 'compact' })).length;
    assert.ok(compact < full * 0.6, `compact (${compact}) should be well under 60% of full (${full})`);
  });

  it('never emits both layers of the same module', () => {
    // The failure this guards is silent: two kernels in one prompt contradict
    // each other and cost more than either.
    for (const profile of ['auto', 'compact', 'full'] as const) {
      const prompt = buildSystemPrompt(context({ promptProfile: profile }));
      const both =
        prompt.includes('Plif default instructions') &&
        prompt.includes('Plif compact operating contract');
      assert.equal(both, false, `${profile} emitted both kernel layers`);
    }
  });

  it('keeps modules that have no compact twin in every profile', () => {
    // Only some modules are paired. A profile filter that dropped the unpaired
    // ones would silently remove capability along with the tokens. Skill
    // authoring is unpaired and ungated, so it must survive every profile.
    for (const profile of ['auto', 'compact', 'full'] as const) {
      assert.match(
        buildSystemPrompt(context({ promptProfile: profile })),
        /Creating Plif skills/,
        `${profile} dropped an unpaired module`,
      );
    }
  });
});
