import React from 'react';
import { Box, Text } from '../ui.js';

import { cell, rightCell, ScreenFrame } from './ScreenFrame.js';
import { color, glyph, truncate } from '../theme.js';

export interface AgentRow {
  readonly name: string;
  readonly model: string;
  readonly description: string;
  /** Built-in agents can be disabled but never deleted. */
  readonly builtin: boolean;
  readonly enabled: boolean;
  /** Times this agent ran in this session. */
  readonly runs: number;
}

export interface AgentsScreenProps {
  readonly agents: readonly AgentRow[];
  readonly selected: number;
  readonly filter: string;
  readonly width: number;
  readonly rows: number;
}

/** Narrow the list the way the command menu does: substring, name or model. */
export function filterAgents(
  agents: readonly AgentRow[],
  filter: string,
): readonly AgentRow[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return agents;
  return agents.filter((agent) =>
    agent.name.toLowerCase().includes(needle) ||
    agent.model.toLowerCase().includes(needle) ||
    agent.description.toLowerCase().includes(needle));
}

/**
 * The named subagents, and which model each one thinks with.
 *
 * `/agents` used to be six subcommands and a menu that only led to more
 * subcommands, so the one question a person actually opens it with — which
 * agents exist and what do they run on — took several round trips to answer.
 * The list answers it on sight; the actions stay on the key bar.
 */
export function AgentsScreen({
  agents,
  selected,
  filter,
  width,
  rows,
}: AgentsScreenProps): React.ReactElement {
  const contentWidth = Math.max(24, width - 4);
  const visible = filterAgents(agents, filter);
  const active = visible[Math.min(selected, Math.max(0, visible.length - 1))];
  const nameWidth = Math.min(20, Math.max(10, Math.floor(contentWidth * 0.18)));
  const modelWidth = Math.min(34, Math.max(12, Math.floor(contentWidth * 0.28)));
  const runsWidth = 7;
  const descriptionWidth = Math.max(10, contentWidth - 2 - nameWidth - modelWidth - runsWidth - 3);
  const enabledCount = agents.filter((agent) => agent.enabled).length;
  // The body keeps a row for the header and two for the detail block.
  const listRows = Math.max(3, rows - 11);
  const start = Math.max(0, Math.min(selected - listRows + 2, visible.length - listRows));

  return (
    <ScreenFrame
      title="Agents"
      badge={`${enabledCount}/${agents.length} enabled`}
      {...(filter.trim() ? { subtitle: `filter: ${filter}` } : {})}
      keys={['↑↓ move', 'Enter run', 'A add', 'D remove', 'Space enable', 'Esc close']}
      width={width}
      rows={rows}
    >
      <Box>
        <Text color={color('faint')}>{cell('  agent', nameWidth + 2)}</Text>
        <Text color={color('faint')}>{cell('model', modelWidth)}</Text>
        <Text color={color('faint')}>{cell('what it is for', descriptionWidth)}</Text>
        <Text color={color('faint')}>{rightCell('runs', runsWidth)}</Text>
      </Box>

      {visible.length === 0 ? (
        <Text color={color('faint')}>
          {filter.trim() ? 'nothing matches that filter' : 'no agents yet — press A to add one'}
        </Text>
      ) : (
        visible.slice(start, start + listRows).map((agent, index) => {
          const isActive = start + index === selected;
          const tone = !agent.enabled ? 'ghost' : isActive ? 'accentBright' : 'text';
          return (
            <Box key={agent.name} width={contentWidth}>
              <Text color={isActive ? color('accentBright') : color('ghost')}>
                {cell(isActive ? glyph.caret : ' ', 2)}
              </Text>
              {/* One cell of each column is a gap, so a name that fills its
                  column never runs into the model beside it. */}
              <Text color={color(tone)} bold={isActive}>
                {cell(truncate(agent.name, nameWidth - 1), nameWidth)}
              </Text>
              <Text color={color(agent.enabled ? 'muted' : 'ghost')}>
                {cell(truncate(agent.model, modelWidth - 1), modelWidth)}
              </Text>
              <Text color={color('ghost')}>
                {cell(agent.description || (agent.builtin ? 'built in' : 'no description'), descriptionWidth)}
              </Text>
              <Text color={color(agent.runs > 0 ? 'accent' : 'ghost')}>
                {rightCell(agent.runs > 0 ? String(agent.runs) : '·', runsWidth)}
              </Text>
            </Box>
          );
        })
      )}

      {active && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={color('ghost')}>{'─'.repeat(contentWidth)}</Text>
          <Box>
            <Text color={color('accentBright')} bold>{active.name}</Text>
            <Text color={color('ghost')}>{'  ·  '}</Text>
            <Text color={color('muted')}>{active.builtin ? 'built in' : 'yours'}</Text>
            <Text color={color('ghost')}>{'  ·  '}</Text>
            <Text color={color(active.enabled ? 'success' : 'ghost')}>
              {active.enabled ? 'enabled' : 'disabled'}
            </Text>
          </Box>
          <Text color={color('faint')}>
            {truncate(active.description || 'No description. Add one so the router knows when to pick it.', contentWidth)}
          </Text>
        </Box>
      )}
    </ScreenFrame>
  );
}
