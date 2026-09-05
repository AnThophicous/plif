import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { PolicyEngine } from '@plif/core';
import {
  DEFAULT_POLICY,
  MCP_POLICY,
  grantedTiers,
  isWorkspaceAllowed,
  type McpSecurityPolicy,
} from '../src/security.js';

function policyWith(overrides: Partial<McpSecurityPolicy>): McpSecurityPolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

describe('MCP security policy', () => {
  it('grants reading and skills by default and nothing that writes', () => {
    assert.equal(DEFAULT_POLICY.allowRead, true);
    assert.equal(DEFAULT_POLICY.allowSkills, true);
    assert.equal(DEFAULT_POLICY.allowEdit, false);
    assert.equal(DEFAULT_POLICY.allowExec, false);
    assert.deepEqual(grantedTiers(DEFAULT_POLICY), ['read', 'skills']);
  });

  it('reports the tiers an operator turned on, in cost order', () => {
    assert.deepEqual(grantedTiers(policyWith({ allowEdit: true, allowExec: true })), [
      'read',
      'skills',
      'edit',
      'exec',
    ]);
  });

  it('requires approval for served writes and execution while retaining VCS denial', () => {
    const policy = new PolicyEngine(MCP_POLICY);
    const write = policy.evaluate({
      action: 'fs.write',
      target: '/project/app.ts',
      containerId: 'test',
    });
    const remove = policy.evaluate({
      action: 'fs.delete',
      target: '/project/app.ts',
      containerId: 'test',
    });
    const git = policy.evaluate({
      action: 'fs.write',
      target: '/project/.git/index',
      containerId: 'test',
    });
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

  it('checks workspace roots by component so a sibling prefix is not inside one', () => {
    const root = path.resolve('workspace-root');
    assert.equal(isWorkspaceAllowed(root, [root]), true);
    assert.equal(isWorkspaceAllowed(path.join(root, 'nested'), [root]), true);
    assert.equal(isWorkspaceAllowed(`${root}-sibling`, [root]), false);
    assert.equal(isWorkspaceAllowed(root, []), false);
    if (process.platform === 'win32') {
      assert.equal(isWorkspaceAllowed(root.toUpperCase(), [root]), true);
    }
  });
});
