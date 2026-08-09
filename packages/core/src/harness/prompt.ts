import { compileSystemPrompt } from './prompts/compiler.js';
import type { PromptContext } from './prompts/types.js';

export type { PromptContext, PromptMode, PromptModule } from './prompts/types.js';
export { readAgentInstructions } from './prompts/project.js';

export function buildSystemPrompt(context: PromptContext): string {
  return compileSystemPrompt(context);
}
