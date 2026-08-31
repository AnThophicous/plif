import React from 'react';
import { Box, Text } from '../ui.js';

import { Diff, DiffSummary } from './Diff.js';
import { useSpinnerFrame } from './Spinner.js';
import { highlightShell } from '../shell-highlight.js';
import { color, glyph, syntaxColor, truncate } from '../theme.js';
import { displayUrl } from '../format.js';
import type { PlanDisplayItem, SearchHit, ToolCategory } from '../format.js';
import { highlight, languageOf } from '../highlight.js';
import { useAnimationFrame } from '../hooks/useAnimationClock.js';
import { displayWidth, wrapTerminalText } from '../text.js';

export interface ToolCallProps {
  readonly name: string;
  readonly category?: ToolCategory;
  readonly target?: string;
  readonly summary?: string;
  readonly output?: string;
  readonly diff?: string;
  readonly edits?: readonly { readonly path: string; readonly diff: string }[];
  readonly planItems?: readonly PlanDisplayItem[];
  readonly searchResults?: readonly SearchHit[];
  readonly executions?: readonly { readonly kind?: 'Read' | 'List'; readonly target?: string; readonly output?: string; readonly ok?: boolean }[];
  /** Complete source supplied to a file creation/edit tool. */
  readonly code?: string;
  readonly codeMode?: 'creating' | 'editing';
  readonly codePath?: string;
  readonly codeAdded?: number;
  readonly codeRemoved?: number;
  readonly expand?: boolean;
  readonly ok: boolean;
  readonly running: boolean;
  readonly width: number;
  readonly maxOutputLines?: number;
}

const COLLAPSED_OUTPUT_LINES = Number.MAX_SAFE_INTEGER;
export const COLLAPSED_SEARCH_HITS = 3;

const FILE_ACTIVITY_FRAMES = [
  '\u2722', '\u2723', '\u2732', '\u2735', '\u2736', '\u2737',
  '\u2738', '\u2739', '\u273a', '\u273b', '\u273c', '\u273d',
] as const;

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

