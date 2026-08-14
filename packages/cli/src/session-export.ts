import type { TranscriptCell } from './transcript/types.js';

export interface SessionExportInput {
  readonly cells: readonly TranscriptCell[];
  readonly active?: TranscriptCell | null;
  readonly workspace: string;
  readonly goal?: string;
  readonly exportedAt?: Date;
}

function block(lines: string[], heading: string, text: string): void {
  lines.push(`## ${heading}`, text.trim() || '(empty)', '');
}

function formatCell(lines: string[], cell: TranscriptCell): void {
  switch (cell.kind) {
    case 'user':
      block(lines, 'User', cell.text);
      return;
    case 'assistant':
      block(lines, cell.phase === 'commentary' ? 'Assistant · commentary' : 'Assistant', cell.text);
      return;
    case 'reasoning':
      block(lines, 'Reasoning', cell.text);
      return;
    case 'activity':
      block(
        lines,
        'Activity',
        cell.items.map((item) => {
          const state = item.status === 'done' ? 'done' : 'running';
          return `- [${state}] ${item.name}${item.output ? `\n  ${item.output.replaceAll('\n', '\n  ')}` : ''}`;
        }).join('\n'),
      );
      return;
    case 'diff':
      block(lines, `Diff · ${cell.title}`, cell.diff);
      return;
    case 'error':
      block(lines, `Error · ${cell.title}`, cell.detail);
      return;
    case 'approval':
      block(lines, 'Approval', `${cell.text}${cell.resolution ? `\nResolution: ${cell.resolution}` : ''}`);
      return;
    case 'question':
      block(lines, 'Question', `${cell.text}${cell.answer ? `\nAnswer: ${cell.answer}` : ''}`);
      return;
    case 'notice':
      block(lines, 'Notice', cell.text);
      return;
  }
}

export function formatSessionExport(input: SessionExportInput): string {
  const cells = input.active && !input.cells.some((cell) => cell.id === input.active?.id)
    ? [...input.cells, input.active]
    : input.cells;
  const at = input.exportedAt ?? new Date();
  const lines = [
    '# Plif-Code session',
    `Workspace: ${input.workspace}`,
    `Exported: ${at.toISOString()}`,
    ...(input.goal ? [`Session goal: ${input.goal}`] : []),
    '',
  ];

  for (const cell of cells) formatCell(lines, cell);
  return lines.join('\n').trimEnd() + '\n';
}

export function sessionExportFileName(at = new Date()): string {
  const stamp = at.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  return `plif-session-${stamp}.txt`;
}
