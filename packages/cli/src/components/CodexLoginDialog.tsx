import React from 'react';
import { Box, Text } from '../ui.js';

import { color, glyph } from '../theme.js';

export type CodexLoginStatus = 'starting' | 'waiting' | 'error';

export interface CodexLoginDialogProps {
  readonly status: CodexLoginStatus;
  readonly width: number;
  readonly detail?: string;
  readonly userCode?: string;
}

/** The in-app shell around the official ChatGPT browser sign-in. */
export const CodexLoginDialog = React.memo(function CodexLoginDialog({
  status,
  width,
  detail,
  userCode,
}: CodexLoginDialogProps): React.ReactElement {
  const title = status === 'error' ? 'ChatGPT sign-in failed' : 'Connect OpenAI Codex';
  const message = status === 'starting'
    ? 'Preparing the official ChatGPT sign-in…'
    : status === 'waiting'
      ? 'The official sign-in window is open. Finish there to return to PLIF.'
      : detail ?? 'The Codex app-server could not start authentication.';

  return (
    <Box
      width="100%"
      flexDirection="column"
      borderStyle="round"
      borderColor={color(status === 'error' ? 'danger' : 'accentBorder')}
      paddingX={2}
      paddingY={1}
    >
      <Box width="100%" justifyContent="space-between">
        <Text color={color(status === 'error' ? 'danger' : 'accentBright')} bold>
          {status === 'error' ? glyph.failed : glyph.sparkle} {title}
        </Text>
        <Text color={color('muted')}>Esc cancel</Text>
      </Box>
      <Text color={color('text')}>{message}</Text>
      {userCode && (
        <Box marginTop={1}>
          <Text color={color('accentBright')} bold>Device code: </Text>
          <Text color={color('text')}>{userCode}</Text>
        </Box>
      )}
      <Text color={color('muted')}>
        PLIF never asks for or displays your ChatGPT token.
      </Text>
      <Text color={color('faint')}>
        {width < 72 ? 'Esc cancels' : 'Esc cancels without changing the current provider'}
      </Text>
    </Box>
  );
});

CodexLoginDialog.displayName = 'CodexLoginDialog';
