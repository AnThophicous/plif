import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import type { LspStatus, McpServerStatus, TaskSnapshot } from '@plif/core';
import type { SandboxCapabilityReport } from '@plif/sandbox';

import { mcpStatusKind } from './Browser.js';
import { useSpinnerFrame } from './Spinner.js';
import type { SubagentView, TimelineEntry } from '../session.js';
import { useLoadingSnapshot } from '../loading-state.js';
import { color, formatDuration, glyph, layout, truncate } from '../theme.js';

export type ActivityHudMode = 'closed' | 'compact' | 'expanded';

/** Compact is the default; the other two modes are explicit user choices. */
export const DEFAULT_ACTIVITY_HUD_MODE: ActivityHudMode = 'compact';

/** The compact HUD occupies two rows while work is visible. */
export const ACTIVITY_PANEL_ROWS = 2;

/** Expanded mode is a status HUD, not an unbounded server browser. */
export const MCP_DETAIL_LIMIT = 4;

export interface ActivitySummary {
  readonly input: string | null;
  readonly command: string | null;
  readonly mcps: readonly string[];
  readonly skills: readonly string[];
  readonly question: string | null;
}

export interface ActivityHudHeightOptions {
  readonly active?: boolean;
  readonly warnings?: readonly string[];
  readonly width?: number;
  /** null means that no LSP status source is available in this session. */
  readonly lspStatuses?: readonly LspStatus[] | null;
  /** Real MCP statuses used to budget the bounded expanded server list. */
  readonly mcpStatuses?: readonly McpServerStatus[];
}

/**
 * Project factual activity from the latest user turn. The summary is based
 * only on timeline rows already emitted by the engine; it never guesses that
 * a provider, MCP server, or skill was used.
 */
export function activitySummary(entries: readonly TimelineEntry[]): ActivitySummary {
  const start = entries.findLastIndex((item) => item.kind === 'input');
  if (start < 0) return { input: null, command: null, mcps: [], skills: [], question: null };

  let input: string | null = null;
  let command: string | null = null;
  let question: string | null = null;
  const mcps: string[] = [];
  const skills: string[] = [];

  for (const item of entries.slice(start)) {
    if (item.kind === 'input') {
      input = item.title;
      continue;
    }
    if (item.kind === 'question') {
      question = item.title;
      continue;
    }
    if (item.kind !== 'tool') continue;

    const target = item.toolTarget ?? item.title;
    if (item.toolCategory === 'external') {
      pushUnique(mcps, target);
    } else if (item.title.toLowerCase() === 'skill' || item.toolCategory === 'memory' && item.title.toLowerCase().includes('skill')) {
      pushUnique(skills, target);
    } else if (item.toolCategory !== 'memory') {
      command = item.toolTarget ? `${item.title} ${item.toolTarget}` : item.title;
    }
  }

  return { input, command, mcps, skills, question };
}

function pushUnique(values: string[], value: string): void {
  const normalized = value.trim();
  if (normalized && !values.includes(normalized)) values.push(normalized);
}

function activityDetail(summary: ActivitySummary): string {
  const facts: string[] = [];
  if (summary.input) facts.push(`input ${summary.input}`);
  if (summary.command) facts.push(`cmd ${summary.command}`);
  if (summary.mcps.length > 0) facts.push(`MCP ${summary.mcps.join(', ')}`);
  if (summary.skills.length > 0) facts.push(`skill ${summary.skills.join(', ')}`);
  if (summary.question) facts.push(`question ${summary.question}`);
  return facts.join(` ${glyph.divider} `) || 'waiting for activity';
}

function resolveMode(modeOrExpanded: ActivityHudMode | boolean): ActivityHudMode {
  if (typeof modeOrExpanded === 'boolean') return modeOrExpanded ? 'expanded' : DEFAULT_ACTIVITY_HUD_MODE;
  return modeOrExpanded;
}

