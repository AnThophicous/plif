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
  /**
   * Heading this group sits under, e.g. "yours" or "built in".
   *
   * Rendered once, above the first group carrying it. Groups are expected to
   * arrive already sorted by section; this does not regroup them.
   */
  readonly section?: string;
  /** True when one of this provider's models is the current model. */
  readonly current?: boolean;
  readonly items: readonly PickerItem[];
}

const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra',
  ultracode: 'UltraCode',
  plif: 'PLIF',
};

/** Keep the internal compatibility value `plif` out of the user-facing UI. */
export function effortLabel(value: string | undefined): string {
  return value ? EFFORT_LABELS[value] ?? value : 'Default';
}

export function effortPickerItems(
  efforts: readonly string[],
  current: string | undefined,
): PickerItem[] {
  return efforts.map((value) => ({
    value,
    label: effortLabel(value),
    detail: value === 'plif' ? 'adaptive reasoning for coding' : `${value} reasoning effort`,
    current: value === current,
  }));
}

/**
 * How many models a provider shows before it needs a second Enter.
 *
 * A provider with two hundred models must not push every other provider off
 * the screen the moment it is opened. Ten is roughly what a terminal shows at
 * once, and — because the list is ranked — it is also the ten most people
 * actually pick.
 */
export const PICKER_GROUP_PAGE = 10;

/** Suffix marking the "show the rest of this provider" expansion state. */
export const ALL_SUFFIX = ':all';

export type PickerRow =
  | { readonly kind: 'group'; readonly id: string; readonly group: PickerGroup }
  | {
      readonly kind: 'item';
      readonly id: string;
      readonly groupId: string;
      readonly item: PickerItem;
    }
  /** The "N more" row. Selecting it reveals the rest of the provider. */
  | {
      readonly kind: 'more';
      readonly id: string;
      readonly groupId: string;
      readonly hidden: number;
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
  filter = '',
): PickerRow[] {
  const open = new Set(expanded);
  if (filter.trim()) {
    for (const group of groups) open.add(group.id);
  }
  return groups.flatMap((group) => {
    const header = { kind: 'group' as const, id: group.id, group };
    if (!open.has(group.id)) return [header];

    const showAll = open.has(`${group.id}${ALL_SUFFIX}`);
    const shown = showAll ? group.items : group.items.slice(0, PICKER_GROUP_PAGE);
    const rows: PickerRow[] = [
      header,
      ...shown.map((item) => ({
        kind: 'item' as const,
        id: `${group.id}:${item.value}`,
        groupId: group.id,
        item,
      })),
    ];
    const hidden = group.items.length - shown.length;
    if (hidden > 0) {
      rows.push({ kind: 'more', id: `${group.id}${ALL_SUFFIX}`, groupId: group.id, hidden });
    }
    return rows;
  });
}

export function pickerRows(
  groups: readonly PickerGroup[],
  expanded: readonly string[],
  filter = '',
): PickerRow[] {
  return flattenPickerGroups(filterPickerGroups(groups, filter), expanded, filter);
}

/**
 * Select the active model when a grouped catalog opens.
 *
 * `selected` addresses the flattened rows rendered by the picker, not the
 * provider array. The active provider's header is therefore not the active
 * model's row. If the current model is outside the first page, keep the
 * bounded catalog behavior and land on that provider's header instead.
 */
export function pickerSelectionForCurrentModel(
  groups: readonly PickerGroup[],
  expanded: readonly string[],
  currentGroupId: string | undefined,
): number {
  const rows = pickerRows(groups, expanded);
  const currentModel = rows.findIndex((row) => row.kind === 'item' && row.item.current);
  if (currentModel >= 0) return currentModel;

  const currentGroup = rows.findIndex(
    (row) => row.kind === 'group' && row.group.id === currentGroupId,
  );
  return Math.max(0, currentGroup);
}

export function preservePickerSelection(
  previous: readonly PickerRow[],
  selected: number,
  next: readonly PickerRow[],
): number {
  const previousId = previous[selected]?.id;
  const retained = previousId === undefined ? -1 : next.findIndex((row) => row.id === previousId);
  if (retained >= 0) return retained;
  return Math.min(Math.max(0, selected), Math.max(0, next.length - 1));
}

