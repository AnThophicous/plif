import { formatCount, formatDuration, glyph, shortenPath } from './theme.js';
import { effortDisplay } from './effort-visuals.js';

export interface SessionUsage {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCalls: number;
  readonly turns: number;
  readonly subagentRuns: number;
  readonly subagentTokens: number;
}

export const emptySessionUsage: SessionUsage = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  turns: 0,
  subagentRuns: 0,
  subagentTokens: 0,
};

export interface StatusSnapshot {
  readonly model: string;
  readonly provider: string;
  readonly effort: string | undefined;
  readonly contextUsed: number;
  readonly contextMax: number;
  readonly elapsedMs: number;
  readonly usage: SessionUsage;
  readonly workspace: string;
  readonly container: string | null;
  readonly containerState: string | null;
  readonly permission: string;
  readonly autoApprove: boolean;
  readonly planMode: boolean;
  readonly goal: string | null;
  readonly mcpConnected: number;
  readonly mcpServers: number;
  readonly skills: number;
  readonly queued: number;
  readonly sessionId: string | null;
}

export type StatusInput = Omit<StatusSnapshot, 'permission' | 'autoApprove'>;

const LABEL_WIDTH = 11;

export function contextBar(used: number, max: number, cells = 12): string {
  const share = max > 0 ? Math.min(1, Math.max(0, used / max)) : 0;
  const filled = Math.round(share * cells);
  return glyph.meterFull.repeat(filled) + glyph.meterEmpty.repeat(Math.max(0, cells - filled));
}

export function contextPercent(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function row(label: string, value: string): string {
  return `${label.padEnd(LABEL_WIDTH)}${value}`;
}

const DOT = ` ${glyph.divider} `;

export function formatStatus(snapshot: StatusSnapshot, width = 72): string {
  const { usage } = snapshot;
  const lines: string[] = [];

  lines.push(row('model', [
    snapshot.model || 'not configured',
    snapshot.provider,
    snapshot.effort ? `effort ${effortDisplay(snapshot.effort)}` : '',
  ].filter(Boolean).join(DOT)));

  lines.push(row('context', [
    `${formatCount(snapshot.contextUsed)} / ${formatCount(snapshot.contextMax)}`,
    contextBar(snapshot.contextUsed, snapshot.contextMax),
    `${contextPercent(snapshot.contextUsed, snapshot.contextMax)}%`,
  ].join('  ')));

  lines.push(row('session', [
    formatDuration(snapshot.elapsedMs),
    `${usage.turns} ${usage.turns === 1 ? 'turn' : 'turns'}`,
    `${usage.toolCalls} tool ${usage.toolCalls === 1 ? 'call' : 'calls'}`,
    ...(snapshot.queued > 0 ? [`${snapshot.queued} queued`] : []),
  ].join(DOT)));

  lines.push(row('tokens', [
    `${formatCount(usage.inputTokens)} in`,
    `${formatCount(usage.outputTokens)} out`,
    `${usage.requests} ${usage.requests === 1 ? 'request' : 'requests'}`,
  ].join(DOT)));

  if (usage.subagentRuns > 0) {
    lines.push(row('delegated', [
      `${usage.subagentRuns} ${usage.subagentRuns === 1 ? 'subagent' : 'subagents'}`,
      `${formatCount(usage.subagentTokens)} tokens`,
    ].join(DOT)));
  }

  lines.push(row('workspace', shortenPath(snapshot.workspace, Math.max(20, width - LABEL_WIDTH))));

  lines.push(row('container', snapshot.container
    ? `${snapshot.container}${snapshot.containerState ? ` (${snapshot.containerState})` : ''}`
    : 'none yet'));

  lines.push(row('approvals', [
    snapshot.permission,
    snapshot.autoApprove ? 'auto-approve on' : 'auto-approve off',
    ...(snapshot.planMode ? ['plan mode'] : []),
  ].join(DOT)));

  lines.push(row('extensions', [
    `${snapshot.mcpConnected}/${snapshot.mcpServers} MCP`,
    `${snapshot.skills} ${snapshot.skills === 1 ? 'skill' : 'skills'}`,
  ].join(DOT)));

  if (snapshot.goal) lines.push(row('goal', snapshot.goal));
  if (snapshot.sessionId) lines.push(row('session id', snapshot.sessionId));

  return lines.join('\n');
}
