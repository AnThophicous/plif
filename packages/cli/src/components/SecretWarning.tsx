import React from 'react';
import { Box, Text } from 'ink';

import { color, glyph, truncate } from '../theme.js';

export type SecretWarningStage = 'first' | 'final';

export function SecretWarning({ stage, width }: { readonly stage: SecretWarningStage; readonly width: number }): React.ReactElement {
  const label = stage === 'first'
    ? 'Security gate · possible secret detected · review before sending'
    : 'Final security gate · secret still detected · choose carefully';
  return (
    <Box paddingX={1}>
      <Text color={color('danger')} bold>
        {glyph.question} {truncate(label, Math.max(12, width - 2))}
      </Text>
    </Box>
  );
}
