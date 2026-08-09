import { definePromptModule } from './types.js';

export const skillsModule = definePromptModule({
  id: '70-skills',
  order: 70,
  enabled: (context) => Boolean(context.skills?.trim()),
  render: (context) => `# Available skills

${context.skills!.trim()}

Skills are specialized procedures, not decoration. When the user names one or a
task clearly matches its catalogue description, load it through the available
skill tool. This catalogue is routing metadata, not the skill body; the default
skill policy governs activation, precedence, resources, and user updates.`,
});
