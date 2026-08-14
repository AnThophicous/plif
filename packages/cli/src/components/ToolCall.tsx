import React from 'react';
import { Box, Text } from 'ink';

import { Diff, DiffSummary } from './Diff.js';
import { useSpinnerFrame } from './Spinner.js';
import { highlightShell } from '../shell-highlight.js';
import { color, glyph, syntaxColor, truncate } from '../theme.js';
import type { PlanDisplayItem, ToolCategory } from '../format.js';

export interface ToolCallProps {
  readonly name: string;
  readonly category?: ToolCategory;
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

const CATEGORY: Record<ToolCategory, { label: string; marker: keyof typeof glyph; tone: Parameters<typeof color>[0] }> = {
  shell: { label: 'Shell', marker: 'shell', tone: 'accent' },
  read: { label: 'Read', marker: 'read', tone: 'info' },
  list: { label: 'List', marker: 'list', tone: 'info' },
  search: { label: 'Search', marker: 'network', tone: 'info' },
  edit: { label: 'Edit', marker: 'edit', tone: 'success' },
  network: { label: 'Network', marker: 'network', tone: 'info' },
  agent: { label: 'Agent', marker: 'agent', tone: 'accent' },
  plan: { label: 'Plan', marker: 'step', tone: 'accentDim' },
  question: { label: 'Question', marker: 'question', tone: 'warn' },
  memory: { label: 'Memory', marker: 'step', tone: 'accentDim' },
  external: { label: 'External', marker: 'network', tone: 'warn' },
  tool: { label: 'Tool', marker: 'tool', tone: 'muted' },
};

export function ToolCall({ name, category = 'tool', target, summary, output, diff, edits, planItems, executions, expand = false, ok, running, width, maxOutputLines }: ToolCallProps): React.ReactElement {
  const spinner = useSpinnerFrame(80, running);
  const identity = CATEGORY[category];
  const targetLines = target ? wrapLine(target, Math.max(18, width - identity.label.length - name.length - 7)) : [];
  const outputLines = cleanOutput(output ?? '');
  const limit = maxOutputLines ?? COLLAPSED_OUTPUT_LINES;
  const shown = expand || outputLines.length <= limit ? outputLines : [...outputLines.slice(0, 2), ...outputLines.slice(-2)];
  const hidden = outputLines.length - shown.length;
  const quiet = name === 'Executed';

  /*
    `Update(path)` rather than `± Edit · Update path 3 lines ✓`.

    The old header said the same thing up to four ways: a category glyph, a
    category label, the verb, and a tick that only ever meant "not red". A
    reader scanning twenty of these does not need the taxonomy — they need the
    verb and what it was done to, which is exactly what a function call already
    reads as. Failure keeps its mark, because that is the one status worth
    interrupting the scan for; success is carried by the bullet's colour.
  */
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color(running ? 'accent' : ok ? 'accentDim' : 'danger')}>
          {running ? spinner : glyph.tool}{' '}
        </Text>
        <Text color={color(quiet ? 'muted' : 'text')} bold={!quiet}>{name}</Text>
        {targetLines[0] ? (
          <>
            <Text color={color('ghost')}>(</Text>
            <Command value={targetLines[0]} shell={category === 'shell'} />
            <Text color={color('ghost')}>{targetLines.length > 1 ? '…' : ''})</Text>
          </>
        ) : null}
        {!ok && <Text color={color('danger')}> {glyph.failed}</Text>}
      </Box>
      {summary && !diff && !edits?.length ? (
        <Box><Text color={color('ghost')}>  {summary}</Text></Box>
      ) : null}
      {executions?.length ? (
        <ExecutionGroup executions={executions} expand={expand} width={width} />
      ) : planItems?.length ? (
        <PlanItems items={planItems} expand={expand} width={width} />
      ) : edits?.length ? (
        <Box flexDirection="column">
          {edits.map((edit, index) => (
            <Box key={`${edit.path}:${index}`} flexDirection="column" paddingLeft={2}>
              <Box><Text color={color('ghost')}>{glyph.branch} </Text><Text color={color('muted')} bold>{edit.path}</Text></Box>
              <Box paddingLeft={2}><DiffSummary diff={edit.diff} /></Box>
              <Diff diff={edit.diff} width={width - 6} path={edit.path} expand={expand} />
            </Box>
          ))}
        </Box>
      ) : diff ? (
        <Box flexDirection="column">
          {/* What changed, before how it changed. The count is the part most
              reads of a diff actually stop at. */}
          <Box paddingLeft={2}><DiffSummary diff={diff} /></Box>
          <Diff diff={diff} width={width - 4} expand={expand} {...(target ? { path: target } : {})} />
        </Box>
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

/**
 * How many of each thing a batch did, in one line.
 *
 * "Reading 6 files, running 11 shell commands" is what a person would say if
 * you asked them what the agent was up to. Eleven separate rows saying `Bash`
 * is what a log says, and a log is not what somebody watching wants.
 */
export function summariseExecutions(
  executions: readonly { readonly kind?: 'Read' | 'List'; readonly target?: string }[],
  running: boolean,
): string {
  const counts = new Map<string, number>();
  for (const execution of executions) {
    const noun = execution.kind === 'Read' ? 'file' : execution.kind === 'List' ? 'directory' : 'shell command';
    counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  const verbFor = (noun: string): string =>
    noun === 'file' ? (running ? 'reading' : 'read')
      : noun === 'directory' ? (running ? 'listing' : 'listed')
      : running ? 'running' : 'ran';

  const parts = [...counts].map(
    ([noun, count]) => `${verbFor(noun)} ${count} ${count === 1 ? noun : `${noun}s`}`,
  );
  const joined = parts.join(', ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function ExecutionGroup({ executions, expand, width }: { readonly executions: readonly { readonly kind?: 'Read' | 'List'; readonly target?: string; readonly output?: string; readonly ok?: boolean }[]; readonly expand: boolean; readonly width: number }): React.ReactElement | null {
  if (!expand) {
    // Collapsed, a batch is one line plus the single item worth naming — the
    // most recent one, because that is the one still in flight.
    const last = executions.at(-1)?.target;
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color={color('ghost')}>{summariseExecutions(executions, false)}</Text>
        {last ? (
          <Text color={color('faint')}>
            {glyph.hook}  {truncate(last, Math.max(12, width - 6))}
          </Text>
        ) : null}
      </Box>
    );
  }
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
