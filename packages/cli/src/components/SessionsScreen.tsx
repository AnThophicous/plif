import React from 'react';
import { Box, Text } from '../ui.js';

import type { SessionMeta } from '@plif/core';

import { sessionAge } from './Browser.js';
import { ScreenFrame, cell, rightCell } from './ScreenFrame.js';
import { displayWidth } from '../text.js';
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

/**
 * The list never grows past this, however wide the terminal is.
 *
 * An unbounded row put the title at the far left and its age at the far right
 * with most of a screen of nothing between them, so reading one session meant
 * tracking across an empty line. A card has a width; this is it.
 */
const MAX_LIST_WIDTH = 88;

/** Narrow by title, model, or workspace — whatever the person remembers. */
let lastFilter: {
  readonly sessions: readonly SessionMeta[];
  readonly needle: string;
  readonly result: readonly SessionMeta[];
} | null = null;

export function filterSessions(
  sessions: readonly SessionMeta[],
  filter: string,
): readonly SessionMeta[] {
  const needle = filter.trim().toLowerCase();
  if (lastFilter?.sessions === sessions && lastFilter.needle === needle) return lastFilter.result;
  const result = !needle ? sessions : sessions.filter((session) =>
    session.title.toLowerCase().includes(needle) ||
    (session.modelId ?? '').toLowerCase().includes(needle) ||
    session.workspace.toLowerCase().includes(needle));
  lastFilter = { sessions, needle, result };
  return result;
}

export type SessionBucket = 'Today' | 'Yesterday' | 'Earlier this week' | 'Older';

/**
 * Which heading a session belongs under.
 *
 * A column with the word "yesterday" repeated eighteen times carries no
 * information. Said once, as a heading, it splits the list into the groups a
 * person actually thinks in.
 */
