import React, { useEffect, useRef } from 'react';
import { Box, Text } from 'ink';

import { useAnimationFrame } from '../hooks/useAnimationClock.js';
import { mix, semanticWave, type SemanticWaveStops } from '../pulse.js';
import { displayWidth } from '../text.js';
import { color, supportsRichGlyphs } from '../theme.js';
import { monotonicNow } from '../loading-state.js';
import { plifGlyphColor, plifGlyphFallbackFrames, plifGlyphFramesForTerminal } from '../plif-glyphs.js';
import { PLIF_ASCII_ART } from './PlifIntro.js';

/** The presentation is intentionally short: spool, peak, reveal, settle. */
export const PLIF_ACTIVATION_SPIN_MS = 1_350;
export const PLIF_ACTIVATION_LOGO_MS = 750;
export const PLIF_ACTIVATION_FADE_MS = 300;
export const PLIF_ACTIVATION_DURATION_MS =
  PLIF_ACTIVATION_SPIN_MS + PLIF_ACTIVATION_LOGO_MS + PLIF_ACTIVATION_FADE_MS;

// The activation consumes the same reviewed optical family as loading. This
// prevents the signature moment from introducing a second, unrelated glyph
// dialect into the terminal.
const ACTIVATION_GLYPHS = plifGlyphFramesForTerminal('peak', supportsRichGlyphs);
const ACTIVATION_FALLBACK_GLYPHS = plifGlyphFallbackFrames('peak');
const ACTIVATION_INTERVALS = [
  { duration: 300, interval: 150 },
  { duration: 250, interval: 110 },
  { duration: 220, interval: 80 },
  { duration: 200, interval: 55 },
  { duration: 180, interval: 35 },
  { duration: 200, interval: 28 },
] as const;
const ACTIVATION_STOPS: SemanticWaveStops = [
  'accentDim',
  'accentBright',
  'accent',
  'accentStrong',
  'accentPastel',
  'accentPastel',
];

export interface PlifActivationFrame {
  readonly elapsedMs: number;
  readonly spinning: boolean;
  readonly peak: boolean;
  readonly logoOpacity: number;
  readonly glyph: string;
  readonly glyphColor: string;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function glyphAtSpool(elapsedMs: number): string {
  let remaining = Math.max(0, elapsedMs);
  let offset = 0;
  for (const band of ACTIVATION_INTERVALS) {
    if (remaining < band.duration) {
      const frames = supportsRichGlyphs ? ACTIVATION_GLYPHS : ACTIVATION_FALLBACK_GLYPHS;
      return frames[Math.floor(remaining / band.interval + offset) % frames.length] as string;
    }
    offset += Math.ceil(band.duration / band.interval);
    remaining -= band.duration;
  }
  const frames = supportsRichGlyphs ? ACTIVATION_GLYPHS : ACTIVATION_FALLBACK_GLYPHS;
  return frames[frames.length - 2] as string;
}

/** Pure timing model used by the isolated renderer and its tests. */
export function plifActivationFrame(elapsedMs: number): PlifActivationFrame {
  const elapsed = Math.max(0, elapsedMs);
  const spinning = elapsed < PLIF_ACTIVATION_SPIN_MS;
  const afterSpin = Math.max(0, elapsed - PLIF_ACTIVATION_SPIN_MS);
  const fadeStart = PLIF_ACTIVATION_LOGO_MS;
  const logoOpacity = spinning
    ? 0
    : 1 - clamp((afterSpin - fadeStart) / PLIF_ACTIVATION_FADE_MS);
  const spinProgress = clamp(elapsed / PLIF_ACTIVATION_SPIN_MS);
  const glyph = spinning
    ? glyphAtSpool(elapsed)
    : (supportsRichGlyphs ? ACTIVATION_GLYPHS : ACTIVATION_FALLBACK_GLYPHS)[
      (supportsRichGlyphs ? ACTIVATION_GLYPHS : ACTIVATION_FALLBACK_GLYPHS).length - 2
    ] as string;
  return {
    elapsedMs: elapsed,
    spinning,
    peak: !spinning && afterSpin < PLIF_ACTIVATION_LOGO_MS,
    logoOpacity,
    glyph,
    glyphColor: spinning
      ? semanticWave(spinProgress * 0.98, ACTIVATION_STOPS)
      : plifGlyphColor(elapsed, 'peak'),
  };
}

function logoLine(value: string, elapsedMs: number, opacity: number, index: number): React.ReactElement {
  const base = mix(color('ghost'), color('accentPastel'), opacity * 0.82);
  const highlight = semanticWave((elapsedMs / 1_800 + index / Math.max(1, PLIF_ASCII_ART.length)) % 1, ACTIVATION_STOPS);
  return (
    <Text>
      {Array.from(value).map((character, column) => (
        <Text key={column} color={mix(base, highlight, opacity > 0.75 ? 0.22 : 0.08)}>{character}</Text>
      ))}
    </Text>
  );
}

/**
 * Isolated visual overlay for entering PLIF effort. It reads the shared fast
 * clock, but the app tree and the settled HUD do not subscribe to its ticks.
 */
export const PlifActivation = React.memo(function PlifActivation({
  active,
  width,
  height,
}: {
  readonly active: boolean;
  readonly width: number;
  readonly height: number;
}): React.ReactElement | null {
  const frame = useAnimationFrame(active, 'fast');
  const startedAt = useRef<number | null>(null);
  if (active && startedAt.current === null) startedAt.current = monotonicNow();
  if (!active) startedAt.current = null;
  useEffect(() => () => {
    startedAt.current = null;
  }, []);

  if (!active || startedAt.current === null) return null;
  const elapsed = Math.max(0, monotonicNow() - startedAt.current);
  // Keep the subscription meaningful in deterministic previews where Date.now
  // can be sampled between clock ticks, while preserving the real-time source.
  void frame;
  const state = plifActivationFrame(elapsed);
  const art = width < 72 ? ['P L I F'] : PLIF_ASCII_ART;
  const top = Math.max(1, Math.floor(Math.max(8, height) / 2) - Math.floor(art.length / 2));
  const stageHeight = art.length + 3;
  const logoVisible = state.logoOpacity > 0;

  return (
    <Box
      position="absolute"
      marginTop={top}
      width={Math.max(1, width)}
      height={Math.min(Math.max(1, height - top), stageHeight)}
      flexDirection="column"
      alignItems="center"
    >
      <Text color={state.glyphColor} bold>
        {state.peak && supportsRichGlyphs ? '✹' : state.glyph}{state.peak ? ' PLIF' : ''}
      </Text>
      {logoVisible && art.map((line, index) => (
        <Box key={index} width={Math.min(Math.max(1, width), displayWidth(line))}>
          {logoLine(line, state.elapsedMs + index * 45, state.logoOpacity, index)}
        </Box>
      ))}
    </Box>
  );
});

PlifActivation.displayName = 'PlifActivation';