export function ToolCall({ name, category = 'tool', target, summary, output, diff, edits, planItems, searchResults, executions, code, codeMode = 'editing', codePath, codeAdded = 0, codeRemoved = 0, expand = false, ok, running, width, maxOutputLines }: ToolCallProps): React.ReactElement {
  const spinner = useSpinnerFrame(80, running);
  const identity = CATEGORY[category];
  const targetLines = target ? wrapLine(target, Math.max(18, width - identity.label.length - name.length - 7)) : [];
  const outputLines = cleanOutput(output ?? '');
  const limit = maxOutputLines ?? COLLAPSED_OUTPUT_LINES;
  const shown = expand || outputLines.length <= limit
    ? outputLines
    : outputLines;
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
      {code !== undefined ? (
        <FileActivity
          code={code}
          mode={codeMode}
          path={codePath ?? target ?? 'file'}
          added={codeAdded}
          removed={codeRemoved}
          running={running}
          width={width}
        />
      ) : null}
      {searchResults?.length ? (
        <SearchResults hits={searchResults} expand={expand} width={width} />
      ) : executions?.length ? (
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
          {shown.flatMap((line, index) => wrapTerminalText(line, Math.max(1, width - 6)).map((part, partIndex) => (
            <Text key={`${index}:${partIndex}`} color={color(ok ? 'muted' : 'warn')}>{'    '}{part || ' '}</Text>
          )))}
          {hidden > 0 ? <Text color={color('ghost')}>{'    '}… {hidden} more {hidden === 1 ? 'line' : 'lines'} hidden {glyph.divider} Ctrl+E</Text> : null}
          {expand && outputLines.length > limit ? <Text color={color('ghost')}>{'    '}{outputLines.length} lines {glyph.divider} Ctrl+E to collapse</Text> : null}
        </Box>
      ) : null}
      {(diff || edits?.length) && outputLines.length > 0 ? (
        <Box flexDirection="column" paddingLeft={2}>
          {shown.flatMap((line, index) => wrapTerminalText(line, Math.max(1, width - 6)).map((part, partIndex) => (
            <Text key={`${index}:${partIndex}`} color={color(ok ? 'muted' : 'warn')}>
              {index === 0 && partIndex === 0 ? `${glyph.hook} ` : '  '}{part || ' '}
            </Text>
          )))}
          {hidden > 0 ? (
            <Text color={color('ghost')}>… {hidden} more {hidden === 1 ? 'line' : 'lines'} · Ctrl+E</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function FileActivity({
  code,
  mode,
  path,
  added,
  removed,
  running,
  width,
}: {
  readonly code: string;
  readonly mode: 'creating' | 'editing';
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly running: boolean;
  readonly width: number;
}): React.ReactElement {
  const frame = useAnimationFrame(running, 'slow');
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const visibleCount = running
    ? Math.min(lines.length, Math.max(1, (frame + 1) * 4))
    : lines.length;
  const visible = lines.slice(0, visibleCount);
  const gutter = String(Math.max(1, lines.length)).length;
  const codeWidth = Math.max(1, width - gutter - 7);
  const language = languageOf(path);
  const activityGlyph = running
    ? FILE_ACTIVITY_FRAMES[frame % FILE_ACTIVITY_FRAMES.length]
    : '\u273d';
  const label = mode === 'creating' ? 'Creating' : 'Editing';
  const codeRows = visible.reduce(
    (total, line) => total + wrapTerminalText(line, codeWidth).length,
    0,
  );
  // The custom Slate border adapter receives an explicit content height. It
  // must include the code margin and language label or the final source line
  // would sit underneath the bottom border on a tall file.
  const panelHeight = codeRows + 6 + (language ? 1 : 0);

  return (
    <Box
      flexDirection="column"
      width={Math.max(12, width)}
      height={panelHeight}
      marginTop={1}
      borderStyle="round"
      borderColor={color(running ? 'accentDim' : 'faint')}
      paddingX={1}
    >
      <Box>
        <Text color={color(running ? 'accent' : 'success')}>{activityGlyph} </Text>
        <Text color={color('text')} bold>{label} - {path}</Text>
        <Text color={color('muted')}> (+{added} | -{removed})</Text>
      </Box>
      {language && <Text color={color('ghost')}>  {language}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {visible.flatMap((line, lineIndex) => wrapTerminalText(line, codeWidth).map((part, partIndex) => (
          <Box key={`${lineIndex}:${partIndex}`}>
            <Text color={color('ghost')}>
              {partIndex === 0
                ? `  ${String(lineIndex + 1).padStart(gutter)}  `
                : ' '.repeat(gutter + 4)}
            </Text>
            <Text color={color('muted')}>
              {highlight(part, language).map((token, tokenIndex) => (
                <Text key={tokenIndex} color={syntaxColor(token.kind)}>{token.text}</Text>
              ))}
              {part.length === 0 ? ' ' : ''}
              {displayWidth(part) < codeWidth ? ' '.repeat(codeWidth - displayWidth(part)) : ''}
            </Text>
          </Box>
        )))}
      </Box>
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
          {cleanOutput(execution.output ?? '').flatMap((line, lineIndex) => wrapTerminalText(line, Math.max(1, width - 8)).map((part, partIndex) => (
            <Text key={`${lineIndex}:${partIndex}`} color={color('ghost')}>
              {'  '}{glyph.rail} {part || ' '}
            </Text>
          )))}
        </Box>
      ))}
      <Text color={color('ghost')}>Ctrl+E to collapse</Text>
    </Box>
  );
}

function SearchResults({ hits, expand, width }: { readonly hits: readonly SearchHit[]; readonly expand: boolean; readonly width: number }): React.ReactElement {
  const visible = expand ? hits : hits.slice(0, COLLAPSED_SEARCH_HITS);
  const hidden = hits.length - visible.length;
  const column = Math.max(12, width - 8);

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {visible.map((hit) => (
        <Box key={`${hit.rank}:${hit.url}`} flexDirection="column">
          <Box>
            <Text color={color('ghost')}>{glyph.hook} </Text>
            <Text color={color('text')}>{truncate(hit.title, column)}</Text>
          </Box>
          <Box>
            <Text color={color('ghost')}>{'   '}</Text>
            <Text color={color('accentDim')}>{displayUrl(hit.url, column)}</Text>
          </Box>
          {expand && hit.snippet ? (
            <Box>
              <Text color={color('ghost')}>{'   '}</Text>
              <Text color={color('faint')}>{truncate(hit.snippet, column)}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
      {hidden > 0 ? (
        <Text color={color('ghost')}>… {hidden} more {hidden === 1 ? 'result' : 'results'} {glyph.divider} Ctrl+E</Text>
      ) : null}
      {expand && hits.length > COLLAPSED_SEARCH_HITS ? (
        <Text color={color('ghost')}>{hits.length} results {glyph.divider} Ctrl+E to collapse</Text>
      ) : null}
    </Box>
  );
}

export function searchResultsHeight(hits: readonly SearchHit[], expand: boolean): number {
  const visible = expand ? hits.length : Math.min(hits.length, COLLAPSED_SEARCH_HITS);
  const snippets = expand ? hits.filter((hit) => hit.snippet).length : 0;
  const trailer = (expand ? hits.length > COLLAPSED_SEARCH_HITS : hits.length > visible) ? 1 : 0;
  return visible * 2 + snippets + trailer;
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
      {hidden > 0 ? <Text color={color('ghost')}>… +{hidden} checkpoints · Ctrl+E to expand</Text> : null}
      {expand && items.length > 4 ? <Text color={color('ghost')}>Ctrl+E to collapse</Text> : null}
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
