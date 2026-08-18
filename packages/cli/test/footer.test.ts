import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contextMeter, footerSummary, providerDisplayName } from '../src/components/Footer.js';

describe('footer status summary', () => {
  it('normalizes provider hosts into a compact identity', () => {
    assert.equal(providerDisplayName('https://api.anthropic.com/v1'), 'Anthropic');
    assert.equal(providerDisplayName('https://openrouter.ai/api/v1'), 'OpenRouter');
    assert.equal(providerDisplayName('https://integrate.api.nvidia.com/v1'), 'NVIDIA');
    assert.equal(providerDisplayName(undefined), 'not configured');
  });

  it('keeps provider, model, effort and context readable in one stable line', () => {
    assert.equal(
      footerSummary({
        provider: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        effort: 'plif',
        contextUsed: 1200,
        contextMax: 4000,
      }),
      'DeepSeek  │  deepseek-chat  │  effort: plif  │  ctx 30%',
    );
  });

  it('keeps the context meter bounded and fixed-width', () => {
    assert.equal(contextMeter(0), '░░░░░░░░░░');
    assert.equal(contextMeter(25), '███░░░░░░░');
    assert.equal(contextMeter(100), '██████████');
  });
});