function hasWork(
  tasks: readonly TaskSnapshot[],
  subagents: readonly SubagentView[],
  entries: readonly TimelineEntry[],
  options: ActivityHudHeightOptions,
): boolean {
  return Boolean(options.active) || operationalEntries(entries).length > 0 || tasks.length > 0 || subagents.length > 0;
}

/**
 * Keep App's vertical budget identical to the exact view mode that WorkDock
 * renders. This is intentionally pure so resize and mode tests can exercise
 * geometry without mounting Ink.
 */
export function workDockHeight(
  tasks: readonly TaskSnapshot[],
  subagents: readonly SubagentView[],
  modeOrExpanded: ActivityHudMode | boolean,
  entries: readonly TimelineEntry[] = [],
  options: ActivityHudHeightOptions = {},
): number {
  if (!hasWork(tasks, subagents, entries, options)) return 0;

  const mode = resolveMode(modeOrExpanded);
  if (mode === 'closed') return 1;
  if (mode === 'compact' || options.width !== undefined && options.width < 48) return ACTIVITY_PANEL_ROWS;

  // header + runtime + MCP summary + capabilities + LSP + current activity + controls
  const fixedRows = 7;
  const taskRows = Math.min(tasks.length, 3) + (tasks.length > 3 ? 1 : 0);
  const agentRows = Math.min(subagents.length, 3) + (subagents.length > 3 ? 1 : 0);
  const mcpRows = Math.min(options.mcpStatuses?.length ?? 0, MCP_DETAIL_LIMIT)
    + ((options.mcpStatuses?.length ?? 0) > MCP_DETAIL_LIMIT ? 1 : 0);
  const warningRows = options.warnings?.some((warning) => warning.trim()) ? 1 : 0;
  return fixedRows + taskRows + agentRows + mcpRows + warningRows;
}

/** Keep the dock to real inputs and commands from the latest turn. */
export function operationalEntries(entries: readonly TimelineEntry[]): readonly TimelineEntry[] {
  const start = entries.findLastIndex((item) => item.kind === 'input');
  if (start < 0) return [];
  return entries
    .slice(start)
    .filter((item) => item.kind === 'input' || item.kind === 'tool')
    .slice(-5);
}

export interface CapabilityCounts {
  readonly enabled: number;
  readonly total: number;
  readonly degraded: number;
}

export function capabilityCounts(report: SandboxCapabilityReport | null | undefined): CapabilityCounts | null {
  if (!report) return null;
  const checks = [
    report.killProcessTree,
    report.memoryLimit,
    report.processLimit,
    report.cpuLimit,
    report.filesystemWriteBlock,
    report.networkBlock,
    report.accounting,
  ];
  return {
    enabled: checks.filter(Boolean).length,
    total: checks.length,
    degraded: report.degradations.length,
  };
}

export interface McpCounts {
  readonly connected: number;
  readonly disconnected: number;
  readonly error: number;
}

export function mcpStatusCounts(statuses: readonly McpServerStatus[]): McpCounts {
  return statuses.reduce(
    (counts, status) => {
      counts[mcpStatusKind(status)] += 1;
      return counts;
    },
    { connected: 0, disconnected: 0, error: 0 },
  );
}

function mcpMark(kind: keyof McpCounts): string {
  return kind === 'connected' ? glyph.done : kind === 'disconnected' ? glyph.waiting : glyph.failed;
}

function statusLabel(
  active: boolean,
  phase: string,
  activeTool: string | null,
  tasks: readonly TaskSnapshot[],
  subagents: readonly SubagentView[],
): string {
  if (activeTool) return `tool ${activeTool}`;
  if (active && phase !== 'idle') return phase;
  if (tasks.length > 0 || subagents.length > 0) return 'work';
  return 'idle';
}

function contextLabel(contextUsed: number | undefined, contextMax: number | undefined): string {
  if (contextUsed === undefined || contextMax === undefined || contextMax <= 0) return 'ctx unavailable';
  return `ctx ${Math.round((Math.max(0, contextUsed) / contextMax) * 100)}%`;
}

