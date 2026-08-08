import React from 'react';
import { Box, Text } from 'ink';

import { categoriesOf, sourceUrl } from '@plif/core';
import type { CatalogPlugin, McpServerStatus, Skill } from '@plif/core';

import { useSpinnerFrame } from './Spinner.js';
import type { BrowserState, BrowserTab } from '../session.js';
import { color, formatCount, glyph, layout, truncate } from '../theme.js';

export const BROWSER_TABS: readonly { id: BrowserTab; label: string }[] = [
  { id: 'mcp', label: 'MCP servers' },
  { id: 'skills', label: 'Skills' },
  { id: 'marketplace', label: 'Marketplace' },
];

interface BrowserProps {
  readonly state: BrowserState;
  readonly servers: readonly McpServerStatus[];
  readonly skills: readonly Skill[];
  readonly width: number;
  readonly rows: number;
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

/**
 * The extension browser.
 *
 * Three tabs, and the split between them is the honest one rather than the
 * tidy one. **MCP servers** and **Skills** are what this machine currently
 * has — configured, connected, loaded. **Marketplace** is the Claude
 * catalogue, three thousand plugins from Anthropic's official and community
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

  return (
    <Box flexDirection="column" width="100%" paddingX={layout.gutter}>
      <Tabs active={state.tab} counts={{ mcp: servers.length, skills: skills.length, marketplace: state.catalog?.plugins.length ?? 0 }} width={width - 2} />

      <SearchLine
        state={state}
        spinner={spinner}
        width={width - 2}
        total={
          state.tab === 'mcp'
            ? servers.length
            : state.tab === 'skills'
              ? skills.length
              : (state.catalog?.plugins.length ?? 0)
        }
        showing={state.rows.length}
      />

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
              <Detail state={state} servers={servers} skills={skills} width={detailWidth} rows={bodyRows} />
            </Box>
          </>
        )}
      </Box>
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
  state: BrowserState;
  spinner: string;
  width: number;
  total: number;
  showing: number;
}): React.ReactElement {
  return (
    <Box width={width} justifyContent="space-between" marginBottom={0}>
      <Box>
        <Text color={color('ghost')}>{glyph.search} </Text>
        {state.filter ? (
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
  state: BrowserState;
  width: number;
  rows: number;
  spinner: string;
}): React.ReactElement {
  if (state.loading && state.rows.length === 0) {
    return (
      <Box>
        <Text color={color('accent')}>{spinner} </Text>
        <Text color={color('muted')}>fetching from Anthropic…</Text>
      </Box>
    );
  }
  if (state.rows.length === 0) {
    return (
      <Text color={color('ghost')} italic>
        {state.filter ? `nothing matches "${state.filter}"` : 'nothing here yet'}
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
  width,
  rows,
}: {
  state: BrowserState;
  servers: readonly McpServerStatus[];
  skills: readonly Skill[];
  width: number;
  rows: number;
}): React.ReactElement {
  const row = state.rows[state.selected];
  if (!row) {
    return (
      <Text color={color('ghost')} italic>
        {state.tab === 'marketplace'
          ? 'Pick a plugin to see what it is and where it comes from.'
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
          label="state"
          value={server.connected ? `connected, ${server.toolCount} tools` : 'not connected'}
          width={width}
          tone={server.connected ? 'success' : 'danger'}
        />
        <Paragraph text={server.detail} width={width} lines={rows - 5} />
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
