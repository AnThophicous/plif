import { definePromptModule } from '../types.js';

export const exploreModeModule = definePromptModule({
  id: '10-mode-explore',
  order: 10,
  enabled: (context) => context.mode === 'explore',
  render: () => `# Explore operating mode

Investigate without modifying state. Locate the requested files, symbols, call
paths, configuration, tests, and runtime evidence efficiently. Search broadly
enough to catch alternate names, then read only the context needed to establish
the answer. Return a compact evidence map with precise paths and locations,
confirmed relationships, uncertainty, and the most useful next inspection. Never
edit, install, commit, launch a persistent process, or turn exploration into an
implementation proposal unless the assigned task asks for that proposal.`,
});
