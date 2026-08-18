import { semanticWaveTone, type SemanticWaveStops } from './pulse.js';
import { supportsRichGlyphs, type PaletteKey } from './theme.js';

/**
 * PLIF's small constellation is semantic, not decorative. Each role has one
 * fixed-width family: changing the light glyph never changes the row geometry.
 */
export type PlifGlyphRole =
  | 'quiet'
  | 'subtle'
  | 'active'
  | 'thinking'
  | 'peak'
  | 'header'
  | 'loading'
  | 'bloom';

const RICH_FRAMES: Record<PlifGlyphRole, readonly string[]> = {
  // Every moving role is a deliberately matched pair. A pair breathes; a
  // random sequence makes the terminal look like it is changing size.
  quiet: ['·', '·'],
  subtle: ['·', '✧'],
  active: ['✦', '✧'],
  thinking: ['✶', '✷'],
  peak: ['✹', '✦'],
  header: ['·', '·'],
  loading: ['✦', '✧'],
  // Cooking starts as a compact ember and opens into the same quiet flower
  // family used by the working separator. Two frames keep the geometry calm.
  bloom: ['●', '✧'],
};

const ASCII_FRAMES: Record<PlifGlyphRole, readonly string[]> = {
  quiet: ['.', '.'],
  subtle: ['.', '+'],
  active: ['*', '+'],
  thinking: ['x', '+'],
  peak: ['#', '*'],
  header: ['.', '.'],
  loading: ['*', '+'],
  bloom: ['o', '+'],
};

/**
 * The only glyph registry used by PLIF motion. Rich and ASCII families are
 * paired here so a terminal capability switch cannot introduce a different
 * silhouette or an unreviewed fallback in one component.
 */
export const PLIF_GLYPHS = Object.freeze({
  rich: RICH_FRAMES,
  ascii: ASCII_FRAMES,
  loading: RICH_FRAMES.loading,
  signature: RICH_FRAMES.active,
  quiet: RICH_FRAMES.quiet,
  complete: ['✓'] as const,
  pending: ['…'] as const,
  activity: ['↳'] as const,
  bloom: RICH_FRAMES.bloom,
});

const ROLE_STOPS: Record<PlifGlyphRole, SemanticWaveStops> = {
  quiet: ['ghost', 'muted', 'accentDim'],
  subtle: ['accentDim', 'muted', 'accentBright'],
  active: ['accentDim', 'goldBase', 'gold', 'goldBright', 'warmIvory', 'goldBright', 'gold', 'goldBase', 'accentBright'],
  thinking: ['accentDim', 'goldBase', 'gold', 'goldBright', 'warmIvory', 'goldBright', 'gold', 'goldBase', 'accentDim'],
  peak: ['accent', 'goldBase', 'gold', 'goldBright', 'warmIvory', 'goldBright', 'gold', 'goldBase', 'accentBright'],
  header: ['ghost', 'muted', 'accentDim', 'accentBright', 'goldBase', 'gold', 'goldBright', 'warmIvory', 'muted'],
  loading: ['accentDim', 'goldBase', 'gold', 'goldBright', 'warmIvory', 'goldBright', 'gold', 'goldBase', 'accentDim'],
  bloom: ['accentDim', 'accentBright', 'goldBase', 'goldBright', 'goldBase', 'accentBright'],
};

const ROLE_PERIODS: Record<PlifGlyphRole, number> = {
  quiet: 1_080,
  subtle: 1_200,
  active: 1_200,
  thinking: 1_200,
  peak: 1_000,
  header: 720,
  loading: 1_440,
  bloom: 1_200,
};

const THINKING_DOTS = ['.  ', '.. ', '...', '.. ', '.  '] as const;

export function plifGlyphFrames(role: PlifGlyphRole = 'active'): readonly string[] {
  return plifGlyphFramesForTerminal(role, supportsRichGlyphs);
}

/** Read the reviewed family for a specific terminal capability. */
export function plifGlyphFramesForTerminal(
  role: PlifGlyphRole = 'active',
  rich: boolean,
): readonly string[] {
  return (rich ? PLIF_GLYPHS.rich : PLIF_GLYPHS.ascii)[role];
}

/** The ASCII twin is kept beside the rich family, never invented by callers. */
export function plifGlyphFallbackFrames(role: PlifGlyphRole = 'active'): readonly string[] {
  return PLIF_GLYPHS.ascii[role];
}

export function plifGlyphPeriodMs(role: PlifGlyphRole = 'active'): number {
  return ROLE_PERIODS[role];
}

/** Return one stable-width glyph for a semantic PLIF phase. */
export function plifGlyphAt(
  elapsedMs: number,
  role: PlifGlyphRole = 'active',
  periodMs = ROLE_PERIODS[role],
): string {
  const frames = plifGlyphFrames(role);
  const cycleMs = Math.max(120, periodMs);
  const phaseMs = Math.max(0, elapsedMs) % cycleMs;
  const index = Math.floor((phaseMs / cycleMs) * frames.length) % frames.length;
  return frames[index] as string;
}

/** The colour ramp follows the same quiet → champagne → ivory rhythm. */
export function plifGlyphColor(elapsedMs: number, role: PlifGlyphRole = 'active'): string {
  // The glyph and the luminance share the same phase. The centre frame is the
  // warm-ivory peak, never a dim glyph with a bright colour arriving later.
  return semanticWaveTone(elapsedMs, 0, 1, ROLE_STOPS[role], ROLE_PERIODS[role]);
}

/** Fixed-width dot progression for the thinking label. */
export function thinkingDotsAt(elapsedMs: number, periodMs = 520): string {
  const index = Math.floor(Math.max(0, elapsedMs) / Math.max(120, periodMs)) % THINKING_DOTS.length;
  return THINKING_DOTS[index] as string;
}

export function plifGlyphStops(role: PlifGlyphRole = 'active'): readonly PaletteKey[] {
  return ROLE_STOPS[role];
}

export function plifLoadingPhaseAt(elapsedMs: number, periodMs = ROLE_PERIODS.loading): number {
  const cycle = Math.max(120, periodMs);
  return (Math.max(0, elapsedMs) % cycle) / cycle;
}
