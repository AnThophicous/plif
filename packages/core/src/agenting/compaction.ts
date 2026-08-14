import { instruction, renderInstruction } from './instruction-loader.js';

const DEFAULT_SECTIONS = [
  'Objective and checkpoint',
  'Files and changes',
  'Commands and verification',
  'Decisions and preferences',
  'Findings and errors',
  'Pending work',
] as const;

export function compactionSystemPrompt(sections: readonly string[] = DEFAULT_SECTIONS): string {
  return renderInstruction(instruction('15-mode-compaction').source, {
    compaction_sections: sections.map((section) => `## ${section}`).join('\n'),
  });
}

