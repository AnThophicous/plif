import React from 'react';
import { Box, Text } from '../ui.js';

import type { ConfigSetting } from '../configuration.js';
import type { ConfigEditState } from '../session.js';
import { binaryStateIndicator, color, glyph, layout, truncate } from '../theme.js';
import { ScreenTabs, type ScreenTab } from './ScreenFrame.js';

export interface ConfigScreenProps {
  /** The screen bar and the tab this screen is. */
  readonly tabs?: readonly ScreenTab[];
  readonly activeTab?: string;
  readonly settings: readonly ConfigSetting[];
  readonly filter: string;
  readonly selected: number;
  readonly editing: ConfigEditState | null;
  readonly feedback: string | null;
  readonly loading: boolean;
  readonly problem: string | null;
  readonly width: number;
  readonly rows: number;
}

export function configViewport(
  settingsOrCount: number | readonly ConfigSetting[],
  selected: number,
  rows: number,
): { readonly start: number; readonly end: number } {
  if (typeof settingsOrCount !== 'number') {
    const settings = settingsOrCount;
    const count = settings.length;
    if (count <= 0) return { start: 0, end: 0 };
    const visible = Math.max(1, rows);
    const renderCost = (start: number, end: number): number => {
      let cost = start > 0 ? 1 : 0; // “N above” marker
      for (let index = start; index < end; index += 1) {
        const previous = settings[index - 1];
        if (index === 0 || previous?.category !== settings[index]?.category) cost += 1;
        cost += 1;
      }
      if (end < count) cost += 1; // “N below” marker
      return cost;
    };

    let start = Math.max(0, Math.min(count - 1, selected));
    while (start > 0 && renderCost(start, selected + 1) > visible) start -= 1;
    let end = Math.max(start + 1, selected + 1);
    while (end < count && renderCost(start, end + 1) <= visible) end += 1;
    return { start, end };
  }

  const count = settingsOrCount;
  if (count <= 0) return { start: 0, end: 0 };
  const visible = Math.max(1, rows);
  const start = Math.max(0, Math.min(Math.max(0, count - visible), selected - visible + 2));
  return { start, end: Math.min(count, start + visible) };
}

