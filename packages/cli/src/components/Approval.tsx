import React from 'react';
import { Box, Text } from 'ink';

import type { PendingApproval } from '../session.js';
import { color, glyph, layout, truncate } from '../theme.js';

export const APPROVAL_CHOICES = [
  { key: 'y', decision: 'allow', remember: false, label: 'Allow once' },
  { key: 'a', decision: 'allow', remember: true, label: 'Allow for this session' },
  { key: 'n', decision: 'deny', remember: false, label: 'Deny' },
  { key: 'd', decision: 'deny', remember: true, label: 'Deny for this session' },
] as const;

interface ApprovalProps {
  readonly approval: PendingApproval;
  readonly selected: number;
  readonly queued: number;
  readonly width: number;
  /**
   * Drop the breathing room on a short window.
   *
   * Three blank separator lines and up to eight lines of explanation are worth
   * having when there is room. When there is not, the panel becomes the thing
   * that overflows the terminal, and an overflowing frame makes Ink reprint the
   * entire session. Cramped and readable beats spacious and duplicated.
   */
  readonly compact?: boolean;
}

/** Worst-case height in terminal lines, for the caller's layout budget. */
export function approvalHeight(compact: boolean): number {
  return compact ? 11 : 20;
}

/**
 * The permission prompt.
 *
 * This component decides whether an agent is trustworthy to run unattended, so
 * it is built around one question: **can the developer answer correctly in two
 * seconds without thinking hard?**
 *
 * Which means it shows, in this order:
 *   1. the literal command or path — what will actually happen, verbatim,
 *      never summarised, because a summary is where a malicious argv hides
 *   2. why the agent wants it — its stated intent
 *   3. why Plif is asking — the policy rule's rationale
 *
 * A prompt that shows only (1) trains people to hit yes. A prompt that shows
 * only (2) lets the agent describe its own request. Showing all three, with the
 * raw command first, is what makes the answer informed.
 */
export function Approval({
  approval,
  selected,
  queued,
  width,
  compact = false,
}: ApprovalProps): React.ReactElement {
  const inner = width - 4;
  const command = approval.argv?.join(' ') ?? approval.target;
  const gap = compact ? 0 : 1;
  const explain = compact ? 1 : 4;

  return (
    <Box flexDirection="column" width="100%" marginBottom={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={color('warn')}
        paddingX={layout.boxPadX}
        width="100%"
      >
        <Box justifyContent="space-between">
          <Text color={color('warn')} bold>
            {glyph.waiting} permission required
          </Text>
          <Text color={color('ghost')}>
            {approval.action}
            {queued > 0 ? `  +${queued} queued` : ''}
          </Text>
        </Box>

        {/* The verbatim command, given the most visual weight on the panel. */}
        <Box marginTop={gap}>
          <Text color={color('ghost')}>{glyph.caret} </Text>
          <Text color={color('text')} bold>
            {truncate(command, inner - 2)}
          </Text>
        </Box>

        <Box marginTop={gap} flexDirection="column">
          <Wrapped label="agent" text={approval.reason} width={inner} tone="muted" lines={explain} />
          <Wrapped label="policy" text={approval.rationale} width={inner} tone="faint" lines={explain} />
        </Box>

        <Box marginTop={gap} flexDirection="column">
          {APPROVAL_CHOICES.map((choice, index) => {
            const active = index === selected;
            return (
              <Box key={choice.key}>
                <Text color={color(active ? 'accent' : 'ghost')}>
                  {active ? glyph.caret : ' '}{' '}
                </Text>
                <Text
                  color={color(
                    active ? 'text' : choice.decision === 'deny' ? 'faint' : 'faint',
                  )}
                  bold={active}
                >
                  {choice.label}
                </Text>
                <Text color={color('ghost')}>  ({choice.key})</Text>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * A labelled paragraph wrapped by hand.
 *
 * Ink wraps text, but not with a hanging indent, so a wrapped second line would
 * start under the label and break the two-column read. Wrapping here keeps the
 * label column clean.
 */
function Wrapped({
  label,
  text,
  width,
  tone,
  lines: maxLines,
}: {
  label: string;
  text: string;
  width: number;
  tone: Parameters<typeof color>[0];
  lines: number;
}): React.ReactElement {
  const labelWidth = 8;
  const bodyWidth = Math.max(16, width - labelWidth);
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/)) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= bodyWidth) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  return (
    <Box flexDirection="column">
      {lines.slice(0, maxLines).map((line, index) => (
        <Box key={index}>
          <Box width={labelWidth}>
            <Text color={color('ghost')}>{index === 0 ? label : ''}</Text>
          </Box>
          <Text color={color(tone)}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}
