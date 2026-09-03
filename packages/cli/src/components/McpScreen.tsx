import React from 'react';
import { Box, Text } from '../ui.js';

import type { McpServerStatus } from '@plif/core';

import { sessionAge } from './Browser.js';
import { cell, rightCell, ScreenFrame, SectionLabel, type ScreenTab } from './ScreenFrame.js';
import { color, glyph, truncate } from '../theme.js';

export interface McpScreenProps {
  readonly servers: readonly McpServerStatus[];
  readonly selected: number;
  readonly filter: string;
  readonly width: number;
  readonly rows: number;
  readonly tabs: readonly ScreenTab[];
  readonly activeTab: string;
}

/** Narrow by name, transport or endpoint - whatever the person remembers. */
export function filterMcpServers(
  servers: readonly McpServerStatus[],
  filter: string,
): readonly McpServerStatus[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return servers;
  return servers.filter((server) =>
    server.name.toLowerCase().includes(needle)
    || server.transport.includes(needle)
    || server.endpoint.toLowerCase().includes(needle));
}

type Health = 'ok' | 'warn' | 'down';

/**
 * Three states, not two.
 *
 * `connected` alone cannot tell "working" from "configured but never reached":
 * a server that failed its handshake and one that simply has not been started
 * both report false, and they need different things done to them.
 */
export function healthOf(server: McpServerStatus): Health {
  if (server.connected) return 'ok';
  return /fail|error|refused|timed out|unauthor/i.test(server.detail) ? 'down' : 'warn';
}

const HEALTH_TONE = { ok: 'success', warn: 'warn', down: 'danger' } as const;
const HEALTH_LABEL = { ok: 'active', warn: 'idle', down: 'error' } as const;
/** Distinct shapes, so the three states survive a colourless terminal. */
const HEALTH_GLYPH: Record<Health, string> = {
  ok: glyph.live,
  warn: glyph.pending,
  down: glyph.failed,
};

/**
 * The MCP servers, what they expose, and what they have been doing.
 *
 * `/mcp` used to print a list and exit, which answered "is it connected" and
 * nothing else. The question that actually comes up is why a server that says
 * it is connected has stopped being useful, and that needs the two columns a
 * printed list cannot have: when it started, and when it last answered. A
 * server idle for an hour looks exactly like a healthy one until its last
 * activity is on screen next to it.
 */
export function McpScreen({
  servers,
  selected,
  filter,
  width,
  rows,
  tabs,
  activeTab,
}: McpScreenProps): React.ReactElement {
  const contentWidth = Math.max(24, width - 4);
  const visible = filterMcpServers(servers, filter);
  const active = visible[Math.min(selected, Math.max(0, visible.length - 1))];
  const statusWidth = 10;
  const toolsWidth = 8;
  const ageWidth = 10;
  const nameWidth = Math.max(10, Math.floor((contentWidth - statusWidth - toolsWidth - ageWidth - 2) * 0.34));
  const detailWidth = Math.max(8, contentWidth - 2 - nameWidth - statusWidth - toolsWidth - ageWidth);
  const listRows = Math.max(3, rows - 16);
  const start = Math.max(0, Math.min(selected - listRows + 2, visible.length - listRows));
  const connected = servers.filter((server) => server.connected).length;

  return (
    <ScreenFrame
      tabs={tabs}
      activeTab={activeTab}
      title="MCP"
      badge={servers.length === 0 ? 'none configured' : `${connected}/${servers.length} connected`}
      {...(filter.trim() ? { subtitle: `filter: ${filter}` } : {})}
      keys={['↑↓ move', 'r reconnect', 'Tab screen', '/ search', 'Esc close']}
      width={width}
      rows={rows}
    >
      <Box>
        <Text color={color('faint')}>{cell('  server', nameWidth + 2)}</Text>
        <Text color={color('faint')}>{cell('state', statusWidth)}</Text>
        <Text color={color('faint')}>{cell('detail', detailWidth)}</Text>
        <Text color={color('faint')}>{rightCell('tools', toolsWidth)}</Text>
        <Text color={color('faint')}>{rightCell('last used', ageWidth)}</Text>
      </Box>

      {visible.length === 0 ? (
        <Text color={color('faint')}>
          {filter.trim()
            ? 'nothing matches that filter'
            : 'no MCP servers configured - add one with `plif mcp add`'}
        </Text>
      ) : (
        visible.slice(start, start + listRows).map((server, index) => {
          const isActive = start + index === selected;
          const health = healthOf(server);
          return (
            <Box key={server.name} width={contentWidth}>
              <Text color={isActive ? color('accentBright') : color('ghost')}>
                {cell(isActive ? glyph.caret : ' ', 2)}
              </Text>
              <Text color={color(isActive ? 'accentBright' : 'text')} bold={isActive}>
                {cell(truncate(server.name, nameWidth - 1), nameWidth)}
              </Text>
              <Text color={color(HEALTH_TONE[health])}>
                {cell(`${HEALTH_GLYPH[health]} ${HEALTH_LABEL[health]}`, statusWidth)}
              </Text>
              <Text color={color('muted')}>{cell(truncate(server.detail, detailWidth - 1), detailWidth)}</Text>
              <Text color={color('ghost')}>{rightCell(String(server.toolCount), toolsWidth)}</Text>
              <Text color={color('ghost')}>
                {rightCell(server.lastActivityAt ? sessionAge(server.lastActivityAt) : '-', ageWidth)}
              </Text>
            </Box>
          );
        })
      )}

      {active && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={color('ghost')}>{'─'.repeat(contentWidth)}</Text>
          <Box>
            <Text color={color(HEALTH_TONE[healthOf(active)])}>
              {`${HEALTH_GLYPH[healthOf(active)]} `}
            </Text>
            <Text color={color('accentBright')} bold>{truncate(active.name, nameWidth + 8)}</Text>
            <Text color={color('ghost')}>{`  ·  ${active.transport}`}</Text>
            <Text color={color('ghost')}>
              {`  ·  ${active.startedAt ? `up ${sessionAge(active.startedAt)}` : 'never connected'}`}
            </Text>
          </Box>
          <Text color={color('faint')}>{truncate(active.endpoint || '-', contentWidth)}</Text>

          <Box marginTop={1}>
            <Text color={color('muted')}>{truncate(active.detail, contentWidth)}</Text>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <SectionLabel>Recent calls</SectionLabel>
            {active.recentCalls.length === 0 ? (
              <Text color={color('ghost')}>nothing called yet in this session</Text>
            ) : (
              active.recentCalls.slice(0, Math.max(1, rows - 26)).map((call, index) => (
                <Box key={`${call.tool}-${call.at}-${index}`}>
                  <Text color={color(call.ok ? 'success' : 'danger')}>
                    {cell(`  ${call.ok ? glyph.done : glyph.failed}`, 4)}
                  </Text>
                  <Text color={color('muted')}>{cell(truncate(call.tool, nameWidth + 10), nameWidth + 12)}</Text>
                  <Text color={color('ghost')}>{sessionAge(call.at)}</Text>
                </Box>
              ))
            )}
          </Box>
        </Box>
      )}
    </ScreenFrame>
  );
}
