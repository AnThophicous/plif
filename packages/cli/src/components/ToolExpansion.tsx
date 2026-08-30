import React from 'react';
import { Box, Text } from '../ui.js';

import { ToolCall } from './ToolCall.js';
import type { TimelineEntry } from '../session.js';
import { color, glyph } from '../theme.js';

/**
 * Live details for a tool that has already entered Ink's append-only
 * scrollback. `<Static>` cannot repaint an old item when Ctrl+E is pressed,
 * so the details are intentionally rendered in the dynamic frame instead of
 * duplicating or resetting the whole transcript.
 */
export const ToolExpansion = React.memo(function ToolExpansion({
  entry,
  width,
}: {
  readonly entry: TimelineEntry;
  readonly width: number;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={color('faint')}
      paddingX={1}
      marginBottom={1}
    >
      <Box width="100%" justifyContent="space-between">
        <Text color={color('muted')} bold>{glyph.tool} TOOL DETAILS</Text>
        <Text color={color('ghost')}>Ctrl+E close</Text>
      </Box>
      <ToolCall
        name={entry.title}
        {...(entry.toolCategory !== undefined ? { category: entry.toolCategory } : {})}
        ok={entry.status !== 'failed'}
        running={entry.status === 'active'}
        width={Math.max(12, width - 4)}
        expand
        {...(entry.diff !== undefined ? { diff: entry.diff } : {})}
        {...(entry.edits !== undefined ? { edits: entry.edits } : {})}
        {...(entry.planItems !== undefined ? { planItems: entry.planItems } : {})}
        {...(entry.searchResults !== undefined ? { searchResults: entry.searchResults } : {})}
        {...(entry.executions !== undefined ? { executions: entry.executions } : {})}
        {...(entry.toolTarget !== undefined ? { target: entry.toolTarget } : {})}
        {...(entry.toolSummary !== undefined ? { summary: entry.toolSummary } : {})}
        {...(entry.detail !== undefined ? { output: entry.detail } : {})}
      />
    </Box>
  );
});

ToolExpansion.displayName = 'ToolExpansion';
