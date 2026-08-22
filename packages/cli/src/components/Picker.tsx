import React from 'react';
import { Box, Text } from 'ink';
import type { ModelSelection } from '@plif/core';

import { effortSymbol, effortTone, effortVisual } from '../effort-visuals.js';
import { color, glyph, truncate, type PaletteKey } from '../theme.js';

export interface PickerItem {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly current?: boolean;
  readonly badges?: readonly string[];
  /** Optional identity mark, distinct from the keyboard selection cursor. */
  readonly symbol?: string;
  /** Optional semantic tone for rows that belong to a visual scale. */
  readonly tone?: PaletteKey;
  /** Optional model-first columns. Their presence changes only row density. */
  readonly provider?: string;
  readonly capabilities?: readonly string[];
  readonly context?: string;
  readonly auth?: string;
  readonly reasoning?: boolean;
  readonly tools?: boolean;
  readonly cost?: string;
  /** Searchable aliases/metadata kept out of the visible row. */
  readonly searchText?: string;
  /** Flat model rows carry their provider/model pair through Enter. */
  readonly selection?: ModelSelection;
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
    ...(effortSymbol(value) ? { symbol: effortSymbol(value) } : {}),
    detail: value === 'plif' ? 'PLIF signature mode · adaptive reasoning' : effortVisual(value).descriptor,
    tone: effortTone(value),
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
  readonly countLabel?: string;
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
      [
        item.value,
        item.label,
        item.detail,
        item.provider,
        item.context,
        item.auth,
        item.searchText,
        ...(item.capabilities ?? []),
        ...(item.badges ?? []),
      ].filter(Boolean).some((value) => value!.toLowerCase().includes(needle)),
  );
}

