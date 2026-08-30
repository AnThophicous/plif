import React from 'react';
import { Box, Text } from '../ui.js';

import type { DiscoveryCall } from '../session.js';
import { color, glyph, truncate } from '../theme.js';

export function discoveryHeight(calls: readonly DiscoveryCall[], open: boolean): number {
  if (calls.length === 0) return 0;
  if (!open) return 1;
  return 2 + calls.slice(-8).reduce(
    (total, call) => total + 1 + (call.kind === 'List' ? Math.min(5, call.output?.split(/\r?\n/).filter(Boolean).length ?? 0) : 0),
    0,
  );
}

export function Discovery({ calls, open, width }: { readonly calls: readonly DiscoveryCall[]; readonly open: boolean; readonly width: number }): React.ReactElement | null {
  if (calls.length === 0) return null;
  const reads = calls.filter((call) => call.kind === 'Read').length;
  const lists = calls.filter((call) => call.kind === 'List').length;
  const summary = [
    reads ? `${glyph.read} Read ${reads}x` : '',
    lists ? `${glyph.list} List ${lists}x` : '',
  ].filter(Boolean).join(` ${glyph.divider} `);
  const recent = calls.slice(-8);

  return (
    <Box flexDirection="column" paddingX={1} width="100%">
      {open && (
        <Box flexDirection="column" paddingLeft={2}>
          {recent.map((call) => {
            const lines = call.kind === 'List' ? (call.output ?? '').split(/\r?\n/).filter(Boolean).slice(0, 5) : [];
            return (
              <Box key={call.id} flexDirection="column">
                <Text color={color('info')}>
                  {call.kind === 'Read' ? glyph.read : glyph.list} {call.kind}{' '}
                  <Text color={color('muted')}>{truncate(call.target ?? '', Math.max(12, width - 14))}</Text>{' '}
                  <Text color={color(call.ok === false ? 'danger' : call.ok ? 'success' : 'accent')}>
                    {call.ok === undefined ? glyph.pending : call.ok ? glyph.done : glyph.failed}
                  </Text>
                </Text>
                {lines.map((line, index) => <Text key={index} color={color('ghost')}>  {glyph.rail} {truncate(line, Math.max(12, width - 8))}</Text>)}
              </Box>
            );
          })}
          {calls.length > recent.length && <Text color={color('ghost')}>… +{calls.length - recent.length} earlier calls</Text>}
        </Box>
      )}
      <Text color={color('info')}>{summary}<Text color={color('ghost')}>  {glyph.divider} Ctrl+T {open ? 'collapse' : 'inspect'}</Text></Text>
    </Box>
  );
}
