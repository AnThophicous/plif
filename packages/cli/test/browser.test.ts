import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mcpStatusKind, sortMcpStatuses } from '../src/components/Browser.js';
import type { McpServerStatus } from '@plif/core';

const status = (name: string, connected: boolean, detail: string): McpServerStatus => ({
  name,
  transport: 'http',
  connected,
  toolCount: connected ? 2 : 0,
  detail,
});

describe('MCP browser status', () => {
  it('distinguishes connected, disconnected and failed servers', () => {
    assert.equal(mcpStatusKind(status('up', true, '2 tools')), 'connected');
    assert.equal(mcpStatusKind(status('off', false, 'not connected')), 'disconnected');
    assert.equal(mcpStatusKind(status('pending', false, 'connecting')), 'disconnected');
    assert.equal(mcpStatusKind(status('bad', false, '401 rejected the key')), 'error');
  });

  it('keeps connected servers first, then disconnected, then errors', () => {
    const ordered = sortMcpStatuses([
      status('bad', false, '401 rejected the key'),
      status('off', false, 'not connected'),
      status('up', true, '2 tools'),
    ]);
    assert.deepEqual(ordered.map((item) => item.name), ['up', 'off', 'bad']);
  });
});
