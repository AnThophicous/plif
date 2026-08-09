import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

import { clusterLength } from '../text.js';
import { color, formatCount, formatDuration, glyph, supportsRichGlyphs, truncate } from '../theme.js';

const VERBS = [
  'Parsing',
  'Untangling',
  'Tracing',
  'Compiling',
  'Reasoning',
  'Digging',
  'Cross-checking',
  'Following',
  'Narrowing',
  'Wiring',
  'Sifting',
  'Unpicking',
  'Threading',
  'Weighing',
  'Chasing',
  'Reconciling',
  'Distilling',
  'Auditing',
  'Twisting',
  'Resolving',
];

const PULSE = supportsRichGlyphs ? ['✦', '✧', '✦', '✶'] : ['*', '+', '*', 'x'];

const TIPS = [
  'Esc cancels without killing the container',
  'Prefix a line with ! to run a shell command yourself',
  '/model switches model mid-session',
  '/sandbox shows exactly what is enforced',
  'Skills load on demand — /skills lists them',
  '/audit --verify checks the hash chain',
];

const VERB_EVERY_MS = 4_000;
// One animation frame per display refresh. The highlight advances only a
// fraction of a cell per frame; colours interpolate between cells, avoiding
// the letter-by-letter stepping that made a 20 Hz timer still look choppy.
const PULSE_EVERY_MS = 16;
const TIP_AFTER_MS = 12_000;

export interface ThinkingProps {
  readonly since: number;
  readonly tokens: number;
  readonly label?: string;
  readonly width: number;
  readonly showTips?: boolean;
}

export interface HighlightPart {
  readonly text: string;
  /** Per-cluster true-colour ramp; terminals downsample when necessary. */
  readonly color: string;
  readonly active: boolean;
}

const HIGHLIGHT_BASE = [139, 139, 212] as const;
const HIGHLIGHT_PEAK = [205, 220, 255] as const;
const FRAMES_PER_CELL = 4;

function blendHighlight(intensity: number): string {
  const channel = (index: number): number => Math.round(
    HIGHLIGHT_BASE[index]! + (HIGHLIGHT_PEAK[index]! - HIGHLIGHT_BASE[index]!) * intensity,
  );
  return `#${[channel(0), channel(1), channel(2)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function highlightedClusters(value: string, tick: number): readonly HighlightPart[] {
  const clusters: string[] = [];
  for (let at = 0; at < value.length;) {
    const length = clusterLength(value, at) || 1;
    clusters.push(value.slice(at, at + length));
    at += length;
  }
  if (clusters.length === 0) return [];
  const center = (tick / FRAMES_PER_CELL) % clusters.length;
  return clusters.map((text, index) => {
    const clockwise = (index - center + clusters.length) % clusters.length;
    const distance = Math.min(clockwise, clusters.length - clockwise);
    // Smooth bell-shaped light. Every cell changes shade on every frame while
    // the centre crosses it, so the motion is sub-cell even though a terminal
    // can only paint whole glyph cells.
    const intensity = Math.max(0, Math.cos(Math.min(1, distance / 3) * Math.PI / 2));
    return {
      text,
      color: blendHighlight(intensity),
      active: intensity > 0.9,
    };
  });
}

export function Thinking({
  since,
  tokens,
  label,
  width,
  showTips = true,
}: ThinkingProps): React.ReactElement {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), PULSE_EVERY_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }, []);

  const elapsed = Date.now() - since;
  const pulse = PULSE[Math.floor(tick / 5) % PULSE.length] as string;
  const verb =
    label ?? (VERBS[Math.floor(elapsed / VERB_EVERY_MS) % VERBS.length] as string);

  const parts = [formatDuration(elapsed)];
  if (tokens > 0) parts.push(`${glyph.tokens} ${formatCount(tokens)} tokens`);

  const tip =
    showTips && elapsed > TIP_AFTER_MS
      ? (TIPS[Math.floor(elapsed / TIP_AFTER_MS) % TIPS.length] as string)
      : null;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color('accent')}>{pulse} </Text>
        <Text>
          {highlightedClusters(verb, tick).map((part, index) => (
            <Text key={index} color={part.color} bold={part.active}>
              {part.text}
            </Text>
          ))}
          <Text color={color('accent')}>…</Text>
        </Text>
        <Text color={color('ghost')}> ({parts.join(' · ')})</Text>
      </Box>
      {tip && (
        <Box>
          <Text color={color('ghost')}>{`  ${glyph.branch} `}</Text>
          <Text color={color('faint')}>{truncate(`Tip: ${tip}`, Math.max(20, width - 6))}</Text>
        </Box>
      )}
    </Box>
  );
}