interface PickerProps {
  readonly title: string;
  readonly hint?: string;
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
  hint,
  items,
  groups,
  expanded,
  filter,
  selected,
  width,
  rows = 8,
}: PickerProps): React.ReactElement {
  const inner = width - 4;
  const compact = inner < 88;
  const grouped = groups !== undefined;
  const visibleGroups = grouped ? filterPickerGroups(groups, filter) : [];
  const visibleRows = grouped ? pickerRows(groups, expanded ?? [], filter) : [];
  const visibleItems = grouped ? [] : filterItems(items ?? [], filter);
  const count = grouped ? visibleGroups.length : visibleItems.length;
  const rowCount = grouped ? visibleRows.length : visibleItems.length;
  const start = Math.max(0, Math.min(selected - rows + 2, rowCount - rows));
  const visible: readonly (PickerRow | PickerItem)[] = grouped
    ? visibleRows.slice(start, start + rows)
    : visibleItems.slice(start, start + rows);
  // A section heading belongs to the first group that carries it. Computed over
  // the whole list, not the visible window, so scrolling past a heading does
  // not make the next provider look like it starts a new section.
  const sectionOf = new Map<string, string>();
  let lastSection: string | undefined;
  for (const group of visibleGroups) {
    if (group.section && group.section !== lastSection) sectionOf.set(group.id, group.section);
    lastSection = group.section;
  }

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

        {hint && (
          <Text color={color('ghost')}>{truncate(hint, inner)}</Text>
        )}

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
              {'  '}nothing matches — custom providers live in ~/.plif/config.toml
            </Text>
          )}

          {visible.map((item, index) => {
            const active = start + index === selected;
            if (grouped) {
              const row = item as PickerRow;
              if (row.kind === 'group') {
                const isExpanded = Boolean(filter.trim()) || (expanded ?? []).includes(row.group.id);
                const section = sectionOf.get(row.group.id);
                const summary = [
                  section?.toUpperCase(),
                  `${isExpanded ? '⌄' : glyph.caret} ${row.group.label}`,
                  row.group.current ? `${glyph.done} active provider` : undefined,
                  `${row.group.items.length} models`,
                  row.group.detail,
                ].filter(Boolean).join(' · ');
                if (compact) {
                  return (
                    <Box key={row.id} width="100%">
                      <Text color={color(active ? 'text' : 'muted')} bold={active}>
                        {truncate(`${active ? glyph.caret : ' '} ${summary}`, Math.max(12, inner))}
                      </Text>
                    </Box>
                  );
                }
                return (
                  <React.Fragment key={row.id}>
                    <Box>
                      <Text color={color(active ? 'accent' : 'ghost')}>
                        {active ? glyph.caret : ' '}{' '}
                      </Text>
                      {section && <Text color={color('faint')}>{section.toUpperCase()} </Text>}
                      <Text color={color(active ? 'text' : 'muted')} bold={active}>
                        {isExpanded ? '⌄' : glyph.caret} {row.group.label}
                      </Text>
                      <Text color={color('ghost')}>
                        {'  '}{row.group.detail ?? ''} · {row.group.items.length} models
                      </Text>
                      {row.group.current && (
                        <Text color={color('success')}> {glyph.done} active provider</Text>
                      )}
                    </Box>
                  </React.Fragment>
                );
              }

              if (row.kind === 'more') {
                if (compact) {
                  return (
                    <Box key={row.id} width="100%">
                      <Text color={color(active ? 'text' : 'faint')} bold={active}>
                        {truncate(`${active ? glyph.caret : ' '} show ${row.hidden} more`, Math.max(12, inner))}
                      </Text>
                    </Box>
                  );
                }
                return (
                  <Box key={row.id}>
                    <Text color={color(active ? 'accent' : 'ghost')}>
                      {'  '}{active ? glyph.caret : ' '}{' '}
                    </Text>
                    <Text color={color(active ? 'text' : 'faint')} bold={active}>
                      show {row.hidden} more
                    </Text>
                  </Box>
                );
              }

              const pickerItem = row.item;
              const itemSummary = [
                pickerItem.label,
                pickerItem.current ? `${glyph.done} active model` : undefined,
                ...(pickerItem.badges ?? []).map((badge) => `[${badge}]`),
                !pickerItem.current && !pickerItem.badges?.length ? pickerItem.detail : undefined,
              ].filter(Boolean).join(' · ');
              if (compact) {
                return (
                  <Box key={row.id} width="100%">
                    <Text color={color(active ? 'text' : 'faint')} bold={active}>
                      {truncate(`${active ? glyph.caret : ' '} ${itemSummary}`, Math.max(12, inner))}
                    </Text>
                  </Box>
                );
              }
              return (
                <Box key={row.id}>
                  <Text color={color(active ? 'accent' : 'ghost')}>
                    {'  '}{active ? glyph.caret : ' '}{' '}
                  </Text>
                  <Text color={color(active ? 'text' : 'faint')} bold={active}>
                    {truncate(pickerItem.label, Math.max(10, inner - 18))}
                  </Text>
                  {pickerItem.current && <Text color={color('success')}> {glyph.done} active model</Text>}
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
            const itemSummary = [
              pickerItem.label,
              pickerItem.current ? `${glyph.done} active` : undefined,
              ...(pickerItem.badges ?? []).map((badge) => `[${badge}]`),
              !pickerItem.current && !pickerItem.badges?.length ? pickerItem.detail : undefined,
            ].filter(Boolean).join(' · ');
            if (compact) {
              return (
                <Box key={pickerItem.value} width="100%">
                  <Text color={color(active ? 'text' : 'muted')} bold={active}>
                    {truncate(`${active ? glyph.caret : ' '} ${itemSummary}`, Math.max(12, inner))}
                  </Text>
                </Box>
              );
            }
            return (
              <Box key={pickerItem.value}>
                <Text color={color(active ? 'accent' : 'ghost')}>
                  {active ? glyph.caret : ' '}{' '}
                </Text>
                <Text color={color(active ? 'text' : 'muted')} bold={active}>
                  {truncate(pickerItem.label, Math.max(10, inner - 14))}
                </Text>
                {pickerItem.current && <Text color={color('success')}> {glyph.done} active</Text>}
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

        <Box marginTop={1} justifyContent="space-between">
          <Text color={color('muted')}>↑↓ move · ←→ expand · type search</Text>
          <Text color={color('ghost')}>
            <Text inverse bold> Enter </Text> choose · <Text inverse bold> Esc </Text> close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
