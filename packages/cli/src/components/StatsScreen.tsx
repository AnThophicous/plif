import React from 'react';
import { Box, Text } from '../ui.js';

import type { ActivityDay, ModelStats, SessionStats, TokenTotals } from '@plif/core';
import { dayStart, totalTokens } from '@plif/core';

import { cell, ScreenFrame, type ScreenTab } from './ScreenFrame.js';
import { color, truncate, type PaletteKey } from '../theme.js';

export type StatsRange = 'all' | '7d' | '30d';
export type StatsTab = 'overview' | 'models';

export interface StatsScreenProps {
  readonly stats: SessionStats | null;
  readonly range: StatsRange;
  readonly tab: StatsTab;
  readonly loading: boolean;
  readonly problem: string | null;
  readonly width: number;
  readonly rows: number;
  readonly tabs: readonly ScreenTab[];
  readonly activeTab: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const RANGE_LABEL: Record<StatsRange, string> = {
  all: 'All time',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/**
 * The heatmap grid: one column per week, one row per weekday.
 *
 * Weeks start on Sunday so the row order matches the Mon/Wed/Fri labels every
 * contribution graph uses. The first column is padded with nulls for the days
 * before the range began, which is what keeps every later column aligned to a
 * real weekday instead of drifting by whichever day the range happened to
 * start on.
 */
export function heatmapWeeks(
  days: readonly ActivityDay[],
): readonly (readonly (ActivityDay | null)[])[] {
  if (days.length === 0) return [];
  const weeks: (ActivityDay | null)[][] = [];
  let current: (ActivityDay | null)[] = Array.from(
    { length: dayStart(days[0]!.date).getDay() },
    () => null,
  );
  for (const day of days) {
    current.push(day);
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }
  return weeks;
}

/** Five steps, so a busy day is visibly busier than a merely active one. */
const LEVELS: readonly { readonly glyph: string; readonly tone: PaletteKey }[] = [
  { glyph: '·', tone: 'ghost' },
  { glyph: '░', tone: 'accentDim' },
  { glyph: '▒', tone: 'accentStrong' },
  { glyph: '▓', tone: 'accent' },
  { glyph: '█', tone: 'accentBright' },
];

/**
 * Which step a day sits on, scaled against the busiest day in the range.
 *
 * Scaled rather than absolute: a month where three sessions is a lot and a
 * month where thirty is should both use the whole ramp, or the map washes out
 * into a single tone and stops saying anything.
 */
export function heatLevel(sessions: number, busiest: number): number {
  if (sessions <= 0) return 0;
  if (busiest <= 1) return LEVELS.length - 1;
  const ratio = Math.min(1, sessions / busiest);
  return Math.min(LEVELS.length - 1, 1 + Math.round(ratio * (LEVELS.length - 2)));
}

/** The compact forms the reference uses: `1.8k`, `557.7k`, `177.8m`. */
export function compactCount(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  return `${(value / 1_000_000_000).toFixed(1)}b`;
}

/** `1h 29m 29s`, and never a leading `0h`. */
export function humanDuration(ms: number): string {
  if (ms <= 0) return '-';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds % 60}s`);
  return parts.join(' ');
}

/** `1 day`, `2 days`. A count next to a plural noun that cannot be one reads as a bug. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** `Sep 1`, from a `YYYY-MM-DD` key. */
export function shortDay(key: string): string {
  const at = dayStart(key);
  return `${MONTHS[at.getMonth()] ?? '?'} ${at.getDate()}`;
}

function tokenLine(tokens: TokenTotals): string {
  return [
    `Input ${compactCount(tokens.input)}`,
    `Output ${compactCount(tokens.output)}`,
    `Cache read ${compactCount(tokens.cacheRead)}`,
    `Cache write ${compactCount(tokens.cacheWrite)}`,
  ].join('  ·  ');
}

/**
 * How much of the session history is worth reading back.
 *
 * The reference this follows leads with a contribution heatmap, and the reason
 * that works is that the shape of a year of work is legible before a single
 * number has been read. The figures underneath answer the two questions the
 * shape raises, how much and on what, and nothing else: anything a reader
 * would have to be told how to interpret was left out.
 */
export function StatsScreen({
  stats,
  range,
  tab,
  loading,
  problem,
  width,
  rows,
  tabs,
  activeTab,
}: StatsScreenProps): React.ReactElement {
  const contentWidth = Math.max(24, width - 4);
  const subTabs: readonly ScreenTab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'models', label: 'Models' },
  ];

  const body = (): React.ReactNode => {
    if (loading) return <Text color={color('faint')}>reading session history…</Text>;
    if (problem) return <Text color={color('danger')}>{truncate(problem, contentWidth)}</Text>;
    if (!stats || stats.sessions === 0) {
      return (
        <Text color={color('faint')}>
          no sessions in this range yet — the history fills in as you work
        </Text>
      );
    }
    return tab === 'models'
      ? <ModelBreakdown stats={stats} width={contentWidth} rows={rows} />
      : <Overview stats={stats} width={contentWidth} />;
  };

  return (
    <ScreenFrame
      tabs={tabs}
      activeTab={activeTab}
      subTabs={subTabs}
      activeSubTab={tab}
      title="Stats"
      badge={RANGE_LABEL[range]}
      keys={['↑↓ sub-tab', 'r cycle range', 'Tab screen', 'Esc close']}
      width={width}
      rows={rows}
    >
      <Box marginBottom={1}>
        {(['all', '7d', '30d'] as const).map((option, index) => (
          <Text key={option}>
            {index > 0 && <Text color={color('ghost')}>{'  ·  '}</Text>}
            <Text color={color(option === range ? 'accentBright' : 'ghost')} bold={option === range}>
              {RANGE_LABEL[option]}
            </Text>
          </Text>
        ))}
      </Box>
      {body()}
    </ScreenFrame>
  );
}

function Heatmap({
  stats,
  width,
}: {
  readonly stats: SessionStats;
  readonly width: number;
}): React.ReactElement {
  const weeks = heatmapWeeks(stats.days);
  const busiest = stats.mostActiveDay?.sessions ?? 0;
  // The label column is fixed, so a narrow terminal clips from the left: the
  // most recent weeks are the ones worth keeping.
  const columns = Math.max(8, Math.min(weeks.length, width - 6));
  const shown = weeks.slice(weeks.length - columns);

  // A month label sits over the first week that starts a new month. Labels are
  // three cells wide over one-cell columns, so one is written and the columns
  // it covers are skipped rather than overwritten.
  let monthLine = '';
  let lastMonth = -1;
  for (let index = 0; index < shown.length; index += 1) {
    const first = shown[index]!.find((day) => day !== null);
    const month = first ? dayStart(first.date).getMonth() : lastMonth;
    const starts = first !== undefined && month !== lastMonth;
    if (starts) lastMonth = month;
    // A label already written covers this column, so skip rather than
    // overwrite: the three-cell name would otherwise be cut to one.
    if (monthLine.length > index) continue;
    monthLine += starts ? (MONTHS[month] ?? '   ') : ' ';
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color('ghost')}>{cell('', 5)}</Text>
        <Text color={color('faint')}>{monthLine.slice(0, columns)}</Text>
      </Box>
      {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
        <Box key={weekday}>
          <Text color={color('faint')}>
            {cell(weekday === 1 ? 'Mon' : weekday === 3 ? 'Wed' : weekday === 5 ? 'Fri' : '', 5)}
          </Text>
          {shown.map((week, index) => {
            const day = week[weekday];
            const level = LEVELS[heatLevel(day?.sessions ?? 0, busiest)]!;
            return <Text key={index} color={color(level.tone)}>{level.glyph}</Text>;
          })}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={color('ghost')}>{cell('', 5)}</Text>
        <Text color={color('faint')}>Less </Text>
        {LEVELS.map((level, index) => (
          <Text key={index} color={color(level.tone)}>{level.glyph}</Text>
        ))}
        <Text color={color('faint')}> More</Text>
      </Box>
    </Box>
  );
}

/**
 * Two columns of figures.
 *
 * Laid out as padded strings rather than nested flex, for the reason the rest
 * of the screens are: a row whose parts size themselves steps sideways the
 * moment one value is a character longer than the last.
 */
function Facts({
  left,
  right,
  width,
}: {
  readonly left: readonly (readonly [string, string])[];
  readonly right: readonly (readonly [string, string])[];
  readonly width: number;
}): React.ReactElement {
  const half = Math.max(18, Math.floor(width / 2));
  const labelWidth = Math.max(12, Math.floor(half * 0.55));
  const count = Math.max(left.length, right.length);
  return (
    <Box flexDirection="column">
      {Array.from({ length: count }, (_unused, index) => (
        <Box key={index}>
          <Text color={color('muted')}>{cell(left[index]?.[0] ?? '', labelWidth)}</Text>
          <Text color={color('accent')}>{cell(left[index]?.[1] ?? '', half - labelWidth)}</Text>
          <Text color={color('muted')}>{cell(right[index]?.[0] ?? '', labelWidth)}</Text>
          <Text color={color('accent')}>{right[index]?.[1] ?? ''}</Text>
        </Box>
      ))}
    </Box>
  );
}

function Overview({
  stats,
  width,
}: {
  readonly stats: SessionStats;
  readonly width: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Heatmap stats={stats} width={width} />
      <Box marginTop={1}>
        <Facts
          width={width}
          left={[
            ['Favorite model:', stats.favoriteModel?.modelId ?? 'not recorded'],
            ['Sessions:', String(stats.sessions)],
            ['Active days:', `${stats.activeDays}/${stats.totalDays}`],
            ['Most active day:', stats.mostActiveDay ? shortDay(stats.mostActiveDay.date) : '-'],
          ]}
          right={[
            ['Total tokens:', compactCount(totalTokens(stats.tokens))],
            ['Longest session:', humanDuration(stats.longestSessionMs)],
            ['Longest streak:', plural(stats.longestStreak, 'day')],
            ['Current streak:', plural(stats.currentStreak, 'day')],
          ]}
        />
      </Box>
      <Text color={color('ghost')}>{truncate(tokenLine(stats.tokens), width)}</Text>
    </Box>
  );
}

function ModelBreakdown({
  stats,
  width,
  rows,
}: {
  readonly stats: SessionStats;
  readonly width: number;
  readonly rows: number;
}): React.ReactElement {
  if (stats.models.length === 0) {
    return (
      <Text color={color('faint')}>
        no token usage recorded yet — it is counted from the next turn onwards
      </Text>
    );
  }
  const listRows = Math.max(2, Math.floor((rows - 16) / 4));
  return (
    <Box flexDirection="column">
      {stats.models.slice(0, listRows).map((model) => (
        <ModelRow key={model.modelId} model={model} width={width} />
      ))}
    </Box>
  );
}

function ModelRow({
  model,
  width,
}: {
  readonly model: ModelStats;
  readonly width: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color('accentBright')}>{'● '}</Text>
        <Text color={color('text')} bold>{truncate(model.modelId, Math.max(10, width - 24))}</Text>
        <Text color={color('ghost')}>{` (${(model.share * 100).toFixed(1)}%)`}</Text>
      </Box>
      <Box>
        <Text color={color('ghost')}>{cell('', 2)}</Text>
        <Text color={color('muted')}>
          {`In: ${compactCount(model.tokens.input)}  ·  Out: ${compactCount(model.tokens.output)}`}
        </Text>
      </Box>
      <Box>
        <Text color={color('ghost')}>{cell('', 2)}</Text>
        <Text color={color('ghost')}>
          {`Cache: ${compactCount(model.tokens.cacheRead)} read  ·  ${compactCount(model.tokens.cacheWrite)} write`}
        </Text>
      </Box>
    </Box>
  );
}
