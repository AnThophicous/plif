import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { PolicyEngine } from '@plif/core';
import { ACP_POLICY, DEFAULT_POLICY, isWorkspaceAllowed } from '../src/security.js';

describe('ACP security policy', () => {
  it('keeps host-controlled edit and bypass modes opt-in only', () => {
    assert.equal(DEFAULT_POLICY.allowAcceptEdits, false);
    assert.equal(DEFAULT_POLICY.allowBypassPermissions, false);
  });

  it('requires approval for host-backed writes while retaining VCS denial', () => {
    const policy = new PolicyEngine(ACP_POLICY);
    const write = policy.evaluate({ action: 'fs.write', target: '/project/app.ts', containerId: 'test' });
    const remove = policy.evaluate({ action: 'fs.delete', target: '/project/app.ts', containerId: 'test' });
    const git = policy.evaluate({ action: 'fs.write', target: '/project/.git/index', containerId: 'test' });
    const command = policy.evaluate({
      action: 'exec',
      target: 'node',
      argv: ['node', '-e', 'require("fs").writeFileSync("app.ts", "pwned")'],
      containerId: 'test',
    });

    assert.equal(write.decision, 'ask');
    assert.equal(remove.decision, 'ask');
    assert.equal(git.decision, 'deny');
    assert.equal(command.decision, 'ask');
  });

  it('checks workspace roots by component and accepts Windows case folding', () => {
    const root = path.resolve('workspace-root');
    assert.equal(isWorkspaceAllowed(root, [root]), true);
    assert.equal(isWorkspaceAllowed(path.join(root, 'nested'), [root]), true);
    assert.equal(isWorkspaceAllowed(`${root}-sibling`, [root]), false);
    if (process.platform === 'win32') {
      assert.equal(isWorkspaceAllowed(root.toUpperCase(), [root]), true);
    }
  });
});
