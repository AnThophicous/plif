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

describe('web command arguments and env variables', () => {
  it('uses default host, port and max-sessions when none provided', () => {
    const origHost = process.env['PLIF_WEB_HOST'];
    const origPort = process.env['PLIF_WEB_PORT'];
    const origMax = process.env['PLIF_WEB_MAX_SESSIONS'];
    delete process.env['PLIF_WEB_HOST'];
    delete process.env['PLIF_WEB_PORT'];
    delete process.env['PLIF_WEB_MAX_SESSIONS'];

    try {
      const invocation = parseArgv(['web'], cwd);
      assert.equal(invocation.kind, 'web');
      if (invocation.kind === 'web') {
        assert.equal(invocation.host, '127.0.0.1');
        assert.equal(invocation.port, 4173);
        assert.equal(invocation.maxSessions, 4);
      }
    } finally {
      if (origHost !== undefined) process.env['PLIF_WEB_HOST'] = origHost;
      if (origPort !== undefined) process.env['PLIF_WEB_PORT'] = origPort;
      if (origMax !== undefined) process.env['PLIF_WEB_MAX_SESSIONS'] = origMax;
    }
  });

  it('reads PLIF_WEB_HOST, PLIF_WEB_PORT and PLIF_WEB_MAX_SESSIONS from environment', () => {
    process.env['PLIF_WEB_HOST'] = '0.0.0.0';
    process.env['PLIF_WEB_PORT'] = '8088';
    process.env['PLIF_WEB_MAX_SESSIONS'] = '10';

    try {
      const invocation = parseArgv(['web'], cwd);
      assert.equal(invocation.kind, 'web');
      if (invocation.kind === 'web') {
        assert.equal(invocation.host, '0.0.0.0');
        assert.equal(invocation.port, 8088);
        assert.equal(invocation.maxSessions, 10);
      }
    } finally {
      delete process.env['PLIF_WEB_HOST'];
      delete process.env['PLIF_WEB_PORT'];
      delete process.env['PLIF_WEB_MAX_SESSIONS'];
    }
  });

  it('lets CLI flags override environment variables', () => {
    process.env['PLIF_WEB_HOST'] = '0.0.0.0';
    process.env['PLIF_WEB_PORT'] = '8088';
    process.env['PLIF_WEB_MAX_SESSIONS'] = '10';

    try {
      const invocation = parseArgv(
        ['web', '--host', '192.168.1.100', '--port', '9000', '--max-sessions', '2'],
        cwd,
      );
      assert.equal(invocation.kind, 'web');
      if (invocation.kind === 'web') {
        assert.equal(invocation.host, '192.168.1.100');
        assert.equal(invocation.port, 9000);
        assert.equal(invocation.maxSessions, 2);
      }
    } finally {
      delete process.env['PLIF_WEB_HOST'];
      delete process.env['PLIF_WEB_PORT'];
      delete process.env['PLIF_WEB_MAX_SESSIONS'];
    }
  });
});
