import React from 'react';
import { Box, Text } from '../ui.js';

import type { GlobalConfig } from '@plif/core';

import { effortDisplay } from '../effort-visuals.js';
import { color, formatCount, glyph, layout, shortenPath, truncate } from '../theme.js';
import { contextPercent } from '../status.js';
import type { StatusInput } from '../status.js';

export interface StatusScreenProps {
  readonly snapshot: StatusInput;
  readonly version: string;
  readonly config: GlobalConfig | null;
  readonly configPath: string;
  readonly activeTheme: string;
  readonly providerProblem?: string | null;
  readonly configLoading: boolean;
  readonly configProblem: string | null;
  readonly width: number;
  readonly rows: number;
}

export interface StatusScreenRow {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'text' | 'muted' | 'accent' | 'accentBright' | 'warn' | 'danger';
}

export interface StatusScreenSection {
  readonly title: string;
  readonly rows: readonly StatusScreenRow[];
}

/** Keep the status view pure and safe: this model only selects redacted fields. */
export function statusSections(
  snapshot: StatusInput,
  version: string,
  config: GlobalConfig | null,
  activeTheme: string,
  configPath: string,
  configLoading: boolean,
  configProblem: string | null,
  providerProblem: string | null = null,
): readonly StatusScreenSection[] {
  const context = snapshot.contextMax > 0
    ? `${contextPercent(snapshot.contextUsed, snapshot.contextMax)}% · ${formatCount(snapshot.contextUsed)} / ${formatCount(snapshot.contextMax)}`
    : 'not available';
  const session = [
    snapshot.sessionName?.trim(),
    snapshot.sessionId ? truncate(snapshot.sessionId, 36) : undefined,
  ].filter(Boolean).join(' · ') || 'interactive · not persisted yet';
  const permission = config
    ? config.permissionMode ?? (config.autoApprove ? 'auto-approve' : 'ask')
    : configLoading
      ? 'loading'
      : 'unknown';
  const theme = config?.theme ?? activeTheme;
  const source = configProblem
    ? 'unavailable'
    : configLoading
      ? 'loading'
      : shortenPath(configPath, 72);

  return [
    {
      title: 'PLIF',
      rows: [
        { label: 'Version', value: version },
        { label: 'Session', value: session },
        { label: 'Directory', value: shortenPath(snapshot.workspace, 72) },
      ],
    },
    {
      title: 'Runtime',
      rows: [
        { label: 'Provider', value: snapshot.provider || 'not configured', tone: 'accent' },
        { label: 'Model', value: snapshot.model || 'not configured', tone: 'text' },
        { label: 'Effort', value: snapshot.effort ? effortDisplay(snapshot.effort) : 'Default', tone: snapshot.effort === 'plif' ? 'accentBright' : 'accent' },
        ...(providerProblem
          ? [{ label: 'Provider state', value: 'needs attention', tone: 'danger' as const }]
          : []),
        { label: 'Context', value: context },
        { label: 'Session time', value: `${Math.round(snapshot.elapsedMs / 1000)}s · ${snapshot.usage.turns} ${snapshot.usage.turns === 1 ? 'turn' : 'turns'}` },
        { label: 'Queued', value: String(snapshot.queued) },
      ],
    },
    {
      title: 'Configuration',
      rows: [
        { label: 'Source', value: source, tone: configProblem ? 'danger' : undefined },
        { label: 'Theme', value: theme },
        { label: 'Permissions', value: permission, tone: permission === 'deny' ? 'danger' : permission === 'auto-approve' ? 'warn' : undefined },
        { label: 'Authentication', value: providerProblem ? 'needs attention' : snapshot.provider && snapshot.model ? 'configured · credentials redacted' : 'not configured' },
      ],
    },
    {
      title: 'Integrations',
      rows: [
        { label: 'MCP servers', value: `${snapshot.mcpConnected}/${snapshot.mcpServers} connected` },
        { label: 'Skills', value: `${snapshot.skills} available` },
        ...(snapshot.container
          ? [{ label: 'Container', value: `${snapshot.container}${snapshot.containerState ? ` · ${snapshot.containerState}` : ''}` }]
          : []),
      ],
    },
  ];
}

export function StatusScreen({
  snapshot,
  version,
  config,
  configPath,
  activeTheme,
  providerProblem,
  configLoading,
  configProblem,
  width,
  rows,
}: StatusScreenProps): React.ReactElement {
  const contentWidth = Math.max(1, width - layout.gutter * 2);
  const labelWidth = Math.min(18, Math.max(12, Math.floor(contentWidth * 0.24)));
  const compact = width < 72 || rows < 24;
  const sections = statusSections(
    snapshot,
    version,
    config,
    activeTheme,
    configPath,
    configLoading,
    configProblem,
    providerProblem ?? null,
  ).map((section) => ({
    ...section,
    rows: compact
      ? section.rows.filter((row) => !['Session time', 'Queued', 'Authentication', 'Container'].includes(row.label))
      : section.rows,
  }));

  return (
    <Box flexDirection="column" width={width} height={Math.max(1, rows - 1)} paddingX={layout.gutter}>
      <Box width={contentWidth} justifyContent="space-between">
        <Text color={color('text')} bold>status</Text>
        <Text color={color('ghost')}>Esc close</Text>
      </Box>
      <Text color={color('faint')}>{'─'.repeat(Math.max(1, contentWidth))}</Text>
      {sections.map((section) => (
        <Box key={section.title} flexDirection="column" marginTop={compact ? 0 : 1}>
          <Text color={color('accentDim')} bold>{section.title}</Text>
          {section.rows.map((row) => (
            <Box key={row.label} width={contentWidth}>
              <Box width={labelWidth} flexShrink={0}>
                <Text color={color('muted')}>{row.label}</Text>
              </Box>
              <Text color={color(row.tone ?? 'text')} wrap="truncate">
                {truncate(row.value, Math.max(1, contentWidth - labelWidth))}
              </Text>
            </Box>
          ))}
        </Box>
      ))}
      <Box flexGrow={1} />
      <Text color={color(configProblem ? 'danger' : 'ghost')}>
        {configProblem ?? (compact ? 'Esc close · /config edit · secrets redacted' : `${glyph.divider} read-only snapshot · secrets are never displayed`)}
      </Text>
      {!compact && <Text color={color('muted')}>Esc close · /config opens editable settings</Text>}
    </Box>
  );
}
