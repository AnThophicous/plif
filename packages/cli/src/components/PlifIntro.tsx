import React from 'react';
import { Box, Text } from 'ink';

import { mix, semanticWaveTone, useHighlightClock } from '../pulse.js';
import { color, type PaletteKey } from '../theme.js';

export const PLIF_INTRO_DURATION_MS = 5_200;

const BIG_PLIF = [
  '▄███████▄  ▄█        ▄█     ▄████████',
  '███    ███ ███       ███    ███    ███',
  '███    ███ ███       ███▌   ███    █▀',
  '███    ███ ███       ███▌  ▄███▄▄▄',
  '▀█████████▀ ███       ███▌ ▀▀███▀▀▀',
  '███        ███       ███    ███',
  '███        ███▌    ▄ ███    ███',
  '▄████▀      █████▄▄██ █▀     ███',
  '            ▀',
] as const;

export interface PlifIntroFrame {
  readonly progress: number;
  readonly top: number;
  readonly largeOpacity: number;
  readonly compactOpacity: number;
  readonly compactTop: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Fast launch, soft landing: the title settles without a mechanical snap. */
export function cubicEaseOut(value: number): number {
  const t = clamp(value);
  return 1 - (1 - t) ** 3;
}

export function cubicEaseInOut(value: number): number {
  const t = clamp(value);
  return t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2;
}

export function plifIntroFrame(elapsedMs: number, viewportHeight: number): PlifIntroFrame {
  const progress = clamp(elapsedMs / PLIF_INTRO_DURATION_MS);
  const travel = cubicEaseOut(progress);
  const startTop = Math.max(1, Math.floor(Math.max(8, viewportHeight) / 2) - 3);
  const top = Math.round(startTop * (1 - travel));
  const shrink = cubicEaseInOut(clamp((progress - 0.12) / 0.72));
  const fade = cubicEaseInOut(clamp((progress - 0.78) / 0.22));

  return {
    progress,
    top,
    largeOpacity: (1 - shrink) * (1 - fade),
    compactOpacity: shrink * (1 - fade),
    compactTop: Math.round((1 - shrink) * 3),
  };
}

function gradientLine(
  value: string,
  elapsedMs: number,
  strength: number,
  stops: readonly PaletteKey[],
): React.ReactElement {
  const opacity = clamp(strength);
  return (
    <Text>
      {Array.from(value).map((character, index) => (
        <Text
          key={index}
          color={mix(color('ghost'), semanticWaveTone(elapsedMs, index, value.length, stops, 720), opacity)}
        >
          {character}
        </Text>
      ))}
    </Text>
  );
}

export function PlifIntro({
  active,
  elapsedMs,
  width,
  height,
}: {
  readonly active: boolean;
  readonly elapsedMs?: number;
  readonly width: number;
  readonly height: number;
}): React.ReactElement | null {
  const clock = useHighlightClock(active);
  if (!active) return null;

  const elapsed = elapsedMs ?? clock;
  const frame = plifIntroFrame(elapsed, height);
  if (frame.progress >= 1) return null;
  const stops = ['brand', 'accentDim', 'accent', 'accentBright'] as const;
  const largeTitle: readonly string[] = width < 64 ? ['PLIF'] : BIG_PLIF;
  const stageHeight = largeTitle.length + 2;
  const showLargeTitle = frame.largeOpacity >= frame.compactOpacity;

  return (
    <Box
      position="absolute"
      marginTop={frame.top}
      width={width}
      height={stageHeight}
      flexDirection="column"
      alignItems="center"
    >
      <Box position="absolute" width={width} flexDirection="column" alignItems="center">
        {showLargeTitle && largeTitle.map((line, index) => (
          <React.Fragment key={index}>
            {gradientLine(line, elapsed + index * 45, frame.largeOpacity, stops)}
          </React.Fragment>
        ))}
      </Box>
      <Box
        position="absolute"
        marginTop={frame.compactTop}
        width={width}
        flexDirection="column"
        alignItems="center"
      >
        {!showLargeTitle && gradientLine('P L I F', elapsed + 240, frame.compactOpacity, stops)}
      </Box>
    </Box>
  );
}
