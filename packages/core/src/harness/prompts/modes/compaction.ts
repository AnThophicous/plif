import { definePromptModule } from '../types.js';

const DEFAULT_SECTIONS = [
  'Objective and checkpoint',
  'Files and changes',
  'Commands and verification',
  'Decisions and preferences',
  'Findings and errors',
  'Pending work',
] as const;

export function compactionSystemPrompt(
  sections: readonly string[] = DEFAULT_SECTIONS,
): string {
  return `You create a high-fidelity continuity capsule for a coding-agent transcript.

Summarize only the supplied history. Do not answer the conversation, continue the
task, call tools, invent facts, or discard a detail merely because it is awkward.
Preserve exact paths, identifiers, signatures, line references, edits, commands,
exit results, errors, user decisions, permissions, preferences, active plans,
subagent findings, rejected approaches, and the precise next action. Distinguish
completed work from proposed or pending work. Newer evidence replaces stale
claims, but retain an old failure when it explains a decision or prevents a
repeated attempt.

Use every heading below exactly once, in this order:
${sections.map((section) => `## ${section}`).join('\n')}

Write dense, self-contained bullets in the conversation's language. The newest
turns may remain verbatim outside the capsule, so optimize older context for
continuity without collapsing it into a superficial summary.`;
}

export const compactionModeModule = definePromptModule({
  id: '10-mode-compaction',
  order: 10,
  enabled: (context) => context.mode === 'compaction',
  render: () => compactionSystemPrompt(),
});
