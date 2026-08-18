import React from 'react';
import { Box, Text } from 'ink';

import { categoriesOf, sourceUrl } from '@plif/core';
import type { CatalogPlugin, McpServerStatus, SessionMeta, Skill } from '@plif/core';

import { useSpinnerFrame } from './Spinner.js';
import type { BrowserRow, BrowserState, BrowserTab } from '../session.js';
import { color, formatCount, glyph, layout, truncate } from '../theme.js';

export const BROWSER_TABS: readonly { id: BrowserTab; label: string }[] = [
  { id: 'mcp', label: 'MCP servers' },
  { id: 'skills', label: 'Skills' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'sessions', label: 'Sessions' },
];

interface BrowserProps {
  readonly state: BrowserViewState;
  readonly servers: readonly McpServerStatus[];
  readonly skills: readonly Skill[];
  readonly sessions: readonly SessionMeta[];
  readonly width: number;
  readonly rows: number;
}

/** Rows are derived once by App and passed to this pure presentation tree. */
export type BrowserViewState = BrowserState & {
  readonly rows: readonly BrowserRow[];
};

export type McpStatusKind = 'connected' | 'disconnected' | 'error';

export function mcpStatusKind(status: McpServerStatus): McpStatusKind {
  if (status.connected) return 'connected';
  return /^(not connected|closed|disabled|offline|connecting|authenticating)$/i.test(status.detail.trim())
    ? 'disconnected'
    : 'error';
}

export function sortMcpStatuses(statuses: readonly McpServerStatus[]): McpServerStatus[] {
  const rank: Readonly<Record<McpStatusKind, number>> = {
    connected: 0,
    disconnected: 1,
    error: 2,
  };
  return [...statuses].sort((left, right) => {
    const byKind = rank[mcpStatusKind(left)] - rank[mcpStatusKind(right)];
    return byKind || left.name.localeCompare(right.name);
  });
}

/** Actions are contextual to the selected server, not a permanent toolbar. */
export function mcpActionHint(status: McpServerStatus | null): string {
  if (!status) return 'C connect a server';
  if (mcpStatusKind(status) === 'connected') return 'D disconnect · T test connection';
  return 'C connect · A authenticate · T test connection';
}

/**
 * How much of the terminal the browser takes.
 *
 * It is a full-screen view, not a panel: three thousand plugins do not browse
 * in eight rows. The prompt and the timeline are hidden while it is open, which
 * is also what keeps the frame from ever exceeding the window.
 */
export function browserHeight(rows: number): number {
  return Math.max(12, rows - 4);
}

