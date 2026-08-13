import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseArgv } from '../src/argv.js';

const cwd = 'C:\\workspace';

describe('session continuation arguments', () => {
  it('continues the latest session when no id is provided', () => {
    const invocation = parseArgv(['continue'], cwd);

    assert.equal(invocation.kind, 'continue');
    if (invocation.kind !== 'continue') assert.fail('expected a continue invocation');
    assert.equal(invocation.id, null);
  });

  it('accepts a session id or prefix after continue', () => {
    const invocation = parseArgv(['continue', 'abc123'], cwd);

    assert.equal(invocation.kind, 'continue');
    if (invocation.kind !== 'continue') assert.fail('expected a continue invocation');
    assert.equal(invocation.id, 'abc123');
  });

  it('keeps resume with a session id as an alias', () => {
    const invocation = parseArgv(['resume', 'abc123'], cwd);

    assert.equal(invocation.kind, 'resume');
    if (invocation.kind !== 'resume') assert.fail('expected a resume invocation');
    assert.equal(invocation.id, 'abc123');
  });
});
