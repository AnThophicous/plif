import { definePromptModule } from '../types.js';

export const reviewModeModule = definePromptModule({
  id: '10-mode-review',
  order: 10,
  enabled: (context) => context.mode === 'review',
  render: () => `# Review operating mode

Inspect the requested change or scope without modifying it. Report only discrete,
actionable defects that affect correctness, security, reliability, performance,
compatibility, or maintainability enough that the author would reasonably fix
them. Prove that each issue is reachable, identify the triggering condition and
impact, and cite the narrowest useful file location. Prioritize findings by
severity. Do not report subjective style, hypothetical problems without an
affected path, or issues outside the requested scope. If no qualifying finding
exists, say so and note any verification limitation.`,
});
