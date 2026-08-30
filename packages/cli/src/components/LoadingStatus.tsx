import React, { useEffect, useState } from 'react';
import { Box, Text } from '../ui.js';

import { activityColorAt, activityGlyphAt, activityKindForLabel, activityVisual, GradientText } from '../activity-visuals.js';
import { useAnimationFrame } from '../hooks/useAnimationClock.js';
import {
  elapsedSince,
  formatLoadingDuration,
  formatLoadingTokens,
  loadingVerbAt,
  monotonicNow,
  type LoadingPhase,
  type LoadingSnapshot,
  useLoadingSnapshot,
} from '../loading-state.js';
import { displayWidth } from '../text.js';
import { color, glyph } from '../theme.js';

const INTERRUPT_HINT = 'Ctrl+C to interrupt';
const SHORT_INTERRUPT_HINT = 'Ctrl+C';

interface LoadingStatusProps {
  readonly active: boolean;
  readonly operationId: number;
  readonly width: number;
}

interface LoadingField {
  readonly text: string;
  readonly tone: 'ghost' | 'muted' | 'accentBright';
}

interface LoadingLayout {
  readonly verb: string;
  readonly fields: readonly LoadingField[];
  readonly parenthesized: boolean;
}

/**
 * The complete operational line. Its parent subscribes only to semantic
 * loading changes; each child owns the clock cadence for its own concern.
 */
export const LoadingStatus = React.memo(function LoadingStatus({
  active,
  operationId,
  width,
}: LoadingStatusProps): React.ReactElement | null {
  const snapshot = useLoadingSnapshot(active);
  if (!active || snapshot.operationId !== operationId || snapshot.phase === 'idle' || snapshot.phase === 'done' || snapshot.phase === 'error') {
    return null;
  }

  return (
    <Box width="100%" height={1} flexShrink={0}>
      <ActivityLoadingLabel
        active={active}
        operationId={snapshot.operationId}
        phase={snapshot.phase}
        startedAt={snapshot.startedAt}
        width={width}
      />
      <LoadingMetrics active snapshot={snapshot} width={width} />
    </Box>
  );
});

LoadingStatus.displayName = 'LoadingStatus';

const ActivityLoadingLabel = React.memo(function ActivityLoadingLabel({
  active,
  operationId,
  phase,
  startedAt,
  width,
}: {
  readonly active: boolean;
  readonly operationId: number;
  readonly phase: LoadingPhase;
  readonly startedAt: number | null;
  readonly width: number;
}): React.ReactElement {
  // The clock only schedules a repaint. Operation elapsed time is the source
  // of truth, so glyph and luminance stay in phase with the loading verb.
  useAnimationFrame(active, 'slow');
  const elapsed = startedAt === null ? 0 : elapsedSince(startedAt, monotonicNow());
  const candidate = phase === 'cancelling'
    ? 'Cancelling'
    : loadingVerbAt(elapsed, operationId);
  const kind = activityKindForLabel(candidate);
  const visual = activityVisual(kind);
  const glyphText = activityGlyphAt(kind, elapsed, active);
  const glyphColor = activityColorAt(kind, elapsed);
  const label = displayWidth(`${glyphText} ${candidate}…`) <= Math.max(12, width) ? candidate : 'Working';
  return (
    <Text>
      <Text color={glyphColor} bold>{glyphText}</Text>
      <Text> </Text>
      <GradientText value={label} from={visual.gradient[0]} to={visual.gradient[1]} bold />
      <Text color={color('muted')}>…</Text>
    </Text>
  );
});

const LoadingMetrics = React.memo(function LoadingMetrics({
  active,
  snapshot,
  width,
}: {
  readonly active: boolean;
  readonly snapshot: LoadingSnapshot;
  readonly width: number;
}): React.ReactElement {
  // The spinner samples the shared 120ms clock. Metrics do not: their visible
  // values change at whole-second boundaries, so a dedicated one-second tick
  // avoids repainting this row eight times for the same displayed value.
  useSecondTick(active);
  const now = monotonicNow();
  const elapsed = elapsedSince(snapshot.startedAt, now);
  const reasoningMs = snapshot.reasoningMs + elapsedSince(snapshot.reasoningStartedAt, now);
  const glyphText = activityGlyphAt('thinking', 0, false);
  const verb = snapshot.phase === 'cancelling' ? 'Cancelling' : loadingVerbAt(elapsed, snapshot.operationId);
  const tool = activeToolLabel(snapshot);
  const layout = loadingLayout(width, snapshot, elapsed, reasoningMs, glyphText, verb, tool);
  const metadata = layout.fields.length > 0;

  return (
    <Text>
      {metadata && <Text color={color('ghost')}>{layout.parenthesized ? ' (' : ` ${glyph.divider} `}</Text>}
      {layout.fields.map((field, index) => (
        <React.Fragment key={`${field.text}:${index}`}>
          {index > 0 && <Text color={color('ghost')}> {glyph.divider} </Text>}
          <Text color={color(field.tone)}>{field.text}</Text>
        </React.Fragment>
      ))}
      {metadata && layout.parenthesized && <Text color={color('ghost')}>)</Text>}
    </Text>
  );
});

