import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TOOLS, toolsForEnvironment, type Tool, type ToolContext } from '@plif/core';
import { DEFAULT_POLICY, type McpSecurityPolicy } from '../src/security.js';
import { callTool, describeTool, exposedTools, tierOf } from '../src/tools.js';

function policyWith(overrides: Partial<McpSecurityPolicy>): McpSecurityPolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

/** A stand-in for the container-backed context; these tests never touch a container. */
const context = {} as ToolContext;

function fakeTool(name: string, run: Tool['run']): Tool {
  return {
    spec: { name, description: `${name} for tests`, parameters: { type: 'object' } },
    run,
  };
}

describe('MCP tool exposure', () => {
  it('serves only the read and skills tiers under the default policy', () => {
    const served = exposedTools(DEFAULT_TOOLS, DEFAULT_POLICY).map((tool) => tool.spec.name);
    assert.deepEqual(served, ['read_file', 'list_dir', 'glob', 'grep']);
  });

  it('adds the write tools only when the edit tier is granted', () => {
    const served = exposedTools(DEFAULT_TOOLS, policyWith({ allowEdit: true })).map(
      (tool) => tool.spec.name,
    );
    assert.ok(served.includes('write_file'));
    assert.ok(served.includes('edit_file'));
    assert.ok(served.includes('apply_patch'));
    assert.ok(!served.includes('run_command'));
  });

  it('adds command execution only when the exec tier is granted', () => {
    const served = exposedTools(DEFAULT_TOOLS, policyWith({ allowExec: true })).map(
      (tool) => tool.spec.name,
    );
    assert.ok(served.includes('run_command'));
    assert.ok(!served.includes('write_file'));
  });

  it('never serves a loop-scoped or privilege tool, whatever the grants are', () => {
    const everything = policyWith({ allowEdit: true, allowExec: true });
    const served = new Set(
      exposedTools(toolsForEnvironment(null), everything).map((tool) => tool.spec.name),
    );
    for (const withheld of [
      'update_config',
      'get_config',
      'create_profile',
      'activate_profile',
      'ask_user',
      'update_plan',
      'set_goal',
      'start_task',
      'session_search',
      'resolve_edit_conflict',
    ]) {
      assert.ok(!served.has(withheld), `${withheld} must not be reachable over MCP`);
    }
  });

  it('drops a tool that has no tier rather than defaulting it in', () => {
    const invented = fakeTool('brand_new_tool', async () => ({ output: '', ok: true }));
    assert.equal(tierOf('brand_new_tool'), undefined);
    assert.deepEqual(
      exposedTools([invented], policyWith({ allowEdit: true, allowExec: true })),
      [],
    );
  });
});

describe('MCP tool descriptors', () => {
  it('passes the plif parameter schema through without rewriting it', () => {
    const readFile = DEFAULT_TOOLS.find((tool) => tool.spec.name === 'read_file');
    assert.ok(readFile);
    const descriptor = describeTool(readFile);
    assert.equal(descriptor.inputSchema, readFile.spec.parameters);
    assert.equal(descriptor.annotations.readOnlyHint, true);
    assert.equal(descriptor.annotations.destructiveHint, false);
    assert.equal(descriptor.annotations.openWorldHint, false);
  });

  it('marks a write destructive and an exec open-world', () => {
    const write = DEFAULT_TOOLS.find((tool) => tool.spec.name === 'write_file');
    const run = DEFAULT_TOOLS.find((tool) => tool.spec.name === 'run_command');
    assert.ok(write && run);
    assert.equal(describeTool(write).annotations.destructiveHint, true);
    assert.equal(describeTool(write).annotations.openWorldHint, false);
    assert.equal(describeTool(run).annotations.openWorldHint, true);
  });
});

describe('MCP tool calls', () => {
  it('returns a tool failure as a readable result rather than a protocol error', async () => {
    const failing = fakeTool('read_file', async () => ({ output: 'no such path', ok: false }));
    const result = await callTool(failing, {}, context);
    assert.equal(result.isError, true);
    assert.equal(result.content[0]?.text, 'no such path');
  });

  it('turns a thrown error into a tool failure carrying its message', async () => {
    const throwing = fakeTool('read_file', async () => {
      throw new Error('jail refused the path');
    });
    const result = await callTool(throwing, {}, context);
    assert.equal(result.isError, true);
    assert.equal(result.content[0]?.text, 'jail refused the path');
  });

  it('appends the diff, because MCP has no second channel to show it on', async () => {
    const editing = fakeTool('edit_file', async () => ({
      output: '1 line changed',
      ok: true,
      diff: '--- a\n+++ b',
    }));
    const result = await callTool(editing, {}, context);
    assert.equal(result.isError, false);
    assert.equal(result.content[0]?.text, '1 line changed\n\n--- a\n+++ b');
  });
});