export function Picker({
  title,
  hint,
  countLabel,
  items,
  groups,
  expanded,
  filter,
  selected,
  width,
  rows = 8,
}: PickerProps): React.ReactElement {
  const availableWidth = Math.max(1, width - 4);
  const grouped = groups !== undefined;
  const visibleGroups = grouped ? filterPickerGroups(groups, filter) : [];
  const visibleRows = grouped ? pickerRows(groups, expanded ?? [], filter) : [];
  const visibleItems = grouped ? [] : filterItems(items ?? [], filter);
  const modelFirst = !grouped && visibleItems.some((item) => item.provider !== undefined);
  // Model selection is intentionally bounded: a 200-column terminal should
  // make the list/details relationship calmer, not push the details panel to
  // the far edge of the screen. Other pickers keep their existing full width.
  const inner = modelFirst ? Math.min(availableWidth, 112) : availableWidth;
  const compact = inner < 88;
  const selectedFlatItem = !grouped ? visibleItems[selected] : undefined;
  const splitDetails = modelFirst && selectedFlatItem !== undefined && inner >= 96;
  const listWidth = splitDetails ? Math.max(28, Math.floor(inner * 0.56)) : inner;
  const detailWidth = Math.max(24, inner - listWidth - 3);
  const count = grouped ? visibleGroups.length : visibleItems.length;
  const rowCount = grouped ? visibleRows.length : visibleItems.length;
  const start = Math.max(0, Math.min(selected - rows + 2, rowCount - rows));
  const visible: readonly (PickerRow | PickerItem)[] = grouped
    ? visibleRows.slice(start, start + rows)
    : visibleItems.slice(start, start + rows);
  // Selection is state, not activity. A stable caret is easier to scan and
  // keeps an open menu completely idle until the user presses a key.
  const caretTone = color('accentBright');
  // A section heading belongs to the first group that carries it. Computed over
  // the whole list, not the visible window, so scrolling past a heading does
  // not make the next provider look like it starts a new section.
  const sectionOf = new Map<string, string>();
  let lastSection: string | undefined;
  for (const group of visibleGroups) {
    if (group.section && group.section !== lastSection) sectionOf.set(group.id, group.section);
    lastSection = group.section;
  }

  // The effort scale is one horizontal composition, not a vertical menu: the
  // cold levels share a row, and the signature stands apart beneath them.
  // Typing a filter falls back to the ordinary list, because a narrowed set
  // is a search result, not a scale.
  if (countLabel === 'efforts' && !grouped && !filter.trim()) {
    return <EffortSelector hint={hint} items={items ?? []} selected={selected} width={width} />;
  }

  return (
    <Box flexDirection="column" width="100%" marginBottom={1}>
      <Box flexDirection="column" width={inner}>
        <Box justifyContent="space-between">
          <Text color={color('accent')} bold>
            {title}
          </Text>
          <Text color={color('ghost')}>
            {countLabel
              ? `${count} ${countLabel}`
              : `${count} ${grouped ? 'providers' : count === 1 ? 'match' : 'matches'}`}
          </Text>
        </Box>

        {hint?.split('\n').map((line, index) => (
          <Text key={`${line}-${index}`} color={color('ghost')}>{truncate(line, inner)}</Text>
        ))}

        <Box marginTop={1}>
          <Text color={color('muted')}>{glyph.prompt} </Text>
          {filter ? (
            <Text color={color('text')}>{filter}</Text>
          ) : (
            <Text color={color('ghost')}>{modelFirst ? 'Search models' : 'type to filter'}</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection={splitDetails ? 'row' : 'column'} width="100%">
          <Box flexDirection="column" width={listWidth}>
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
                      <Text color={active ? caretTone : color('ghost')}>
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
                        <Text color={color('accent')}> {glyph.done} active provider</Text>
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
                    <Text color={active ? caretTone : color('ghost')}>
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
                pickerItem.symbol,
                pickerItem.label,
                pickerItem.current ? `${glyph.done} active model` : undefined,
                ...(pickerItem.badges ?? []),
                pickerItem.detail,
              ].filter(Boolean).join(' · ');
              if (compact) {
                return (
                  <Box key={row.id} width="100%">
                    <Text color={color(active ? pickerItem.tone ?? 'text' : pickerItem.tone ?? 'muted')} bold={active}>
                      {truncate(`${active ? glyph.caret : ' '} ${itemSummary}`, Math.max(12, inner))}
                    </Text>
                  </Box>
                );
              }
              return (
                <Box key={row.id}>
                  <Text color={active ? caretTone : color('ghost')}>
                    {'  '}{active ? glyph.caret : ' '}{' '}
                  </Text>
                  <Text color={color(active ? pickerItem.tone ?? 'text' : pickerItem.tone ?? 'muted')} bold={active}>
                    {pickerItem.symbol ? `${pickerItem.symbol} ` : ''}{truncate(pickerItem.label, Math.max(10, inner - 18))}
                  </Text>
                  {pickerItem.current && <Text color={color('accent')}> {glyph.done} active model</Text>}
                  {pickerItem.badges?.map((badge) => (
                    <Text key={badge} color={color(badge === 'default' ? 'accent' : 'info')}>
                      {' · '}{badge}
                    </Text>
                  ))}
                  {pickerItem.detail && (
                    <Text color={color('ghost')}> · {truncate(pickerItem.detail, Math.max(10, inner - 42))}</Text>
                  )}
                </Box>
              );
            }

            const pickerItem = item as PickerItem;
            if (modelFirst && pickerItem.provider !== undefined) {
              return (
                <ModelPickerRow
                  key={pickerItem.value}
                  item={pickerItem}
                  active={active}
                  compact={compact}
                  width={inner}
                />
              );
            }
            const itemSummary = [
              pickerItem.symbol,
              pickerItem.label,
              pickerItem.current ? `${glyph.done} active` : undefined,
              ...(pickerItem.badges ?? []),
              pickerItem.detail,
            ].filter(Boolean).join(' · ');
            if (compact) {
              return (
                <Box key={pickerItem.value} width="100%">
                  <Text color={color(active ? pickerItem.tone ?? 'text' : pickerItem.tone ?? 'muted')} bold={active}>
                    {truncate(`${active ? glyph.caret : ' '} ${itemSummary}`, Math.max(12, inner))}
                  </Text>
                </Box>
              );
            }
            return (
              <Box key={pickerItem.value}>
                <Text color={active ? caretTone : color('ghost')}>
                  {active ? glyph.caret : ' '}{' '}
                </Text>
                <Text color={color(active ? pickerItem.tone ?? 'text' : pickerItem.tone ?? 'muted')} bold={active}>
                  {pickerItem.symbol ? `${pickerItem.symbol} ` : ''}{truncate(pickerItem.label, Math.max(10, inner - 14))}
                </Text>
                {pickerItem.current && <Text color={color('accent')}> {glyph.done} active</Text>}
                {pickerItem.badges?.map((badge) => (
                  <Text key={badge} color={color(badge === 'default' ? 'accent' : 'info')}>
                    {' · '}{badge}
                  </Text>
                ))}
                {pickerItem.detail && (
                  <Text color={color('ghost')}> · {truncate(pickerItem.detail, Math.max(10, inner - 42))}</Text>
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

          {splitDetails && selectedFlatItem && (
            <Box marginLeft={2} width={detailWidth} flexDirection="column">
              <PickerDetails item={selectedFlatItem} width={detailWidth} />
            </Box>
          )}
        </Box>

        {modelFirst && selectedFlatItem && !splitDetails && (
          <PickerDetails item={selectedFlatItem} width={inner} />
        )}

        <Box marginTop={1} justifyContent="space-between">
          <Text color={color('muted')}>
            {grouped ? '↑↓ move · ←→ expand · Enter select' : '↑↓ move · Enter select'} · / search
          </Text>
          <Text color={color('ghost')}>
            <Text inverse bold> Esc </Text> close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function PickerDetails({ item, width }: { readonly item: PickerItem; readonly width: number }): React.ReactElement {
  const value = (text: string): string => truncate(text, Math.max(12, width - 10));
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={color('accent')} bold>DETAILS</Text>
      {item.current && <Text color={color('success')}>current</Text>}
      {item.provider && <Text color={color('muted')}>{`Provider  ${value(item.provider)}`}</Text>}
      <Text color={color('ghost')}>{`ID        ${value(item.selection?.model ?? item.value)}`}</Text>
      <Text color={color('ghost')}>{`Context   ${value(item.context ?? 'Unknown')}`}</Text>
      <Text color={color('ghost')}>{`Access    ${value(item.auth ?? 'Unknown')}`}</Text>
      <Text color={color('ghost')}>{`Reasoning ${item.reasoning === undefined ? 'Unknown' : item.reasoning ? 'Yes' : 'No'}`}</Text>
      <Text color={color('ghost')}>{`Tools     ${item.tools === undefined ? 'Unknown' : item.tools ? 'Yes' : 'No'}`}</Text>
      {item.capabilities && item.capabilities.length > 0 && (
        <Text color={color('ghost')}>{`Provides  ${value(item.capabilities.join(' · '))}`}</Text>
      )}
      {item.cost && <Text color={color('ghost')}>{`Cost      ${value(item.cost)}`}</Text>}
      {item.detail && <Text color={color('faint')}>{value(item.detail)}</Text>}
    </Box>
  );
}

const ModelPickerRow = React.memo(function ModelPickerRow({
  item,
  active,
  compact,
  width,
}: {
  readonly item: PickerItem;
  readonly active: boolean;
  readonly compact: boolean;
  readonly width: number;
}): React.ReactElement {
  const prefix = active ? glyph.caret : ' ';
  if (compact) {
    return (
      <Box key={item.value} width="100%">
        <Text color={active ? color('accentBright') : color(item.tone ?? 'muted')} bold={active}>
          {prefix} {truncate(item.label, Math.max(12, width - 3))}
          {item.current && <Text color={color('success')}> {glyph.done}</Text>}
        </Text>
      </Box>
    );
  }

  return (
    <Box key={item.value} width="100%">
      <Text color={active ? color('accentBright') : color('ghost')} bold={active}>{prefix} </Text>
      <Text color={active ? color('text') : color(item.tone ?? 'muted')} bold={active}>
        {truncate(item.label, Math.max(12, width - 12))}
      </Text>
      {item.current && <Text color={color('success')}> {glyph.done}</Text>}
    </Box>
  );
});

ModelPickerRow.displayName = 'ModelPickerRow';

/** A quiet, vertical effort scale. The selected row is the only emphasis. */
export function EffortSelector({
  hint,
  items,
  selected,
  width,
}: {
  readonly hint?: string;
  readonly items: readonly PickerItem[];
  readonly selected: number;
  readonly width: number;
}): React.ReactElement {
  const inner = Math.max(24, width - 4);
  const current = items.find((item) => item.current);
  const currentValue = current?.value ?? 'default';
  const currentLabel = currentValue === 'default'
    ? 'default'
    : referenceEffortSymbol(currentValue)
      ? `${referenceEffortSymbol(currentValue)} ${referenceEffortLabel(currentValue)}`
      : referenceEffortLabel(currentValue);
  return (
    <Box flexDirection="column" width="100%" marginBottom={1} paddingX={1}>
      <Text color={color('accent')} bold>Effort</Text>
      {hint && <Text color={color('ghost')}>{truncate(hint, inner)}</Text>}
      <Text color={color('text')}>
        current <Text color={color('muted')}>(</Text>
        <Text color={color('accentBright')} bold>{currentLabel}</Text>
        <Text color={color('muted')}>)</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        {items.map((item, index) => {
          const active = index === selected;
          const tone = item.value === 'plif' ? (active ? 'accentPastel' : 'accent') : item.tone ?? 'muted';
          const symbol = referenceEffortSymbol(item.value);
          const label = `${symbol ? `${symbol} ` : ''}${referenceEffortLabel(item.value)}`;
          const suffix = item.detail;
          return (
            <Box key={item.value} flexDirection="column">
              <Text color={color(active ? 'accentBright' : tone)} bold={active}>
                {active ? glyph.caret : ' '} {label}
              </Text>
              {suffix && <Text color={color('ghost')}>{`    ${truncate(suffix, Math.max(12, inner - 4))}`}</Text>}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={color('muted')}>↑↓ move · Enter select · Esc close</Text>
      </Box>
    </Box>
  );
}

function referenceEffortSymbol(value: string): string {
  switch (value) {
    case 'low': return '·';
    case 'medium': return '○';
    case 'high': return '●';
    case 'xhigh': return '◉';
    case 'ultra': return '◆';
    case 'ultracode': return '◇';
    case 'max': return '◈';
    case 'plif': return '';
    default: return '·';
  }
}

function referenceEffortLabel(value: string): string {
  if (value === 'xhigh') return 'xhigh';
  if (value === 'plif') return 'PLIF';
  return value;
}