LoadingMetrics.displayName = 'LoadingMetrics';

function useSecondTick(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [active]);
  return tick;
}

function loadingLayout(
  width: number,
  snapshot: LoadingSnapshot,
  elapsedMs: number,
  reasoningMs: number,
  glyphText: string,
  verb: string,
  tool?: string | null,
): LoadingLayout {
  const safeWidth = Math.max(12, width);
  const base = `${glyphText} ${verb}…`;
  const elapsed = formatLoadingDuration(elapsedMs);
  const token = snapshot.tokenSource === 'pending'
    ? '↓ tokens pending'
    : `↓ ${snapshot.estimatedTokens ? '~' : ''}${formatLoadingTokens(snapshot.tokens)} tokens`;
  const compactToken = snapshot.tokenSource === 'pending'
    ? '↓ pending'
    : `↓${snapshot.estimatedTokens ? '~' : ''}${formatLoadingTokens(snapshot.tokens)}`;
  const reasoning = reasoningMs > 0
    ? snapshot.reasoningStartedAt !== null
      ? `thinking ${formatLoadingDuration(reasoningMs)}`
      : `thought for ${formatLoadingDuration(reasoningMs)}`
    : null;
  const activeTool = tool ?? activeToolLabel(snapshot);

  const candidates: readonly LoadingField[][] = [
    [
      { text: INTERRUPT_HINT, tone: 'ghost' },
      { text: elapsed, tone: 'muted' },
      ...(token ? [{ text: token, tone: 'accentBright' as const }] : []),
      ...(reasoning ? [{ text: reasoning, tone: 'muted' as const }] : []),
      ...(activeTool ? [{ text: activeTool, tone: 'muted' as const }] : []),
    ],
    [
      { text: SHORT_INTERRUPT_HINT, tone: 'ghost' },
      { text: elapsed, tone: 'muted' },
      { text: compactToken, tone: 'accentBright' as const },
      ...(reasoning ? [{ text: reasoning.replace('thought for ', 'thought '), tone: 'muted' as const }] : []),
      ...(activeTool ? [{ text: activeTool, tone: 'muted' as const }] : []),
    ],
    [
      { text: elapsed, tone: 'muted' },
      { text: compactToken, tone: 'accentBright' as const },
      ...(activeTool ? [{ text: activeTool, tone: 'muted' as const }] : []),
    ],
    [{ text: elapsed, tone: 'muted' }],
    [],
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const fields = candidates[index]!;
    const parenthesized = index < 2;
    const metadata = fields.map((field) => field.text).join(` ${glyph.divider} `);
    const full = `${base}${fields.length > 0 ? parenthesized ? ` (${metadata})` : ` ${glyph.divider} ${metadata}` : ''}`;
    if (displayWidth(full) <= safeWidth) return { verb, fields, parenthesized };
  }

  // Very narrow terminals keep the operation readable and never split a verb
  // in the middle. `Work` is the compact semantic fallback, not a truncation.
  const compactVerb = displayWidth(`${glyphText} Work…`) <= safeWidth ? 'Work' : '';
  return {
    verb: compactVerb,
    fields: [],
    parenthesized: false,
  };
}

export function loadingLayoutForTest(
  width: number,
  snapshot: LoadingSnapshot,
  elapsedMs: number,
  reasoningMs = snapshot.reasoningMs,
): LoadingLayout {
  const glyphText = activityGlyphAt('thinking', 0, false);
  const verb = snapshot.phase === 'cancelling' ? 'Cancelling' : loadingVerbAt(elapsedMs, snapshot.operationId);
  return loadingLayout(width, snapshot, elapsedMs, reasoningMs, glyphText, verb);
}

function activeToolLabel(snapshot: LoadingSnapshot): string | null {
  const tools = snapshot.activeTools ?? [];
  if (tools.length === 0) return null;
  const current = tools.at(-1)?.name?.replace(/\s+/g, ' ').trim() || 'tool';
  const short = current.length > 24 ? `${current.slice(0, 23)}…` : current;
  return tools.length === 1 ? `${glyph.tool} ${short}` : `${glyph.tool} ${short} +${tools.length - 1}`;
}