function lspLabel(statuses: readonly LspStatus[] | null | undefined): string {
  if (statuses === null || statuses === undefined) return 'LSP unavailable';
  if (statuses.length === 0) return 'LSP not started';
  const ready = statuses.filter((status) => status.ready).length;
  const unavailable = statuses.length - ready;
  return `LSP ${ready} ready${unavailable > 0 ? ` ${unavailable} unavailable` : ''}`;
}

function warningLabel(warnings: readonly string[] | undefined): string | null {
  const warning = warnings?.find((item) => item.trim());
  return warning ? `warning ${warning}` : null;
}

export const WorkDock = React.memo(function WorkDock({
  tasks,
  subagents,
  subagentFocus,
  expanded,
  mode,
  active = false,
  width,
  now,
  entries,
  contextUsed,
  contextMax,
  mcpStatuses = [],
  capabilities,
  lspStatuses,
  sessionName,
  goal,
  warnings = [],
}: {
  readonly tasks: readonly TaskSnapshot[];
  readonly subagents: readonly SubagentView[];
  readonly subagentFocus: number;
  /** Compatibility prop for callers that have not migrated to `mode`. */
  readonly expanded?: boolean;
  readonly mode?: ActivityHudMode;
  readonly active?: boolean;
  readonly width: number;
  readonly now: number;
  readonly entries: readonly TimelineEntry[];
  readonly contextUsed?: number;
  readonly contextMax?: number;
  readonly mcpStatuses?: readonly McpServerStatus[];
  readonly capabilities?: SandboxCapabilityReport | null;
  readonly lspStatuses?: readonly LspStatus[] | null;
  readonly sessionName?: string | null;
  readonly goal?: string | null;
  readonly warnings?: readonly string[];
}): React.ReactElement | null {
  const hudMode = mode ?? resolveMode(expanded ?? false);
  // A narrow terminal cannot carry the expanded metadata without wrapping the
  // live surface. Keep the same mode in App's row budget and downgrade only
  // the presentation; the user's preference remains expanded for a later
  // resize.
  const visibleMode = hudMode === 'expanded' && width < 48 ? 'compact' : hudMode;
  const operations = useMemo(() => operationalEntries(entries), [entries]);
  const summary = useMemo(() => activitySummary(entries), [entries]);
  const loading = useLoadingSnapshot(active && visibleMode !== 'closed');
  const mcp = useMemo(() => mcpStatusCounts(mcpStatuses), [mcpStatuses]);
  const visibleMcpStatuses = useMemo(() => mcpStatuses.slice(0, MCP_DETAIL_LIMIT), [mcpStatuses]);
  const caps = useMemo(() => capabilityCounts(capabilities), [capabilities]);
  const taskActive = tasks.some((task) => task.status === 'running' || task.status === 'awaiting_approval');
  const agentActive = subagents.some((agent) => agent.status === 'running');
  const live = active || operations.length > 0 || taskActive || agentActive;
  const hasPanel = live || tasks.length > 0 || subagents.length > 0;
  const spinner = useSpinnerFrame(220, live && visibleMode !== 'closed');

  if (!hasPanel) return null;

  const panelWidth = Math.max(18, width - layout.gutter * 2);
  const contentWidth = Math.max(10, panelWidth - 2);
  const currentStatus = statusLabel(
    active,
    loading.phase,
    loading.activeTool?.name ?? null,
    tasks,
    subagents,
  );
  const warning = warningLabel(warnings);

  if (visibleMode === 'closed') {
    return (
      <Box paddingX={layout.gutter} width="100%">
        <Text color={color('ghost')}>{glyph.caret} activity closed {glyph.divider} Ctrl+S open</Text>
      </Box>
    );
  }

  if (visibleMode === 'compact') {
    const compact = [
      currentStatus,
      contextLabel(contextUsed, contextMax),
      `MCP ${mcp.connected}/${mcp.disconnected}/${mcp.error}`,
      caps ? `cap ${caps.enabled}/${caps.total}` : 'cap unavailable',
      loading.activeTool ? `tool ${loading.activeTool.name}` : null,
    ].filter(Boolean).join(` ${glyph.divider} `);
    return (
      <Box paddingX={layout.gutter} width="100%" flexDirection="column">
        <Box width={panelWidth} justifyContent="space-between">
          <Text color={color('muted')} bold wrap="truncate">{glyph.disclosure} ACTIVITY {glyph.divider} compact</Text>
          {width >= 48 && <Text color={color('ghost')}>Ctrl+S expand {glyph.divider} Esc close</Text>}
        </Box>
        <Text color={color(live ? 'accent' : 'muted')} wrap="truncate">
          {live ? spinner : glyph.done} {truncate(compact || activityDetail(summary), Math.max(1, contentWidth - 2))}
        </Text>
      </Box>
    );
  }

  const expandedWidth = Math.max(10, panelWidth);
  return (
    <Box paddingX={layout.gutter} width="100%" flexDirection="column">
      <Box width="100%" justifyContent="space-between">
        <Text color={color('muted')} bold>{glyph.disclosure} ACTIVITY {glyph.divider} expanded</Text>
        <Text color={color('ghost')}>Ctrl+S compact {glyph.divider} Esc close</Text>
      </Box>
      {tasks.slice(0, 3).map((task) => (
        <TaskLine key={task.id} task={task} spinner={spinner} width={expandedWidth} now={now} />
      ))}
      {tasks.length > 3 && <Text color={color('ghost')}>{`  ${glyph.rail} +${tasks.length - 3} more tasks`}</Text>}
      {subagents.slice(0, 3).map((agent, index) => (
        <AgentLine
          key={agent.taskId}
          agent={agent}
          selected={index === subagentFocus}
          spinner={spinner}
          width={expandedWidth}
          now={now}
        />
      ))}
      {subagents.length > 3 && <Text color={color('ghost')}>{`  ${glyph.rail} +${subagents.length - 3} more agents`}</Text>}
      <Text color={color('muted')} wrap="truncate">
        {glyph.rail} runtime {sessionName ? `${sessionName} ${glyph.divider} ` : ''}{goal ? `goal ${goal} ${glyph.divider} ` : ''}{currentStatus}
      </Text>
      <Box width={expandedWidth}>
        <Text color={color('success')}>{mcp.connected > 0 ? mcpMark('connected') : ' '}</Text>
        <Text color={color('muted')}> MCP {mcp.connected} connected</Text>
        <Text color={color('faint')}> {glyph.divider} </Text>
        <Text color={color(mcp.disconnected > 0 ? 'warn' : 'ghost')}>{mcp.disconnected > 0 ? mcpMark('disconnected') : ' '}</Text>
        <Text color={color('muted')}> {mcp.disconnected} disconnected</Text>
        <Text color={color('faint')}> {glyph.divider} </Text>
        <Text color={color(mcp.error > 0 ? 'danger' : 'ghost')}>{mcp.error > 0 ? mcpMark('error') : ' '}</Text>
        <Text color={color('muted')}> {mcp.error} error</Text>
      </Box>
      {visibleMcpStatuses.map((server) => {
        const kind = mcpStatusKind(server);
        const serverDetail = server.detail.trim();
        const detail = serverDetail ? ` ${glyph.divider} ${serverDetail}` : '';
        return (
          <Text key={`${server.name}:${server.transport}`} color={color(kind === 'connected' ? 'success' : kind === 'error' ? 'danger' : 'warn')} wrap="truncate">
            {glyph.rail} {mcpMark(kind)} {server.name} {kind} {glyph.divider} {server.toolCount} tools{detail}
          </Text>
        );
      })}
      {mcpStatuses.length > MCP_DETAIL_LIMIT && (
        <Text color={color('ghost')} wrap="truncate">
          {glyph.rail} +{mcpStatuses.length - MCP_DETAIL_LIMIT} more MCP servers
        </Text>
      )}
      <Text color={color(caps && caps.degraded > 0 ? 'warn' : 'muted')} wrap="truncate">
        {glyph.rail} capabilities {caps ? `${caps.enabled}/${caps.total}${caps.degraded > 0 ? ` ${glyph.divider} ${caps.degraded} degraded` : ''}` : 'unavailable'}
      </Text>
      <Text color={color('muted')} wrap="truncate">{glyph.rail} {lspLabel(lspStatuses)}</Text>
      <Text color={color('muted')} wrap="truncate">
        {glyph.rail} activity {truncate(activityDetail(summary), Math.max(1, contentWidth - 12))}
        {loading.completedTools > 0 ? ` ${glyph.divider} ${loading.completedTools} tools done` : ''}
        {loading.tokenSource === 'reported' || loading.tokenSource === 'estimated' ? ` ${glyph.divider} ${loading.tokens} tokens` : ''}
      </Text>
      {warning && <Text color={color('warn')} wrap="truncate">{glyph.rail} {truncate(warning, Math.max(1, contentWidth - 2))}</Text>}
      <Text color={color('ghost')}>Tab select {glyph.divider} Ctrl+S compact {glyph.divider} Esc close</Text>
    </Box>
  );
});

