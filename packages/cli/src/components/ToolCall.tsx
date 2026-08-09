import React from 'react';
import { Box, Text } from 'ink';

import { Diff } from './Diff.js';
import { useSpinnerFrame } from './Spinner.js';
import { highlightShell } from '../shell-highlight.js';
import { color, glyph, syntaxColor, truncate } from '../theme.js';
import type { PlanDisplayItem } from '../format.js';

export interface ToolCallProps {
  readonly name: string;
  readonly target?: string;
  readonly summary?: string;
  readonly output?: string;
  readonly diff?: string;
  readonly edits?: readonly { readonly path: string; readonly diff: string }[];
  readonly planItems?: readonly PlanDisplayItem[];
  readonly executions?: readonly { readonly kind?: 'Read' | 'List'; readonly target?: string; readonly output?: string; readonly ok?: boolean }[];
  readonly expand?: boolean;
  readonly ok: boolean;
  readonly running: boolean;
  readonly width: number;
  readonly maxOutputLines?: number;
}

const COLLAPSED_OUTPUT_LINES = 5;

export function ToolCall({ name, target, summary, output, diff, edits, planItems, executions, expand = false, ok, running, width, maxOutputLines }: ToolCallProps): React.ReactElement {
  const spinner = useSpinnerFrame(80, running);
  const bullet = running ? spinner : glyph.tool;
  const targetLines = target ? wrapLine(target, Math.max(18, width - name.length - 4)) : [];
  const outputLines = cleanOutput(output ?? '');
  const limit = maxOutputLines ?? COLLAPSED_OUTPUT_LINES;
  const shown = expand || outputLines.length <= limit ? outputLines : [...outputLines.slice(0, 2), ...outputLines.slice(-2)];
  const hidden = outputLines.length - shown.length;
  const quiet = name === 'Executed';

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color(running ? 'muted' : ok ? 'ghost' : 'warn')}>{bullet} </Text>
        <Text color={color(ok ? quiet ? 'muted' : 'text' : 'warn')} bold={!quiet}>{name}</Text>
        {targetLines[0] ? <><Text> </Text><Command value={targetLines[0]} shell={name === 'Ran'} /></> : null}
        {summary ? <Text color={color('ghost')}> {summary}</Text> : null}
      </Box>
      {targetLines.slice(1).map((line, index) => (
        <Box key={`target-${index}`}><Text color={color('ghost')}>  {glyph.rail} </Text><Command value={line} shell={name === 'Ran'} /></Box>
      ))}
      {executions?.length ? (
        <ExecutionGroup executions={executions} expand={expand} width={width} />
      ) : planItems?.length ? (
        <PlanItems items={planItems} expand={expand} width={width} />
      ) : edits?.length ? (
        <Box flexDirection="column">
          {edits.map((edit, index) => (
            <Box key={`${edit.path}:${index}`} flexDirection="column" paddingLeft={2}>
              <Box><Text color={color('ghost')}>{glyph.branch} </Text><Text color={color('muted')} bold>{edit.path}</Text></Box>
              <Diff diff={edit.diff} width={width - 6} path={edit.path} expand={expand} />
            </Box>
          ))}
        </Box>
      ) : diff ? (
        <Diff diff={diff} width={width - 4} expand={expand} {...(target ? { path: target } : {})} />
      ) : shown.length > 0 ? (
        <Box flexDirection="column">
          <Text color={color('ghost')}>  {glyph.branch}</Text>
          {shown.map((line, index) => <Text key={index} color={color(ok ? 'muted' : 'warn')}>{'    '}{truncate(line, Math.max(12, width - 4))}</Text>)}
          {hidden > 0 ? <Text color={color('ghost')}>{'    '}… +{hidden} lines (ctrl + t to view transcript)</Text> : null}
          {expand && outputLines.length > limit ? <Text color={color('ghost')}>{'    '}ctrl + t to collapse transcript</Text> : null}
        </Box>
      ) : null}
    </Box>
  );
}

function ExecutionGroup({ executions, expand, width }: { readonly executions: readonly { readonly kind?: 'Read' | 'List'; readonly target?: string; readonly output?: string; readonly ok?: boolean }[]; readonly expand: boolean; readonly width: number }): React.ReactElement | null {
  if (!expand) return null;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {executions.map((execution, index) => (
        <Box key={`${execution.target ?? 'call'}:${index}`} flexDirection="column">
          <Text color={color('muted')}>
            {glyph.branch} {execution.kind ? `${execution.kind} ` : ''}{truncate(execution.target ?? `call ${index + 1}`, Math.max(12, width - 10))}
          </Text>
          {cleanOutput(execution.output ?? '').map((line, lineIndex) => (
            <Text key={lineIndex} color={color('ghost')}>
              {'  '}{glyph.rail} {truncate(line, Math.max(12, width - 6))}
            </Text>
          ))}
        </Box>
      ))}
      <Text color={color('ghost')}>ctrl + t to collapse transcript</Text>
    </Box>
  );
}

function PlanItems({ items, expand, width }: { readonly items: readonly PlanDisplayItem[]; readonly expand: boolean; readonly width: number }): React.ReactElement {
  const visible = expand ? items : items.slice(0, 4);
  const hidden = items.length - visible.length;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {visible.map((item, index) => {
        const marker = item.status === 'completed' ? glyph.done : item.status === 'in_progress' ? glyph.caret : glyph.pending;
        const tone = item.status === 'in_progress' ? 'text' : item.status === 'completed' ? 'ghost' : 'muted';
        return (
          <Text key={`${item.step}:${index}`} color={color(tone)} bold={item.status === 'in_progress'}>
            {marker} {truncate(item.step, Math.max(12, width - 4))}
          </Text>
        );
      })}
      {hidden > 0 ? <Text color={color('ghost')}>… +{hidden} checkpoints (ctrl + t to view plan)</Text> : null}
      {expand && items.length > 4 ? <Text color={color('ghost')}>ctrl + t to collapse plan</Text> : null}
    </Box>
  );
}

function Command({ value, shell }: { value: string; shell: boolean }): React.ReactElement {
  if (!shell) return <Text color={color('muted')}>{value}</Text>;
  return <Text>{highlightShell(value).map((token, index) => <Text key={index} color={syntaxColor(token.kind)} bold={token.kind === 'command'}>{token.text}</Text>)}</Text>;
}

function cleanOutput(output: string): string[] {
  return output.trimEnd().split(/\r?\n/).filter((line) => line && !/^(?:stdout|stderr):$/i.test(line) && !/^exit 0$/.test(line));
}

function wrapLine(value: string, width: number): string[] {
  const lines: string[] = [];
  let rest = value.trim();
  while (rest.length > width) {
    const found = rest.slice(0, width + 1).lastIndexOf(' ');
    const at = found > 0 ? found : width;
    lines.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) lines.push(rest);
  return lines;
}

export function summariseOutput(output: string, exitCode: number | null): string | undefined {
  const lines = cleanOutput(output);
  if (exitCode !== null && exitCode !== 0) return `exit ${exitCode} · ${lines.length} lines`;
  if (lines.length === 0) return 'no output';
  return `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`;
}
