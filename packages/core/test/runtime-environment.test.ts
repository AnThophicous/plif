import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { safeRuntimeEnvironment } from '../src/security/runtime-environment.js';

describe('safeRuntimeEnvironment', () => {
  it('keeps process plumbing and drops ambient credentials', () => {
    const result = safeRuntimeEnvironment(
      { EXPLICIT_TOKEN: 'configured' },
      { PATH: '/bin', TEMP: '/tmp', AWS_SECRET_ACCESS_KEY: 'leak', RANDOM_SECRET: 'leak' },
    );
    assert.deepEqual(result, { PATH: '/bin', TEMP: '/tmp', EXPLICIT_TOKEN: 'configured' });
  });
});