WorkDock.displayName = 'WorkDock';

function TaskLine({
  task,
  spinner,
  width,
  now,
}: {
  readonly task: TaskSnapshot;
  readonly spinner: string;
  readonly width: number;
  readonly now: number;
}): React.ReactElement {
  const running = task.status === 'running';
  const tone = task.status === 'awaiting_approval' ? 'warn' : running ? 'accent' : task.status === 'failed' || task.status === 'blocked' ? 'danger' : 'muted';
  const marker = running ? spinner : task.status === 'awaiting_approval' ? glyph.waiting : task.status === 'done' ? glyph.done : glyph.failed;
  const elapsed = now - (task.startedAt ?? task.createdAt);
  const status = `[${taskStatus(task.status)}]`;
  const statusWidth = formatDuration(elapsed).length + status.length + 2;
  const titleWidth = Math.max(10, width - statusWidth - 3);
  return (
    <Box width="100%" justifyContent="space-between">
      <Box width={titleWidth} flexShrink={1}>
        <Text color={color(tone)}>{marker} </Text>
        <Text color={color('muted')}>Task </Text>
        <Text color={color(running ? 'text' : 'muted')} wrap="truncate">
          {truncate(task.title, Math.max(8, titleWidth - 7))}
        </Text>
      </Box>
      <Text color={color(tone)}>{formatDuration(elapsed)} <Text color={color('ghost')}>{status}</Text></Text>
    </Box>
  );
}