export function sessionBucket(updatedAt: string, now = Date.now()): SessionBucket {
  // Calendar days, not elapsed hours. Something from 18:00 last night is
  // "yesterday" to the person who wrote it, even though it is barely eighteen
  // hours old, and an elapsed-time rule files it under Today — which is
  // exactly the mismatch these headings exist to avoid.
  const midnight = (at: number): number => {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((midnight(now) - midnight(Date.parse(updatedAt))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  return 'Older';
}

export interface SessionListRow {
  readonly kind: 'heading' | 'session';
  readonly bucket?: SessionBucket;
  readonly session?: SessionMeta;
  /** Index into the filtered session array; headings carry none. */
  readonly index?: number;
}

/** How a turn count is written in a row. */
export function turnsLabel(turns: number): string {
  return turns === 1 ? '1 turn' : `${turns} turns`;
}

/**
 * The width of the two right-hand columns, measured across the whole list.
 *
 * Sizing them per row is what made the column ragged: "now" and "yesterday"
 * are six characters apart, so every row started its metadata at a different
 * column and the dividers zig-zagged down the screen. One measurement for the
 * list gives one straight edge.
 */
export function metaColumns(
  sessions: readonly SessionMeta[],
  now = Date.now(),
): {
  readonly age: number;
  readonly turns: number;
} {
  let age = 0;
  let turns = 0;
  for (const session of sessions) {
    age = Math.max(age, displayWidth(sessionAge(session.updatedAt, now)));
    turns = Math.max(turns, displayWidth(turnsLabel(session.turns)));
  }
  return { age: Math.max(3, age), turns: Math.max(6, turns) };
}

/** Interleave group headings into the session list, preserving order. */
export function sessionRows(
  sessions: readonly SessionMeta[],
  now = Date.now(),
): readonly SessionListRow[] {
  const rows: SessionListRow[] = [];
  let current: SessionBucket | null = null;
  sessions.forEach((session, index) => {
    const bucket = sessionBucket(session.updatedAt, now);
    if (bucket !== current) {
      rows.push({ kind: 'heading', bucket });
      current = bucket;
    }
    rows.push({ kind: 'session', session, index });
  });
  return rows;
}

/** Row position of each selectable session after headings are interleaved. */
export function sessionRowPositions(rows: readonly SessionListRow[]): ReadonlyMap<number, number> {
  const positions = new Map<number, number>();
  rows.forEach((row, position) => {
    if (row.kind === 'session' && row.index !== undefined) positions.set(row.index, position);
  });
  return positions;
}

/**
 * Conversations in this workspace, and how to get back into one.
 *
 * Presented as a list of cards rather than a table. The table spread four
 * right-aligned columns across the whole terminal and made resuming yesterday's
 * work look like reading a directory listing. What a person needs here is to
 * recognise a conversation — its title, its age, how far it got — close enough
 * together to take in at one glance.
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
  const listWidth = Math.min(contentWidth, MAX_LIST_WIDTH);
  const visible = React.useMemo(() => filterSessions(sessions, filter), [sessions, filter]);
  const active = visible[Math.min(selected, Math.max(0, visible.length - 1))];

  const columns = React.useMemo(() => metaColumns(visible), [visible]);
  const all = React.useMemo(() => sessionRows(visible), [visible]);
  const positions = React.useMemo(() => sessionRowPositions(all), [all]);
  const listRows = Math.max(4, rows - 14);
  // Scroll by row, not by session, so a heading never pushes the selection out
  // of the window it is supposed to keep visible.
  const selectedRow = positions.get(selected) ?? -1;
  const start = Math.max(0, Math.min(
    Math.max(0, selectedRow - listRows + 2),
    Math.max(0, all.length - listRows),
  ));
  const window = all.slice(start, start + listRows);

  return (
    <ScreenFrame
      title="Sessions"
      badge={loading ? 'reading…' : `${sessions.length} saved`}
      {...(filter.trim() ? { subtitle: `filter: ${filter}` } : {})}
      keys={['↑↓ move', 'Enter resume', 'F fork', 'D delete', 'Esc close']}
      width={width}
      rows={rows}
    >
      {loading ? (
        <Text color={color('faint')}>reading session history…</Text>
      ) : visible.length === 0 ? (
        <Text color={color('faint')}>
          {filter.trim()
            ? 'nothing matches that filter'
            : 'no saved conversations yet — this one is saved when it has a first message'}
        </Text>
      ) : (
        window.map((row, position) =>
          row.kind === 'heading' ? (
            <Box key={`h:${row.bucket}:${position}`} marginTop={position === 0 ? 0 : 1}>
              <Text color={color('accentDim')} bold>{row.bucket}</Text>
            </Box>
          ) : (
            <SessionRow
              key={row.session?.id ?? position}
              session={row.session as SessionMeta}
              active={row.index === selected}
              elsewhere={(row.session as SessionMeta).workspace !== workspace}
              width={listWidth}
              columns={columns}
            />
          ),
        )
      )}

      {active && <SessionCard session={active} width={listWidth} />}
    </ScreenFrame>
  );
}

/**
 * One session, as a row that fills when selected.
 *
 * The whole row carries the highlight rather than a caret in the margin: a
 * lone arrow beside otherwise unchanged text is easy to lose, and the fill
 * doubles as the card edge that makes the list read as objects instead of as
 * lines of output.
 */
function SessionRow({
  session,
  active,
  elsewhere,
  width,
  columns,
}: {
  readonly session: SessionMeta;
  readonly active: boolean;
  readonly elsewhere: boolean;
  readonly width: number;
  readonly columns: { readonly age: number; readonly turns: number };
}): React.ReactElement {
  const age = rightCell(sessionAge(session.updatedAt), columns.age);
  const turns = rightCell(turnsLabel(session.turns), columns.turns);
  // rail + space + title + space + age + space + divider + space + turns.
  const fixed = columns.age + columns.turns + 6;
  const titleWidth = Math.max(8, width - fixed);
  const title = cell(truncate(session.title || 'untitled', titleWidth), titleWidth);
  const tone = active ? 'panel' : 'ghost';
  const background = active ? { backgroundColor: color('accentBright') } : {};

  return (
    <Box width={width}>
      <Text color={color(active ? 'accentBright' : 'ghost')}>{active ? '▌' : ' '}</Text>
      <Text
        color={color(active ? 'panel' : elsewhere ? 'muted' : 'text')}
        bold={active}
        {...background}
      >
        {` ${title} `}
      </Text>
      <Text color={color(tone)} {...background}>{age}</Text>
      <Text color={color(active ? 'panel' : 'faint')} {...background}>{` ${glyph.divider} `}</Text>
      <Text color={color(tone)} {...background}>{turns}</Text>
    </Box>
  );
}

/**
 * The detail of whatever is selected.
 *
 * Fields are labelled and stacked rather than run together on one line: model,
 * state and path answer different questions, and someone looking for the path
 * should not have to parse a sentence of middle dots to find it.
 */
function SessionCard({
  session,
  width,
}: {
  readonly session: SessionMeta;
  readonly width: number;
}): React.ReactElement {
  const model = [session.providerId, session.modelId].filter(Boolean).join(' · ')
    || 'model not recorded';
  const interrupted = !session.closedAt;
  const valueWidth = Math.max(12, width - 12);

  return (
    <Box flexDirection="column" marginTop={1} width={width}>
      <Text color={color('accentBright')} bold>
        {truncate(session.title || 'untitled', Math.max(8, width - 2))}
      </Text>
      <Field label="model" value={model} width={valueWidth} />
      <Field
        label="state"
        value={interrupted ? 'interrupted' : 'closed'}
        width={valueWidth}
        tone={interrupted ? 'warn' : 'success'}
      />
      {session.container && (
        <Field label="box" value={session.container} width={valueWidth} />
      )}
      <Field label="where" value={shortenPath(session.workspace, valueWidth)} width={valueWidth} />
    </Box>
  );
}

function Field({
  label,
  value,
  width,
  tone = 'muted',
}: {
  readonly label: string;
  readonly value: string;
  readonly width: number;
  readonly tone?: Parameters<typeof color>[0];
}): React.ReactElement {
  return (
    <Box>
      <Text color={color('ghost')}>{cell(label, 8)}</Text>
      <Text color={color(tone)}>{truncate(value, width)}</Text>
    </Box>
  );
}
