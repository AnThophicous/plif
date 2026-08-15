import { clusterLength } from './text.js';
import { palette, type PaletteKey } from './theme.js';
import { ANIMATION_INTERVAL_MS, useAnimationFrame } from './hooks/useAnimationClock.js';

const CELL_MS = 180;
const BELL_CELLS = 3;
const BREATH_MS = 2_400;

/** Semantic stops used by the Chromatic Reactor. The active theme supplies
 * every colour; the wave only chooses where to interpolate between them. */
export const PLIF_WAVE_STOPS = [
  'brand',
  'accentDim',
  'accent',
  'accentBright',
] as const satisfies readonly PaletteKey[];

export type SemanticWaveStops = readonly PaletteKey[];

export interface HighlightPart {
  readonly text: string;
  readonly color: string;
  readonly active: boolean;
}

function channels(value: string): readonly [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!;
  const full = digits.length === 3 ? digits.replace(/./g, (part) => part + part) : digits;
  const numeric = Number.parseInt(full, 16);
  return [(numeric >> 16) & 0xff, (numeric >> 8) & 0xff, numeric & 0xff];
}

export function mix(from: string, to: string, ratio: number): string {
  const amount = Math.max(0, Math.min(1, ratio));
  const start = channels(from);
  const end = channels(to);
  // User themes may use named or functional colours accepted by Ink. Without
  // a CSS colour parser, keep those exact semantic stops instead of silently
  // converting an unrecognised value to black.
  if (!start || !end) return amount < 0.5 ? from : to;
  return `#${start
    .map((part, index) => Math.round(part + (end[index]! - part) * amount))
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function toneBetween(from: PaletteKey, to: PaletteKey, ratio: number): string {
  return mix(palette[from], palette[to], ratio);
}

/**
 * Interpolate a normalised phase through an arbitrary semantic palette ramp.
 *
 * This is intentionally pure apart from reading the current palette. Theme
 * activation updates that palette before rendering, so an animation never
 * carries a Plif-specific colour table with it.
 */
export function semanticWave(
  phase: number,
  stops: SemanticWaveStops = PLIF_WAVE_STOPS,
): string {
  if (stops.length === 0) return palette.faint;
  if (stops.length === 1) return palette[stops[0]!];

  const normalized = ((phase % 1) + 1) % 1;
  const scaled = normalized * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const linear = scaled - index;
  // Smooth each colour stop with a cubic ease-in-out. A linear ramp makes a
  // terminal highlight visibly snap at every stop; this keeps the hue change
  // continuous without changing any cell geometry.
  const eased = linear * linear * (3 - 2 * linear);
  return mix(
    palette[stops[index]!],
    palette[stops[index + 1]!],
    eased,
  );
}

/** A travelling semantic wave for one cell in a stable row. */
export function semanticWaveTone(
  elapsedMs: number,
  index: number,
  length: number,
  stops: SemanticWaveStops = PLIF_WAVE_STOPS,
  cycleMs = 1_440,
): string {
  const span = Math.max(1, length);
  const travel = elapsedMs / Math.max(1, cycleMs);
  return semanticWave(travel + index / span, stops);
}

export function useHighlightClock(active = true, frameMs = 16): number {
  const frame = useAnimationFrame();
  if (!active) return 0;
  // Keep this helper's elapsed-millisecond contract for the pure colour
  // functions while sourcing every tick from the one shared 180 ms clock. The
  // argument remains for source compatibility and phase tuning at call sites;
  // it must not create a second timer.
  void frameMs;
  return frame * ANIMATION_INTERVAL_MS;
}

export function highlightedClusters(
  value: string,
  elapsedMs: number,
  from: PaletteKey = 'accent',
  to: PaletteKey = 'accentBright',
): readonly HighlightPart[] {
  const parts: string[] = [];
  for (let at = 0; at < value.length; ) {
    const length = clusterLength(value, at) || 1;
    parts.push(value.slice(at, at + length));
    at += length;
  }
  if (parts.length === 0) return [];

  const center = (elapsedMs / CELL_MS) % parts.length;
  return parts.map((text, index) => {
    const forward = (index - center + parts.length) % parts.length;
    const distance = Math.min(forward, parts.length - forward);
    const intensity = Math.max(0, Math.cos((Math.min(1, distance / BELL_CELLS) * Math.PI) / 2));
    return { text, color: toneBetween(from, to, intensity), active: intensity > 0.9 };
  });
}

export function breathingTone(elapsedMs: number, from: PaletteKey, to: PaletteKey): string {
  const phase = (1 - Math.cos(((elapsedMs % BREATH_MS) / BREATH_MS) * Math.PI * 2)) / 2;
  return toneBetween(from, to, phase);
}
