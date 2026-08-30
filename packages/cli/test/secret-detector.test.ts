import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  detectDraftSecrets,
  redactDetectedSecrets,
  SECRET_FINAL_CONTEXT,
  SECRET_FIRST_CONTEXT,
} from '../src/security/secret-detector.js';

describe('local secret detector', () => {
  it('detects token-like sk_ credentials without network access', () => {
    const result = detectDraftSecrets('use sk_live_1234567890abcdef for this request');
    assert.equal(result.confidence, 'high');
    assert.equal(result.spans.length, 1);
    assert.equal(result.spans[0]?.kind, 'sk');
  });

  it('does not flag a bare prefix or short identifier', () => {
    assert.equal(detectDraftSecrets('sk_').spans.length, 0);
    assert.equal(detectDraftSecrets('rename sk_short').spans.length, 0);
  });

  it('redacts only the detected span', () => {
    const text = 'please use sk_live_1234567890abcdef in this task';
    const result = redactDetectedSecrets(text);
    assert.equal(result, 'please use [REDACTED SECRET] in this task');
    assert.doesNotMatch(result, /sk_live/);
  });

  it('keeps warning copy independent of the detected value', () => {
    assert.match(SECRET_FIRST_CONTEXT, /provider/i);
    assert.match(SECRET_FINAL_CONTEXT, /cannot unsend/i);
    assert.doesNotMatch(SECRET_FIRST_CONTEXT, /sk_live_123456/);
    assert.doesNotMatch(SECRET_FINAL_CONTEXT, /sk_live_123456/);
  });
});

