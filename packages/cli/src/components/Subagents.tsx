import React from 'react';
import { Box, Text } from 'ink';

import { Meter } from './Meter.js';
import { useSpinnerFrame } from './Spinner.js';
import type { SubagentLine, SubagentView } from '../session.js';
import { color, formatDuration, glyph, layout, truncate } from '../theme.js';

interface SubagentsProps {
  readonly views: readonly SubagentView[];
  readonly focus: number;
  readonly open: boolean;
  readonly width: number;
  readonly now: number;
}

const VISIBLE_LINES = 6;

export function subagentsHeight(views: readonly SubagentView[], open: boolean): number {
  if (views.length === 0) return 0;
  return 1 + (open ? VISIBLE_LINES + 3 : 0);
}

export function Subagents({
  views,
  focus,
  open,
  width,
}: SubagentsProps): React.ReactElement | null {
  const spinner = useSpinnerFrame(80, views.length > 0);
  if (views.length === 0) return null;

  const index = Math.min(Math.max(0, focus), views.length - 1);
  const active = views[index] as SubagentView;
  const inner = width - layout.gutter * 2;

  return (
    <Box flexDirection="column" paddingX={layout.gutter} width="100%">
      {open && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
          <Meter
            value={active.contextUsed}
            max={active.contextMax}
            width={4}
            label={`Context ${Math.round((active.contextUsed / Math.max(1, active.contextMax)) * 100)}%`}
          />
          {active.thinkingSince !== null && (
            <Text color={color('faint')}>{spinner} reasoning</Text>
          )}
          {active.lines.slice(-VISIBLE_LINES).map((line, position) => (
            <ActivityLine key={position} line={line} width={inner - 2} spinner={spinner} />
          ))}
        </Box>
      )}
      <Box>
        <Text color={color('ghost')}>{glyph.task} Agents {views.length}  </Text>
        <Text color={color('muted')}>{spinner} </Text>
        <Text color={color('text')} bold>{glyph.caret} {truncate(active.title, Math.max(12, inner - 62))}</Text>
        {views.length > 1 && <Text color={color('ghost')}>  +{views.length - 1}</Text>}
        <Text color={color('ghost')}>  {glyph.divider} Tab select {glyph.divider} Ctrl+S {open ? 'close' : 'inspect'} {glyph.divider} Ctrl+X stop</Text>
      </Box>
    </Box>
  );
}

function ActivityLine({
  line,
  width,
  spinner,
}: {
  line: SubagentLine;
  width: number;
  spinner: string;
}): React.ReactElement {
  if (line.kind === 'thinking') {
    return (
      <Box>
        <Text color={color('ghost')}>{glyph.step} </Text>
        <Text color={color('faint')}>{formatDuration(line.durationMs ?? 0)}</Text>
      </Box>
    );
  }

  if (line.kind === 'text') {
    return (
      <Box>
        <Text color={color('ghost')}>{glyph.rail} </Text>
        <Text color={color('muted')}>{truncate(line.label, width - 2)}</Text>
      </Box>
    );
  }

  if (line.kind === 'reasoning') {
    return (
      <Box>
        <Text color={color('ghost')}>{glyph.rail} </Text>
        <Text color={color('faint')} italic>{truncate(line.label, width - 2)}</Text>
      </Box>
    );
  }

  const pending = line.ok === undefined;
  return (
    <Box>
      <Text color={color(pending ? 'muted' : line.ok ? 'ghost' : 'danger')}>
        {pending ? spinner : line.ok ? glyph.done : glyph.failed}{' '}
      </Text>
      <Text color={color('muted')}>{truncate(line.label, width - 12)}</Text>
      {line.durationMs !== undefined && (
        <Text color={color('ghost')}> {formatDuration(line.durationMs)}</Text>
      )}
    </Box>
  );
}
