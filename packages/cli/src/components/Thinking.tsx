import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

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
const PULSE_EVERY_MS = 400;
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
        <Text color={color('accent')}>{verb}…</Text>
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
