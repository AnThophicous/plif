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
// Fast enough to read as movement, slow enough that Ink does not repaint a
// large terminal at display-refresh speed while the agent streams output.
const PULSE_EVERY_MS = 180;
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
  readonly active: boolean;
}

export function highlightedClusters(value: string, tick: number, bandWidth = 2): readonly HighlightPart[] {
  const clusters: string[] = [];
  for (let at = 0; at < value.length;) {
    const length = clusterLength(value, at) || 1;
    clusters.push(value.slice(at, at + length));
    at += length;
  }
  if (clusters.length === 0) return [];
  const start = tick % clusters.length;
  return clusters.map((text, index) => ({
    text,
    active: (index - start + clusters.length) % clusters.length < Math.min(bandWidth, clusters.length),
  }));
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
  const pulse = PULSE[tick % PULSE.length] as string;
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
            <Text key={index} color={color(part.active ? 'accentBright' : 'accent')} bold={part.active}>
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
