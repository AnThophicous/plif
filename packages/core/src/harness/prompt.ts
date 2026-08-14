import { compileAgentInstructions } from '../agenting/compiler.js';
import type { PromptContext } from '../agenting/types.js';

export type { PromptContext, PromptMode, PromptModule } from '../agenting/types.js';
export { readAgentInstructions } from '../agenting/project-instructions.js';

export function buildSystemPrompt(context: PromptContext): string {
  return compileAgentInstructions(context);
}