export function ConfigScreen({
  tabs,
  activeTab,
  settings,
  filter,
  selected,
  editing,
  feedback,
  loading,
  problem,
  width,
  rows,
}: ConfigScreenProps): React.ReactElement {
  const contentWidth = Math.max(1, width - layout.gutter * 2);
  const labelWidth = Math.min(25, Math.max(16, Math.floor(contentWidth * 0.3)));
  const listRows = Math.max(3, Math.min(18, rows - 10));
  const viewport = configViewport(settings, selected, listRows);
  const selectedSetting = settings[selected];
  const editingSetting = editing ? settings.find((setting) => setting.id === editing.id) : undefined;

  return (
    <Box flexDirection="column" width={width} height={Math.max(1, rows - 1)} paddingX={layout.gutter}>
      {tabs && activeTab ? (
        <ScreenTabs
          tabs={tabs}
          active={activeTab}
          badge={`${settings.length} settings`}
          width={contentWidth}
        />
      ) : (
        <Box width={contentWidth} justifyContent="space-between">
          <Text color={color('text')} bold>config</Text>
          <Text color={color('ghost')}>{settings.length} settings · Esc close</Text>
        </Box>
      )}
      <Text color={color('faint')}>{'─'.repeat(Math.max(1, contentWidth))}</Text>
      <Box width={contentWidth} marginTop={1}>
        <Text color={color('accent')}>{glyph.search} </Text>
        <Text color={filter ? color('text') : color('ghost')}>
          {filter || 'Search settings…'}
        </Text>
        {filter && <Text color={color('accentBright')}>▌</Text>}
      </Box>

      {problem && <Text color={color('danger')}>{truncate(problem, contentWidth)}</Text>}
      {loading && <Text color={color('muted')}>Loading configuration…</Text>}
      {!loading && !problem && settings.length === 0 && (
        <Text color={color('muted')}>
          No settings match {filter ? `“${truncate(filter, Math.max(1, contentWidth - 24))}”` : 'this view'}.
        </Text>
      )}

      {!loading && !problem && settings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {viewport.start > 0 && <Text color={color('ghost')}>{glyph.pending} {viewport.start} above</Text>}
          {settings.slice(viewport.start, viewport.end).map((setting, index) => {
            const absolute = viewport.start + index;
            const previous = settings[absolute - 1];
            const categoryStart = !previous || previous.category !== setting.category;
            const active = absolute === selected;
            return (
              <React.Fragment key={setting.id}>
                {categoryStart && <Text color={color('accentDim')} bold>{setting.category}</Text>}
                <Box width={contentWidth}>
                  <Text color={color(active ? 'accentBright' : 'ghost')}>
                    {active ? glyph.caret : ' '}{' '}
                  </Text>
                  <Box width={Math.max(1, labelWidth - 2)} flexShrink={0}>
                    <Text color={color(active ? 'text' : 'muted')} bold={active}>
                      {truncate(setting.label, Math.max(1, labelWidth - 2))}
                    </Text>
                  </Box>
                  <Text
                    color={setting.state ? color(binaryStateIndicator(setting.state).tone) : color(active ? 'text' : 'muted')}
                    bold={Boolean(setting.state && (active || setting.state === 'on'))}
                    wrap="truncate"
                  >
                    {'  '}{truncate(setting.value, Math.max(1, contentWidth - labelWidth - 2))}
                  </Text>
                </Box>
              </React.Fragment>
            );
          })}
          {viewport.end < settings.length && (
            <Text color={color('ghost')}>{glyph.pending} {settings.length - viewport.end} below</Text>
          )}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        {editing && editingSetting ? (
          <>
            <Editor setting={editingSetting} edit={editing} width={contentWidth} />
            {feedback && <Text color={color('danger')}>{feedback}</Text>}
          </>
        ) : selectedSetting ? (
          <Box flexDirection="column">
            <Text color={color('muted')}>
              {selectedSetting.description}
              {selectedSetting.scope === 'global' ? ' · saved globally' : selectedSetting.scope === 'action' ? ' · opens existing flow' : ''}
            </Text>
            {feedback && <Text color={color('danger')}>{feedback}</Text>}
          </Box>
        ) : null}
      </Box>

      <Box flexGrow={1} />
      <Text color={color(problem || feedback ? 'danger' : 'muted')}>
        {problem || feedback || editing
          ? editing
            ? '↑↓ choose · type value · Enter apply · Esc cancel'
            : '↑↓ navigate · Enter edit · Esc clear search'
          : '↑↓ navigate · Enter edit · type to search · Esc clear / close'}
      </Text>
    </Box>
  );
}

function Editor({
  setting,
  edit,
  width,
}: {
  readonly setting: ConfigSetting;
  readonly edit: ConfigEditState;
  readonly width: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color={color('accent')} bold>{glyph.caret} Edit {setting.label}</Text>
      <Text color={color('muted')}>{setting.description}</Text>
      {setting.options ? (
        setting.options.length > 5 || width < 80 ? (
          <Text color={color('text')}>
            {glyph.done} {setting.options.find((option) => option.value === edit.value)?.label ?? edit.value}
            <Text color={color('muted')}> · ←→ choose</Text>
          </Text>
        ) : (
          <Box>
            {setting.options.map((option) => {
              const active = option.value === edit.value;
              return (
                <Box key={option.value} marginRight={2}>
                  <Text color={color(active ? 'accentBright' : 'ghost')} bold={active}>
                    {active ? glyph.done : '○'} {truncate(option.label, Math.max(4, Math.floor(width / Math.max(1, setting.options!.length)) - 4))}
                  </Text>
                </Box>
              );
            })}
          </Box>
        )
      ) : (
        <Text color={color('text')}>
          {glyph.caret} {edit.value || 'type a value'}▌
        </Text>
      )}
      {edit.error && <Text color={color('danger')}>{edit.error}</Text>}
    </Box>
  );
}
