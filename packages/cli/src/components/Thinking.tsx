import React from 'react';
import { Box, Text } from 'ink';

import { highlightedClusters, useHighlightClock } from '../pulse.js';
import { color, formatCount, formatDuration, glyph, supportsRichGlyphs, truncate } from '../theme.js';
import { PlifGlow } from './PlifGlow.js';

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

const PULSE = supportsRichGlyphs ? ['•', '·', '•', '·'] : ['*', '+', '*', 'x'];
const PLIF_MARK = supportsRichGlyphs ? '+' : '*';

const TIPS = [
  'Esc cancels without killing the container',
  'Prefix a line with ! to run a shell command yourself',
  '/model switches model mid-session',
  '/sandbox shows exactly what is enforced',
  'Skills load on demand — /skills lists them',
  '/audit --verify checks the hash chain',
];

const VERB_EVERY_MS = 4_000;
const PULSE_EVERY_MS = 360;
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
  const clock = useHighlightClock();

  const elapsed = Date.now() - since;
  const verb =
    label ?? (VERBS[Math.floor(elapsed / VERB_EVERY_MS) % VERBS.length] as string);
  const plif = verb === 'Plif Thinking';
  const pulse = plif ? PLIF_MARK : PULSE[Math.floor(clock / PULSE_EVERY_MS) % PULSE.length] as string;

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
        {plif ? (
          <>
            <PlifGlow value={verb} elapsedMs={clock} />
            <Text color={color('accent')}>…</Text>
          </>
        ) : (
          <Text>
            {highlightedClusters(verb, clock).map((part, index) => (
              <Text key={index} color={part.color} bold={part.active}>
                {part.text}
              </Text>
            ))}
            <Text color={color('accent')}>…</Text>
          </Text>
        )}
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
