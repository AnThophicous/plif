import React from 'react';
import { Box, Text } from '../ui.js';

import type { UsageInfo, UsageWindow } from '@plif/core';

import { cell, Meter, rightCell, ScreenFrame, SectionLabel } from './ScreenFrame.js';
import { effortDisplay } from '../effort-visuals.js';
import type { SessionUsage } from '../status.js';
import { color, formatCount, formatDuration, truncate } from '../theme.js';

export interface UsageScreenProps {
  readonly info: UsageInfo | null;
  readonly session: SessionUsage;
  readonly contextUsed: number;
  readonly contextMax: number;
  readonly elapsedMs: number;
  readonly effort?: string;
  readonly loading: boolean;
  readonly problem?: string | null;
  readonly width: number;
  readonly rows: number;
}

/** Percentage a window is *consumed*, whichever fields the provider published. */
export function windowPercent(window: UsageWindow): number | null {
  if (window.unlimited === true || window.limit === 'unlimited') return null;
  if (typeof window.percentage === 'number') return clampPercent(window.percentage);
  const limit = typeof window.limit === 'number' ? window.limit : null;
  if (limit === null || limit <= 0) return null;
  const used = typeof window.used === 'number'
    ? window.used
    : typeof window.remaining === 'number'
      ? limit - window.remaining
      : null;
  return used === null ? null : clampPercent((used / limit) * 100);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** How a window's numbers read once the provider's gaps are accounted for. */
export function windowAmount(window: UsageWindow): string {
  const unit = window.unit === 'unknown' ? '' : window.unit;
  if (window.unlimited === true || window.limit === 'unlimited') {
    return `unlimited${unit ? ` ${unit}` : ''}`;
  }
  const limit = typeof window.limit === 'number' ? window.limit : null;
  const used = typeof window.used === 'number'
    ? window.used
    : limit !== null && typeof window.remaining === 'number'
      ? limit - window.remaining
      : null;
  if (limit === null) {
    return used === null ? 'not published' : `${formatCount(used)}${unit ? ` ${unit}` : ''}`;
  }
  const prefix = used === null ? '?' : formatCount(used);
  return `${prefix} / ${formatCount(limit)}${unit ? ` ${unit}` : ''}`;
}

/** Time until a window resets, or an empty string when it never says. */
export function windowReset(window: UsageWindow, now = Date.now()): string {
  if (!window.resetAt) return '';
  const at = Date.parse(window.resetAt);
  if (!Number.isFinite(at)) return '';
  const remaining = at - now;
  return remaining <= 0 ? 'resetting' : `resets in ${formatDuration(remaining)}`;
}

/** Tone for a consumption bar: quiet until it is worth worrying about. */
export function usageTone(percent: number | null): Parameters<typeof color>[0] {
  if (percent === null) return 'muted';
  if (percent >= 90) return 'danger';
  if (percent >= 75) return 'warn';
  return 'accentBright';
}

/**
 * Everything the session has spent, on one screen.
 *
 * Before this, `/usage` opened a menu of three views, each of which printed a
 * line of text into the transcript — so comparing what the provider allows
 * against what this session has used meant running two commands and scrolling
 * between their answers. They are the same question and they belong on the
 * same screen.
 *
 * What is never done here is inventing a number. A provider that publishes no
 * ceiling gets "not published", not a bar at an imagined maximum.
 */
export function UsageScreen({
  info,
  session,
  contextUsed,
  contextMax,
  elapsedMs,
  effort,
  loading,
  problem,
  width,
  rows,
}: UsageScreenProps): React.ReactElement {
  const contentWidth = Math.max(24, width - 4);
  const labelWidth = Math.min(22, Math.max(12, Math.floor(contentWidth * 0.2)));
  const meterCells = Math.min(28, Math.max(10, Math.floor(contentWidth * 0.22)));
  const contextPercent = contextMax > 0
    ? clampPercent((contextUsed / contextMax) * 100)
    : 0;
  const badge = info
    ? `${info.provider} · ${info.model}`
    : loading ? 'reading provider…' : 'no model configured';

  return (
    <ScreenFrame
      title="Usage"
      badge={badge}
      {...(effort ? { subtitle: `effort ${effortDisplay(effort)} · session running ${formatDuration(elapsedMs)}` } : {})}
      keys={['R refresh', 'Esc close']}
      width={width}
      rows={rows}
    >
      <SectionLabel>Context</SectionLabel>
      <Box>
        <Text color={color('muted')}>{cell('window', labelWidth)}</Text>
        <Meter value={contextUsed} max={contextMax} cells={meterCells} tone={usageTone(contextPercent)} />
        <Text color={color('text')}>{`  ${contextPercent}%`}</Text>
        <Text color={color('ghost')}>
          {contextMax > 0
            ? `  ${formatCount(contextUsed)} / ${formatCount(contextMax)} tokens`
            : '  no context ceiling reported'}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <SectionLabel>This session</SectionLabel>
        <Box>
          <Text color={color('muted')}>{cell('tokens', labelWidth)}</Text>
          <Text color={color('text')}>
            {`${formatCount(session.inputTokens)} in  ·  ${formatCount(session.outputTokens)} out`}
          </Text>
          <Text color={color('ghost')}>
            {`  ·  ${formatCount(session.inputTokens + session.outputTokens)} total`}
          </Text>
        </Box>
        <Box>
          <Text color={color('muted')}>{cell('activity', labelWidth)}</Text>
          <Text color={color('text')}>
            {`${session.requests} requests  ·  ${session.turns} turns  ·  ${session.toolCalls} tool calls`}
          </Text>
        </Box>
        {session.subagentRuns > 0 && (
          <Box>
            <Text color={color('muted')}>{cell('subagents', labelWidth)}</Text>
            <Text color={color('text')}>
              {`${session.subagentRuns} runs  ·  ${formatCount(session.subagentTokens)} tokens`}
            </Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <SectionLabel>Provider limits</SectionLabel>
        {problem ? (
          <Text color={color('danger')}>{truncate(problem, contentWidth)}</Text>
        ) : loading ? (
          <Text color={color('faint')}>reading the provider's latest response…</Text>
        ) : info === null || info.windows.length === 0 ? (
          <Text color={color('faint')}>
            {truncate(
              info?.detail ?? 'This provider publishes no limit data. Nothing is inferred.',
              contentWidth,
            )}
          </Text>
        ) : (
          info.windows.map((window) => {
            const percent = windowPercent(window);
            const reset = windowReset(window);
            return (
              <Box key={`${window.type}:${window.unit}`}>
                <Text color={color('muted')}>{cell(window.type, labelWidth)}</Text>
                {percent === null ? (
                  <Text color={color('ghost')}>{'░'.repeat(meterCells)}</Text>
                ) : (
                  <Meter value={percent} max={100} cells={meterCells} tone={usageTone(percent)} />
                )}
                <Text color={color(percent === null ? 'muted' : 'text')}>
                  {rightCell(percent === null ? '—' : `${percent}%`, 5)}
                </Text>
                <Text color={color('ghost')}>{`  ${windowAmount(window)}`}</Text>
                {reset && <Text color={color('faint')}>{`  ·  ${reset}`}</Text>}
              </Box>
            );
          })
        )}
        {info?.source && (
          <Text color={color('faint')}>
            {`source: ${info.source === 'config' ? 'provider policy in config — live counters unavailable' : 'provider metadata from the latest response'}`}
          </Text>
        )}
      </Box>
    </ScreenFrame>
  );
}
