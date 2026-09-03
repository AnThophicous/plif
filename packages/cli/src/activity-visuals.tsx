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
  | 'thinking'
  // Added alongside the Argus and Sifr skills: those runs sit inside one phase
  // for minutes, and labelling all of it "Thinking" tells the operator nothing
  // about what the agent is actually doing.
  | 'securing'
  | 'designing'
  | 'verifying'
  | 'planning';

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
  // Every label gradient stays inside the pink ramp's dim-to-bright range.
  // `accentPastel` is close enough to white that a label ending on it read as
  // fading out to plain white rather than staying pink, which made
  // "Writing"/"Cooking" look like a different, washed-out palette next to
  // "Reasoning" or "Running" sitting right above them.
  reasoning: visual('Reasoning', ['accentDim', 'accentBright'], 'thinking'),
  coding: visual('Coding', ['brand', 'accentBright'], 'active'),
  searching: visual('Searching', ['accent', 'accentBright'], 'subtle'),
  reading: visual('Reading', ['muted', 'brand'], 'subtle'),
  writing: visual('Writing', ['accent', 'accentBright'], 'active'),
  inspecting: visual('Inspecting', ['brand', 'accent'], 'subtle'),
  running: visual('Running', ['accentDim', 'accent'], 'active'),
  cooking: visual('Cooking', ['accent', 'accentBright'], 'bloom'),
  thinking: visual('Thinking', ['accentDim', 'accentBright'], 'thinking'),
  // Securing reads as the most deliberate row on screen: it is the one that
  // stops a release, so it gets the peak family rather than a subtle one.
  securing: visual('Securing', ['accentDim', 'accent'], 'peak'),
  designing: visual('Designing', ['brand', 'accentBright'], 'bloom'),
  verifying: visual('Verifying', ['accent', 'accentBright'], 'peak'),
  planning: visual('Planning', ['muted', 'accent'], 'thinking'),
});

/** Map legacy/generic status words onto the stable semantic visual family. */
export function activityKindForLabel(label: string): ActivityKind {
  const value = label.toLowerCase();
  // The specific families are tested before the broad ones: "auditing
  // dependencies" is security work, and would otherwise be swallowed by the
  // `read`/`inspect` branch below.
  if (/(secur|threat|vulnerab|attack.?path|harden|audit|exploit|cve|redact)/.test(value)) return 'securing';
  if (/(design|layout|typograph|palette|token|visual|style|theme|motion)/.test(value)) return 'designing';
  if (/(verif|validat|prov|confirm|lint|typecheck|assert|regress)/.test(value)) return 'verifying';
  if (/(search|fetch|query|web)/.test(value)) return 'searching';
  if (/(read|parse|map|trace|follow|inspect|audit|narrow|sift)/.test(value)) return 'reading';
  if (/(write|compose|craft|generat|structur|assemble|build)/.test(value)) return 'writing';
  if (/(code|compil|refactor|implement|synthes)/.test(value)) return 'coding';
  if (/(run|execute|tool|command)/.test(value)) return 'running';
  if (/(brew|marinat|whisk|infus)/.test(value)) return 'cooking';
  // After cooking on purpose: "Brewing a plan" is a cooking label that happens
  // to contain the word plan, and the playful family should win there.
  if (/(plan|scope|sequenc|prioriti|decompos|outlin|strateg)/.test(value)) return 'planning';
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

/**
 * The glyph anchors the label instead of joining its gradient. A solid start
 * color keeps the mark readable as one deliberate symbol while the word can
 * still travel from pink toward its brighter end.
 */
export function activityColorAt(kind: ActivityKind, _elapsedMs: number): string {
  const visual = activityVisual(kind);
  return color(visual.gradient[0]);
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
  const start = color(from);
  const end = color(to);
  return parts.map((text, index) => {
    // Anchor the ends on the exact palette tones. `mix` rebuilds the hex and
    // normalises its case, so an interpolated endpoint was equal in colour but
    // not as a string to `color(from)` — which is what callers compare against
    // when they line a glyph up with the first letter.
    if (index === 0) return { text, color: start };
    if (index === parts.length - 1) return { text, color: end };
    return { text, color: mix(start, end, index / (parts.length - 1)) };
  });
}

/** One full pass of the shimmer across a label. */
export const SHIMMER_PERIOD_MS = 2_600;

/**
 * The same gradient, with a soft highlight travelling along the word.
 *
 * The static gradient already says which activity is running; this says it is
 * still running, without adding a second moving element to the row. The
 * highlight is a narrow raised-cosine window rather than a hard band, because
 * a sharp edge crawling through text reads as a rendering fault in a terminal.
 *
 * Off-window characters keep their exact static color, so a paused shimmer is
 * indistinguishable from the static gradient — that is what lets callers stop
 * animating without the label appearing to change.
 */
export function shimmerGradient(
  value: string,
  from: PaletteKey,
  to: PaletteKey,
  elapsedMs: number,
  highlight: PaletteKey = 'accentBright',
): readonly GradientPart[] {
  const base = gradientText(value, from, to);
  if (base.length === 0) return base;

  const period = SHIMMER_PERIOD_MS;
  // Travel from before the first character to past the last one, so the
  // highlight enters and leaves instead of popping at the edges.
  const width = 0.28;
  const head = ((Math.max(0, elapsedMs) % period) / period) * (1 + width * 2) - width;
  const peak = color(highlight);

  return base.map((part, index) => {
    const position = base.length === 1 ? 0 : index / (base.length - 1);
    const distance = Math.abs(position - head);
    if (distance >= width) return part;
    // Raised cosine: 1 at the centre, 0 at the edges, no discontinuity.
    const intensity = (1 + Math.cos((distance / width) * Math.PI)) / 2;
    return { text: part.text, color: mix(part.color, peak, intensity * 0.55) };
  });
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

/**
 * Render the mark and the first letter inside one ANSI style run.  Keeping
 * them as sibling text nodes gave some Windows terminal renderers a subtly
 * different anti-aliased result, despite receiving the same hexadecimal
 * colour.  This is deliberately the one shared primitive for every live
 * activity row.
 */
export const ActivityLabel = React.memo(function ActivityLabel({
  glyph,
  value,
  from,
  to,
  bold = true,
  shimmerMs,
}: {
  readonly glyph: string;
  readonly value: string;
  readonly from: PaletteKey;
  readonly to: PaletteKey;
  readonly bold?: boolean;
  /** Elapsed time for the travelling highlight; omit to keep the label static. */
  readonly shimmerMs?: number;
}): React.ReactElement {
  const [first, ...rest] = shimmerMs === undefined
    ? gradientText(value, from, to)
    : shimmerGradient(value, from, to, shimmerMs);
  const lead = first?.color ?? color(from);
  return (
    <Text color={lead} bold={bold}>
      {glyph ? `${glyph} ` : ''}{first?.text ?? ''}
      {rest.map((part, index) => (
        <Text key={`${part.text}:${index + 1}`} color={part.color}>{part.text}</Text>
      ))}
    </Text>
  );
});

ActivityLabel.displayName = 'ActivityLabel';

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
  const elapsed = frame * ANIMATION_INTERVAL_MS;
  const glyph = activityGlyphAt(kind, elapsed, active);
  return (
    <Text>
      <ActivityLabel
        glyph={glyph}
        value={text}
        from={visual.gradient[0]}
        to={visual.gradient[1]}
        // Only a live row shimmers. A finished row keeps the static gradient,
        // which is how the eye tells "running" from "ran" at a glance.
        {...(active ? { shimmerMs: elapsed } : {})}
      />
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
