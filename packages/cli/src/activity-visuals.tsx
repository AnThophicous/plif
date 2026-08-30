import React from 'react';
import { Text } from './ui.js';

import { clusterLength, displayWidth } from './text.js';
import { mix } from './pulse.js';
import { ANIMATION_INTERVAL_MS, useAnimationFrame } from './hooks/useAnimationClock.js';
import {
  plifGlyphFallbackFrames,
  plifGlyphFramesForTerminal,
  plifGlyphPeriodMs,
  type PlifGlyphRole,
} from './plif-glyphs.js';
import { color, supportsRichGlyphs, type PaletteKey } from './theme.js';

/** Activity is the only part of the shell allowed to move while work runs. */
export type ActivityKind =
  | 'reasoning'
  | 'coding'
  | 'searching'
  | 'reading'
  | 'writing'
  | 'inspecting'
  | 'running'
  | 'cooking'
  | 'thinking';

export type ActivityAnimationMode = 'cycle' | 'static';

export interface ActivityVisual {
  readonly glyph: string;
  readonly fallbackGlyph: string;
  readonly label: string;
  readonly gradient: readonly [PaletteKey, PaletteKey];
  readonly frames: readonly string[];
  readonly fallbackFrames: readonly string[];
  readonly periodMs: number;
  readonly animationMode: ActivityAnimationMode;
}

function visual(
  label: string,
  gradient: readonly [PaletteKey, PaletteKey],
  role: PlifGlyphRole,
): ActivityVisual {
  const frames = plifGlyphFramesForTerminal(role, true);
  const fallbackFrames = plifGlyphFallbackFrames(role);
  return {
    glyph: frames[0] ?? '·',
    fallbackGlyph: fallbackFrames[0] ?? '.',
    label,
    gradient,
    frames,
    fallbackFrames,
    periodMs: plifGlyphPeriodMs(role),
    animationMode: 'cycle',
  };
}

/** The single semantic registry consumed by loading, thinking and work rows. */
export const activityVisuals: Readonly<Record<ActivityKind, ActivityVisual>> = Object.freeze({
  reasoning: visual('Reasoning', ['accentDim', 'accentBright'], 'thinking'),
  coding: visual('Coding', ['brand', 'accentBright'], 'active'),
  searching: visual('Searching', ['accent', 'accentBright'], 'subtle'),
  reading: visual('Reading', ['muted', 'brand'], 'subtle'),
  writing: visual('Writing', ['accent', 'accentPastel'], 'active'),
  inspecting: visual('Inspecting', ['brand', 'accent'], 'subtle'),
  running: visual('Running', ['accentDim', 'accent'], 'active'),
  cooking: visual('Cooking', ['accent', 'accentPastel'], 'bloom'),
  thinking: visual('Thinking', ['accentDim', 'accentBright'], 'thinking'),
});

/** Map legacy/generic status words onto the stable semantic visual family. */
export function activityKindForLabel(label: string): ActivityKind {
  const value = label.toLowerCase();
  if (/(search|fetch|query|web)/.test(value)) return 'searching';
  if (/(read|parse|map|trace|follow|inspect|audit|narrow|sift)/.test(value)) return 'reading';
  if (/(write|compose|craft|generat|structur|assemble|build)/.test(value)) return 'writing';
  if (/(code|compil|refactor|implement|synthes)/.test(value)) return 'coding';
  if (/(run|execute|tool|command)/.test(value)) return 'running';
  if (/(brew|marinat|whisk|infus)/.test(value)) return 'cooking';
  if (/(think|reason|ponder|muse|deliberat|cerebrat|cogitat|reflect|ruminat)/.test(value)) return 'reasoning';
  return 'thinking';
}

export function activityVisual(kind: ActivityKind): ActivityVisual {
  return activityVisuals[kind];
}

export function activityGlyphAt(
  kind: ActivityKind,
  elapsedMs: number,
  active = true,
): string {
  const visual = activityVisual(kind);
  const frames = supportsRichGlyphs ? visual.frames : visual.fallbackFrames;
  if (!active || visual.animationMode === 'static') {
    return supportsRichGlyphs ? visual.glyph : visual.fallbackGlyph;
  }
  // Keep the cadence owned by the registry: one calm optical cycle, shared by
  // loading and activity rows, rather than a second local animation constant.
  const period = visual.periodMs;
  const index = Math.floor((Math.max(0, elapsedMs) / period) * frames.length) % frames.length;
  return frames[index] as string;
}

/** The glyph and its verb share one calm luminance phase. */
export function activityColorAt(kind: ActivityKind, elapsedMs: number): string {
  const visual = activityVisual(kind);
  const phase = (Math.max(0, elapsedMs) % visual.periodMs) / visual.periodMs;
  const breath = phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
  return mix(color(visual.gradient[0]), color(visual.gradient[1]), 0.25 + breath * 0.65);
}

export interface GradientPart {
  readonly text: string;
  readonly color: string;
}

/** Character-safe, static ANSI gradient data for one activity label. */
export function gradientText(
  value: string,
  from: PaletteKey,
  to: PaletteKey,
): readonly GradientPart[] {
  const parts: string[] = [];
  for (let at = 0; at < value.length;) {
    const length = clusterLength(value, at) || 1;
    parts.push(value.slice(at, at + length));
    at += length;
  }
  if (parts.length === 0) return [];
  return parts.map((text, index) => ({
    text,
    color: mix(color(from), color(to), parts.length === 1 ? 0 : index / (parts.length - 1)),
  }));
}

export const GradientText = React.memo(function GradientText({
  value,
  from,
  to,
  bold = false,
}: {
  readonly value: string;
  readonly from: PaletteKey;
  readonly to: PaletteKey;
  readonly bold?: boolean;
}): React.ReactElement {
  return (
    <Text>
      {gradientText(value, from, to).map((part, index) => (
        <Text key={`${part.text}:${index}`} color={part.color} bold={bold}>{part.text}</Text>
      ))}
    </Text>
  );
});

GradientText.displayName = 'GradientText';

/** One mounted activity owns the only animation subscription it needs. */
export const ActivityLine = React.memo(function ActivityLine({
  kind,
  label,
  active = true,
}: {
  readonly kind: ActivityKind;
  readonly label?: string;
  readonly active?: boolean;
}): React.ReactElement {
  const frame = useAnimationFrame(active, 'slow');
  const visual = activityVisual(kind);
  const text = label ?? visual.label;
  const glyph = activityGlyphAt(kind, frame * ANIMATION_INTERVAL_MS, active);
  return (
    <Text>
      <Text color={activityColorAt(kind, frame * ANIMATION_INTERVAL_MS)} bold>{glyph}</Text>
      <Text> </Text>
      <GradientText value={text} from={visual.gradient[0]} to={visual.gradient[1]} bold />
    </Text>
  );
});

ActivityLine.displayName = 'ActivityLine';

export function activityGlyphWidthReport(): readonly { kind: ActivityKind; glyphs: readonly string[]; widths: readonly number[] }[] {
  return (Object.keys(activityVisuals) as ActivityKind[]).map((kind) => {
    const visual = activityVisual(kind);
    const glyphs = supportsRichGlyphs ? visual.frames : visual.fallbackFrames;
    return { kind, glyphs, widths: glyphs.map((glyph) => displayWidth(glyph)) };
  });
}
