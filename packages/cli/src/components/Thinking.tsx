import React from 'react';
import { Box, Text } from 'ink';

import { activityGlyphAt, activityKindForLabel, activityVisual, GradientText } from '../activity-visuals.js';
import { ANIMATION_INTERVAL_MS, useAnimationFrame } from '../hooks/useAnimationClock.js';
import { color, formatCount, formatDuration, glyph, truncate } from '../theme.js';

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

const TIPS = [
  'Esc cancels without killing the container',
  'Prefix a line with ! to run a shell command yourself',
  '/model switches model mid-session',
  '/sandbox shows exactly what is enforced',
  'Skills load on demand — /skills lists them',
  '/audit --verify checks the hash chain',
];

const VERB_EVERY_MS = 4_000;
const TIP_AFTER_MS = 12_000;

export interface ThinkingProps {
  readonly since: number;
  readonly tokens: number;
  readonly label?: string;
  readonly width: number;
  readonly showTips?: boolean;
}

export function Thinking({
  since,
  tokens,
  label,
  width,
  showTips = true,
}: ThinkingProps): React.ReactElement {
  const clock = useAnimationFrame(true, 'slow');

  const elapsed = Date.now() - since;
  const verb =
    label ?? (VERBS[Math.floor(elapsed / VERB_EVERY_MS) % VERBS.length] as string);
  const kind = activityKindForLabel(verb);
  const visual = activityVisual(kind);
  const pulse = activityGlyphAt(kind, clock * ANIMATION_INTERVAL_MS);

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
        <GradientText value={verb} from={visual.gradient[0]} to={visual.gradient[1]} bold />
        <Text color={color('accent')}>…</Text>
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