export function sessionAge(updatedAt: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(updatedAt));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d`;
}

/**
 * The extension browser.
 *
 * Four tabs, and the split between them is the honest one rather than the
 * tidy one. **MCP servers** and **Skills** are what this machine currently
 * has — configured, connected, loaded. **Marketplace** is the external
 * catalogue, three thousand plugins from its official and community
 * directories.
 *
 * The catalogue is deliberately *not* split into MCP and Skills sub-lists.
 * A marketplace entry does not say which it provides — zero of the 284 official
 * entries declare an MCP server — so a split would be sorting by a field that
 * is almost always absent, and the two lists would be arbitrary. What a plugin
 * contains is known once it is fetched, not from the listing.
 *
 * Layout is a master-detail: a list on the left that filters as you type, the
 * selected entry expanded on the right. Nothing is hidden behind a keystroke
 * that is not on the footer.
 */
export function Browser({
  state,
  servers,
  skills,
  sessions,
  width,
  rows,
}: BrowserProps): React.ReactElement {
  const spinner = useSpinnerFrame(80, state.loading);
  const height = browserHeight(rows);
  // The list gets a bit under half, so a long plugin description has somewhere
  // to go. Below a narrow terminal the detail pane is dropped entirely rather
  // than squeezed into something unreadable.
  const stacked = width < 96;
  const listWidth = stacked ? width - 2 : Math.max(28, Math.floor((width - 5) * 0.42));
  const detailWidth = width - listWidth - 5;
  const bodyRows = height - 4;
  const mcpCounts = sortMcpStatuses(servers).reduce(
    (counts, server) => {
      counts[mcpStatusKind(server)] += 1;
      return counts;
    },
    { connected: 0, disconnected: 0, error: 0 },
  );

  return (
    <Box flexDirection="column" width="100%" paddingX={layout.gutter}>
      <Tabs active={state.tab} counts={{ mcp: servers.length, skills: skills.length, marketplace: state.catalog?.plugins.length ?? 0, sessions: sessions.length }} width={width - 2} />

      <SearchLine
        state={state}
        spinner={spinner}
        width={width - 2}
        total={
          state.tab === 'mcp'
            ? servers.length
            : state.tab === 'skills'
              ? skills.length
              : state.tab === 'sessions'
                ? sessions.length
                : (state.catalog?.plugins.length ?? 0)
        }
        showing={state.rows.length}
      />

      {state.tab === 'mcp' && (
        <Text color={color('ghost')}>
          {glyph.done} {mcpCounts.connected} connected · {glyph.pending} {mcpCounts.disconnected} disconnected · {glyph.failed} {mcpCounts.error} errors
        </Text>
      )}

      {state.tab === 'sessions' && state.deleteConfirm && (
        <Text color={color('danger')}>Delete this session? press D again to confirm · Esc cancels</Text>
      )}

      <Box>
        <Box flexDirection="column" width={listWidth}>
          <List state={state} width={listWidth} rows={bodyRows} spinner={spinner} />
        </Box>
        {!stacked && (
          <>
            <Box flexDirection="column" marginX={1}>
              {Array.from({ length: bodyRows }, (_, index) => (
                <Text key={index} color={color('ghost')}>
                  {glyph.rail}
                </Text>
              ))}
            </Box>
            <Box flexDirection="column" width={detailWidth}>
              <Detail state={state} servers={servers} skills={skills} sessions={sessions} width={detailWidth} rows={bodyRows} />
            </Box>
          </>
        )}
      </Box>

      <Text color={color(state.renameId ? 'accent' : state.deleteConfirm ? 'danger' : 'muted')}>
        {state.renameId
          ? 'Enter save title · Esc cancel'
          : state.tab === 'mcp'
            ? mcpActionHint(servers.find((server) => server.name === state.rows[state.selected]?.id) ?? null)
            : state.tab === 'sessions'
              ? 'Enter resume · R rename · D delete'
              : 'Enter open · Tab switch · Esc close'}
      </Text>
    </Box>
  );
}

function Tabs({
  active,
  counts,
  width,
}: {
  active: BrowserTab;
  counts: Record<BrowserTab, number>;
  width: number;
}): React.ReactElement {
  return (
    <Box width={width} justifyContent="space-between">
      <Box>
        {BROWSER_TABS.map((tab) => {
          const on = tab.id === active;
          return (
            <Box key={tab.id} marginRight={3}>
              {/* An underline alone would vanish on a console that does not
                  render it, so the marker carries in plain text too. */}
              <Text color={color(on ? 'accent' : 'ghost')}>{on ? glyph.caret : ' '} </Text>
              <Text color={color(on ? 'text' : 'faint')} bold={on} underline={on}>
                {tab.label}
              </Text>
              <Text color={color('ghost')}> {formatCount(counts[tab.id])}</Text>
            </Box>
          );
        })}
      </Box>
      <Text color={color('ghost')}>{glyph.divider} Tab {glyph.caret}</Text>
    </Box>
  );
}

function SearchLine({
  state,
  spinner,
  width,
  total,
  showing,
}: {
  state: BrowserViewState;
  spinner: string;
  width: number;
  total: number;
  showing: number;
}): React.ReactElement {
  return (
    <Box width={width} justifyContent="space-between" marginBottom={0}>
      <Box>
        <Text color={color('ghost')}>{glyph.search} </Text>
        {state.renameId ? (
          <Text color={color('text')}>
            rename: {state.renameDraft}<Text color={color('accent')}>▌</Text>
          </Text>
        ) : state.filter ? (
          <Text color={color('text')}>
            {state.filter}
            <Text color={color('accent')}>▌</Text>
          </Text>
        ) : (
          <Text color={color('ghost')} italic>
            type to filter
            <Text color={color('accent')}>▌</Text>
          </Text>
        )}
      </Box>
      <Text color={color('ghost')}>
        {state.loading ? (
          <Text color={color('accent')}>{spinner} loading the catalogue…</Text>
        ) : state.problem ? (
          <Text color={color('danger')}>{truncate(state.problem, 40)}</Text>
        ) : (
          `${showing} of ${total}${state.stale ? ' · cached' : ''}`
        )}
      </Text>
    </Box>
  );
}

function List({
  state,
  width,
  rows,
  spinner,
}: {
  state: BrowserViewState;
  width: number;
  rows: number;
  spinner: string;
}): React.ReactElement {
  if (state.loading && state.rows.length === 0) {
    return (
      <Box>
        <Text color={color('accent')}>{spinner} </Text>
        <Text color={color('muted')}>fetching marketplace…</Text>
      </Box>
    );
  }
  if (state.rows.length === 0) {
    return (
      <Text color={color('ghost')} italic>
        {state.filter
          ? `nothing matches "${state.filter}"`
          : state.tab === 'mcp'
            ? 'No MCP servers connected.'
            : state.tab === 'sessions'
              ? 'No sessions for this workspace.'
              : 'nothing here yet'}
      </Text>
    );
  }

  // Slide a window so the selection stays visible without the list jumping on
  // every keystroke.
  const start = Math.max(0, Math.min(state.selected - Math.floor(rows / 2), state.rows.length - rows));
  const visible = state.rows.slice(Math.max(0, start), Math.max(0, start) + rows);

  return (
    <Box flexDirection="column">
      {visible.map((row, index) => {
        const position = Math.max(0, start) + index;
        const on = position === state.selected;
        return (
          <Box key={row.id}>
            <Text color={color(on ? 'accent' : 'ghost')}>{on ? glyph.caret : ' '} </Text>
            <Text color={color(row.tone)}>{row.mark} </Text>
            <Text color={color(on ? 'text' : 'muted')} bold={on}>
              {truncate(row.title, Math.max(8, width - 6))}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function Detail({
  state,
  servers,
  skills,
  sessions,
  width,
  rows,
}: {
  state: BrowserViewState;
  servers: readonly McpServerStatus[];
  skills: readonly Skill[];
  sessions: readonly SessionMeta[];
  width: number;
  rows: number;
}): React.ReactElement {
  const row = state.rows[state.selected];
  if (!row) {
    return (
      <Text color={color('ghost')} italic>
        {state.tab === 'marketplace'
          ? 'Pick a plugin to see what it is and where it comes from.'
          : state.tab === 'sessions'
            ? 'Pick a session to resume it.'
          : 'Nothing selected.'}
      </Text>
    );
  }

  if (state.tab === 'mcp') {
    const server = servers.find((entry) => entry.name === row.id);
    if (!server) return <Text color={color('ghost')}>gone</Text>;
    return (
      <Box flexDirection="column">
        <Text color={color('text')} bold>
          {server.name}
        </Text>
        <Field label="transport" value={server.transport} width={width} />
        <Field
          label="status"
          value={
            mcpStatusKind(server) === 'connected'
              ? `connected · ${server.toolCount} tools available`
              : mcpStatusKind(server) === 'disconnected'
                ? 'disconnected'
                : `error · ${server.detail}`
          }
          width={width}
          tone={mcpStatusKind(server) === 'connected'
            ? 'success'
            : mcpStatusKind(server) === 'error' ? 'danger' : 'muted'}
        />
        <Paragraph
          text={server.connected
            ? `Provides ${server.toolCount} tools to the agent over ${server.transport}. ${server.detail}.`
            : `This server is configured over ${server.transport}, but it is ${mcpStatusKind(server) === 'error' ? 'failing' : 'not connected'}. ${server.detail}.`}
          width={width}
          lines={rows - 5}
        />
      </Box>
    );
  }

  if (state.tab === 'skills') {
    const skill = skills.find((entry) => entry.name === row.id);
    if (!skill) return <Text color={color('ghost')}>gone</Text>;
    return (
      <Box flexDirection="column">
        <Text color={color('text')} bold>
          {skill.name}
        </Text>
        <Field label="scope" value={skill.scope} width={width} />
        <Field label="file" value={skill.file} width={width} />
        <Paragraph text={skill.description} width={width} lines={rows - 5} />
      </Box>
    );
  }

  if (state.tab === 'sessions') {
    const session = sessions.find((entry) => entry.id === row.id);
    if (!session) return <Text color={color('ghost')}>gone</Text>;
    return (
      <Box flexDirection="column">
        <Text color={color('text')} bold>{session.title || '(no title)'}</Text>
        <Field label="updated" value={sessionAge(session.updatedAt)} width={width} />
        <Field label="messages" value={`${session.turns} ${session.turns === 1 ? 'turn' : 'turns'}`} width={width} />
        <Field label="session" value={session.id} width={width} />
        <Field label="workspace" value={session.workspace} width={width} />
        <Paragraph
          text={`${session.closedAt ? 'closed cleanly' : 'interrupted or active'} · Enter resumes the stored conversation without creating a copy.`}
          width={width}
          lines={rows - 5}
        />
      </Box>
    );
  }

  const plugin = state.catalog?.plugins.find((entry) => entry.name === row.id);
  if (!plugin) return <Text color={color('ghost')}>gone</Text>;
  return <PluginDetail plugin={plugin} width={width} rows={rows} />;
}

function PluginDetail({
  plugin,
  width,
  rows,
}: {
  plugin: CatalogPlugin;
  width: number;
  rows: number;
}): React.ReactElement {
  const url = sourceUrl(plugin);

  return (
    <Box flexDirection="column">
      <Text color={color('text')} bold>
        {truncate(plugin.displayName ?? plugin.name, width)}
      </Text>
      {plugin.displayName && plugin.displayName !== plugin.name && (
        <Text color={color('ghost')}>{plugin.name}</Text>
      )}

      <Box marginTop={1} />
      {plugin.author && <Field label="author" value={plugin.author} width={width} />}
      {plugin.category && <Field label="category" value={plugin.category} width={width} />}
      {plugin.version && <Field label="version" value={plugin.version} width={width} />}
      <Field
        label="listed in"
        value={plugin.origin === 'official' ? 'official directory' : 'community mirror'}
        width={width}
        tone={plugin.origin === 'official' ? 'success' : 'muted'}
      />
      {url && <Field label="source" value={url} width={width} />}

      <Paragraph text={plugin.description} width={width} lines={Math.max(3, rows - 10)} />

      {plugin.tags.length > 0 && (
        <Box marginTop={1}>
          <Text color={color('ghost')}>{truncate(plugin.tags.join(' · '), width)}</Text>
        </Box>
      )}
    </Box>
  );
}

function Field({
  label,
  value,
  width,
  tone = 'muted',
}: {
  label: string;
  value: string;
  width: number;
  tone?: Parameters<typeof color>[0];
}): React.ReactElement {
  const labelWidth = 10;
  return (
    <Box>
      <Box width={labelWidth}>
        <Text color={color('ghost')}>{label}</Text>
      </Box>
      <Text color={color(tone)}>{truncate(value, Math.max(8, width - labelWidth))}</Text>
    </Box>
  );
}

/** Hand-wrapped so a wrapped line does not start under the label column. */
function Paragraph({
  text,
  width,
  lines: maxLines,
}: {
  text: string;
  width: number;
  lines: number;
}): React.ReactElement | null {
  if (!text.trim() || maxLines <= 0) return null;

  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ' ' + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  const shown = lines.slice(0, maxLines);
  const hidden = lines.length - shown.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {shown.map((line, index) => (
        <Text key={index} color={color('muted')}>
          {line}
        </Text>
      ))}
      {hidden > 0 && (
        <Text color={color('ghost')} italic>
          … {hidden} more {hidden === 1 ? 'line' : 'lines'}
        </Text>
      )}
    </Box>
  );
}

/** Category chips, for the footer hint on the marketplace tab. */
export function topCategories(plugins: readonly CatalogPlugin[], limit = 5): string {
  return categoriesOf(plugins)
    .slice(0, limit)
    .map((entry) => `${entry.name}(${entry.count})`)
    .join(' ');
}
