import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { browserTabLabel, mcpActionHint, mcpStatusKind, sessionAge, sortMcpStatuses } from '../src/components/Browser.js';
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

  it('shows only actions that apply to the selected MCP state', () => {
    assert.equal(mcpActionHint(null), 'C connect a server');
    assert.equal(mcpActionHint(status('up', true, '2 tools')), 'D disconnect · T test connection');
    assert.equal(mcpActionHint(status('off', false, 'not connected')), 'C connect · A authenticate · T test connection');
  });

  it('keeps session age compact enough for a navigator row', () => {
    const now = Date.parse('2026-08-17T12:00:00.000Z');
    assert.equal(sessionAge('2026-08-17T11:59:40.000Z', now), 'now');
    assert.equal(sessionAge('2026-08-17T11:42:00.000Z', now), '18m');
    assert.equal(sessionAge('2026-08-17T09:00:00.000Z', now), '3h');
  });

  it('uses compact tab labels before the tab bar can overflow', () => {
    assert.equal(browserTabLabel('marketplace', 40), 'Market');
    assert.equal(browserTabLabel('marketplace', 100), 'Marketplace');
  });
});
