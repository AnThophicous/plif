import React from 'react';
import { Box, Text } from '../ui.js';

import type { SessionMeta } from '@plif/core';

import { sessionAge } from './Browser.js';
import { cell, rightCell, ScreenFrame } from './ScreenFrame.js';
import { color, glyph, shortenPath, truncate } from '../theme.js';

export interface SessionsScreenProps {
  readonly sessions: readonly SessionMeta[];
  readonly selected: number;
  readonly filter: string;
  /** The workspace Plif is running in; its sessions sort first. */
  readonly workspace: string;
  readonly loading: boolean;
  readonly width: number;
  readonly rows: number;
}

/** Narrow by title, model, or workspace — whatever the person remembers. */
export function filterSessions(
  sessions: readonly SessionMeta[],
  filter: string,
): readonly SessionMeta[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) =>
    session.title.toLowerCase().includes(needle) ||
    (session.modelId ?? '').toLowerCase().includes(needle) ||
    session.workspace.toLowerCase().includes(needle));
}

/**
 * Conversations in this workspace, and how to get back into one.
 *
 * `/sessions` used to open the extension browser on its fourth tab, next to
 * MCP servers and a three-thousand-entry plugin catalogue. Resuming yesterday's
 * work is not an extension-management task and does not belong behind those
 * tabs; it is frequent enough to deserve its own screen and its own first row.
 *
 * The title is what a session is called, so it gets the space. Age and size sit
 * in fixed right-hand columns where they can be compared down the column rather
 * than read per row.
 */
export function SessionsScreen({
  sessions,
  selected,
  filter,
  workspace,
  loading,
  width,
  rows,
}: SessionsScreenProps): React.ReactElement {
  const contentWidth = Math.max(24, width - 4);
  const visible = filterSessions(sessions, filter);
  const active = visible[Math.min(selected, Math.max(0, visible.length - 1))];
  const ageWidth = 10;
  const turnsWidth = 8;
  const titleWidth = Math.max(12, contentWidth - 2 - ageWidth - turnsWidth - 2);
  const listRows = Math.max(3, rows - 12);
  const start = Math.max(0, Math.min(selected - listRows + 2, visible.length - listRows));

  return (
    <ScreenFrame
      title="Sessions"
      badge={loading ? 'reading…' : `${sessions.length} in history`}
      {...(filter.trim() ? { subtitle: `filter: ${filter}` } : {})}
      keys={['↑↓ move', 'Enter resume', 'F fork', 'D delete', 'Esc close']}
      width={width}
      rows={rows}
    >
      <Box>
        <Text color={color('faint')}>{cell('  conversation', titleWidth + 2)}</Text>
        <Text color={color('faint')}>{rightCell('last used', ageWidth)}</Text>
        <Text color={color('faint')}>{rightCell('turns', turnsWidth)}</Text>
      </Box>

      {loading ? (
        <Text color={color('faint')}>reading session history…</Text>
      ) : visible.length === 0 ? (
        <Text color={color('faint')}>
          {filter.trim()
            ? 'nothing matches that filter'
            : 'no saved conversations yet — this one is saved when it has a first message'}
        </Text>
      ) : (
        visible.slice(start, start + listRows).map((session, index) => {
          const isActive = start + index === selected;
          const elsewhere = session.workspace !== workspace;
          return (
            <Box key={session.id} width={contentWidth}>
              <Text color={isActive ? color('accentBright') : color('ghost')}>
                {cell(isActive ? glyph.caret : ' ', 2)}
              </Text>
              <Text color={color(isActive ? 'accentBright' : elsewhere ? 'muted' : 'text')} bold={isActive}>
                {cell(truncate(session.title || 'untitled', titleWidth - 1), titleWidth)}
              </Text>
              <Text color={color('ghost')}>{rightCell(sessionAge(session.updatedAt), ageWidth)}</Text>
              <Text color={color('ghost')}>{rightCell(String(session.turns), turnsWidth)}</Text>
            </Box>
          );
        })
      )}

      {active && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={color('ghost')}>{'─'.repeat(contentWidth)}</Text>
          <Text color={color('accentBright')} bold>
            {truncate(active.title || 'untitled', contentWidth)}
          </Text>
          <Box>
            <Text color={color('muted')}>
              {[active.providerId, active.modelId].filter(Boolean).join(' · ') || 'model not recorded'}
            </Text>
            {active.container && (
              <Text color={color('ghost')}>{`  ·  container ${active.container}`}</Text>
            )}
            <Text color={color('ghost')}>{`  ·  ${active.closedAt ? 'closed' : 'interrupted'}`}</Text>
          </Box>
          <Text color={color('faint')}>
            {truncate(shortenPath(active.workspace, Math.max(20, contentWidth - 10)), contentWidth)}
          </Text>
        </Box>
      )}
    </ScreenFrame>
  );
}
