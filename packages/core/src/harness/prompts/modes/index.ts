import type { PromptModule } from '../types.js';
import { compactionModeModule } from './compaction.js';
import { exploreModeModule } from './explore.js';
import { primaryModeModule } from './primary.js';
import { reviewModeModule } from './review.js';
import { subagentModeModule } from './subagent.js';

export { compactionSystemPrompt } from './compaction.js';

export const MODE_MODULES: readonly PromptModule[] = [
  primaryModeModule,
  subagentModeModule,
  exploreModeModule,
  reviewModeModule,
  compactionModeModule,
];
