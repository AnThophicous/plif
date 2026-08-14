import { clusterLength } from './text.js';
import { palette, type PaletteKey } from './theme.js';
import { ANIMATION_INTERVAL_MS, useAnimationFrame } from './hooks/useAnimationClock.js';

const CELL_MS = 180;
const BELL_CELLS = 3;
const BREATH_MS = 2_400;

export interface HighlightPart {
  readonly text: string;
  readonly color: string;
  readonly active: boolean;
}

function channels(hex: string): readonly [number, number, number] {
  const digits = hex.replace('#', '');
  const full = digits.length === 3 ? digits.replace(/./g, (part) => part + part) : digits;
  const value = Number.parseInt(full.padEnd(6, '0').slice(0, 6), 16) || 0;
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function mix(from: string, to: string, ratio: number): string {
  const start = channels(from);
  const end = channels(to);
  const amount = Math.max(0, Math.min(1, ratio));
  return `#${start
    .map((part, index) => Math.round(part + (end[index]! - part) * amount))
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function toneBetween(from: PaletteKey, to: PaletteKey, ratio: number): string {
  return mix(palette[from], palette[to], ratio);
}

export function useHighlightClock(active = true, frameMs = 16): number {
  const frame = useAnimationFrame();
  if (!active) return 0;
  // Keep this helper's old elapsed-millisecond contract for the pure colour
  // functions while sourcing every tick from the single shared animation clock.
  // The argument remains for source compatibility and phase tuning at the
  // call sites; it must not create a second timer.
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
