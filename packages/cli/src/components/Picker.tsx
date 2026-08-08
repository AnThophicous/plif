import React from 'react';
import { Box, Text } from 'ink';

import { color, glyph, layout, truncate } from '../theme.js';

export interface PickerItem {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly current?: boolean;
  readonly badges?: readonly string[];
}

export interface PickerGroup {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly items: readonly PickerItem[];
}

export type PickerRow =
  | { readonly kind: 'group'; readonly id: string; readonly group: PickerGroup }
  | {
      readonly kind: 'item';
      readonly id: string;
      readonly groupId: string;
      readonly item: PickerItem;
    };

export function filterPickerGroups(
  groups: readonly PickerGroup[],
  filter: string,
): PickerGroup[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return groups.map((group) => ({ ...group, items: [...group.items] }));

  return groups.flatMap((group) => {
    const groupMatches = [group.id, group.label, group.detail]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(needle));
    const items = groupMatches
      ? [...group.items]
      : group.items.filter((item) =>
          [item.value, item.label, item.detail, ...(item.badges ?? [])]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(needle)),
        );
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

export function flattenPickerGroups(
  groups: readonly PickerGroup[],
  expanded: readonly string[],
): PickerRow[] {
  const open = new Set(expanded);
  return groups.flatMap((group) => [
    { kind: 'group' as const, id: group.id, group },
    ...(open.has(group.id)
      ? group.items.map((item) => ({
          kind: 'item' as const,
          id: `${group.id}:${item.value}`,
          groupId: group.id,
          item,
        }))
      : []),
  ]);
}

interface PickerProps {
  readonly title: string;
  readonly items?: readonly PickerItem[];
  readonly groups?: readonly PickerGroup[];
  readonly expanded?: readonly string[];
  readonly filter: string;
  readonly selected: number;
  readonly width: number;
  readonly rows?: number;
}

export function filterItems(items: readonly PickerItem[], filter: string): PickerItem[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter(
    (item) =>
      item.value.toLowerCase().includes(needle) || item.label.toLowerCase().includes(needle),
  );
}

export function Picker({
  title,
  items,
  groups,
  expanded,
  filter,
  selected,
  width,
  rows = 8,
}: PickerProps): React.ReactElement {
  const inner = width - 4;
  const grouped = groups !== undefined;
  const visibleGroups = grouped ? filterPickerGroups(groups, filter) : [];
  const visibleRows = grouped ? flattenPickerGroups(visibleGroups, expanded ?? []) : [];
  const visibleItems = grouped ? [] : filterItems(items ?? [], filter);
  const count = grouped ? visibleGroups.length : visibleItems.length;
  const rowCount = grouped ? visibleRows.length : visibleItems.length;
  const start = Math.max(0, Math.min(selected - rows + 2, rowCount - rows));
  const visible: readonly (PickerRow | PickerItem)[] = grouped
    ? visibleRows.slice(start, start + rows)
    : visibleItems.slice(start, start + rows);

  return (
    <Box flexDirection="column" width="100%" marginBottom={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={color('accentDim')}
        paddingX={layout.boxPadX}
        width="100%"
      >
        <Box justifyContent="space-between">
          <Text color={color('accent')} bold>
            {title}
          </Text>
          <Text color={color('ghost')}>
            {grouped ? `${count} providers` : `${count} ${count === 1 ? 'match' : 'matches'}`}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={color('muted')}>{glyph.prompt} </Text>
          {filter ? (
            <Text color={color('text')}>{filter}</Text>
          ) : (
            <Text color={color('ghost')}>type to filter</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {start > 0 && (
            <Text color={color('ghost')}>
              {'  '}
              {glyph.pending} {start} above
            </Text>
          )}

          {visible.length === 0 && (
            <Text color={color('faint')}>
              {'  '}nothing matches — custom providers live in .config/PlifCode/config.jsonc
            </Text>
          )}

          {visible.map((item, index) => {
            const active = start + index === selected;
            if (grouped) {
              const row = item as PickerRow;
              if (row.kind === 'group') {
                const isExpanded = (expanded ?? []).includes(row.group.id);
                return (
                  <Box key={row.id}>
                    <Text color={color(active ? 'accent' : 'ghost')}>
                      {active ? glyph.caret : ' '}{' '}
                    </Text>
                    <Text color={color(active ? 'text' : 'muted')} bold={active}>
                      {isExpanded ? '⌄' : glyph.caret} {row.group.label}
                    </Text>
                    <Text color={color('ghost')}>
                      {'  '}{row.group.detail ?? ''} · {row.group.items.length} models
                    </Text>
                  </Box>
                );
              }

              const pickerItem = row.item;
              return (
                <Box key={row.id}>
                  <Text color={color(active ? 'accent' : 'ghost')}>
                    {'  '}{active ? glyph.caret : ' '}{' '}
                  </Text>
                  <Text color={color(active ? 'text' : 'faint')} bold={active}>
                    {truncate(pickerItem.label, Math.max(10, inner - 18))}
                  </Text>
                  {pickerItem.current && <Text color={color('success')}> {glyph.done} in use</Text>}
                  {pickerItem.badges?.map((badge) => (
                    <Text key={badge} color={color(badge === 'default' ? 'accent' : 'info')}>
                      {' '}[{badge}]
                    </Text>
                  ))}
                  {pickerItem.detail && !pickerItem.current && !pickerItem.badges?.length && (
                    <Text color={color('ghost')}> {pickerItem.detail}</Text>
                  )}
                </Box>
              );
            }

            const pickerItem = item as PickerItem;
            return (
              <Box key={pickerItem.value}>
                <Text color={color(active ? 'accent' : 'ghost')}>
                  {active ? glyph.caret : ' '}{' '}
                </Text>
                <Text color={color(active ? 'text' : 'faint')} bold={active}>
                  {truncate(pickerItem.label, Math.max(10, inner - 14))}
                </Text>
                {pickerItem.current && <Text color={color('success')}> {glyph.done} in use</Text>}
                {pickerItem.badges?.map((badge) => (
                  <Text key={badge} color={color(badge === 'default' ? 'accent' : 'info')}>
                    {' '}[{badge}]
                  </Text>
                ))}
                {pickerItem.detail && !pickerItem.current && !pickerItem.badges?.length && (
                  <Text color={color('ghost')}> {pickerItem.detail}</Text>
                )}
              </Box>
            );
          })}

          {start + rows < rowCount && (
            <Text color={color('ghost')}>
              {'  '}
              {glyph.pending} {rowCount - start - rows} more
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
