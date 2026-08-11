import { definePromptModule } from './types.js';

export const skillsModule = definePromptModule({
  id: '70-skills',
  order: 70,
  enabled: (context) => Boolean(context.skills?.trim()),
  render: (context) => `# Available skills

${context.skills!.trim()}

Treat this catalogue as an active routing table. For every request, silently scan
names, package labels, and descriptions for a clear match. The user does not need
to mention a skill or know that it exists. Load the smallest sufficient matching
set through the skill tool before covered work begins. A package groups related
skills but does not require loading every child.

This catalogue is routing metadata, not the skill body. If no entry clearly
matches, proceed normally without announcing the scan. If a selected skill cannot
load or does not fit after inspection, discard it and continue with the default
workflow. The default skill policy governs precedence, resources, and user
updates.`,
});