function AgentLine({
  agent,
  selected,
  spinner,
  width,
  now,
}: {
  readonly agent: SubagentView;
  readonly selected: boolean;
  readonly spinner: string;
  readonly width: number;
  readonly now: number;
}): React.ReactElement {
  const running = agent.status === 'running';
  const recent = agent.lines.at(-1)?.label;
  const label = recent ? `${agent.title} ${glyph.divider} ${recent}` : agent.title;
  const status = `[${running ? 'run' : agent.status}]`;
  const statusWidth = formatDuration(now - agent.startedAt).length + status.length + 2;
  const titleWidth = Math.max(10, width - statusWidth - 3);
  return (
    <Box width="100%" justifyContent="space-between">
      <Box width={titleWidth} flexShrink={1}>
        <Text color={color(running ? 'accent' : 'ghost')}>{running ? spinner : glyph.done} </Text>
        <Text color={color(selected ? 'accentBright' : 'muted')} bold={selected}>Agent </Text>
        <Text color={color(selected ? 'text' : 'muted')} wrap="truncate">{truncate(label, Math.max(8, titleWidth - 8))}</Text>
      </Box>
      <Text color={color(running ? 'accent' : 'ghost')}>{formatDuration(now - agent.startedAt)} <Text color={color('ghost')}>{status}</Text></Text>
    </Box>
  );
}

function taskStatus(status: TaskSnapshot['status']): string {
  if (status === 'running') return 'run';
  if (status === 'awaiting_approval') return 'wait';
  if (status === 'done') return 'done';
  if (status === 'failed' || status === 'blocked') return 'fail';
  return 'idle';
}
