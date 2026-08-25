import type { Question, QuestionChoice } from '@plif/core';

export interface ProjectBrief {
  readonly stack: string;
  readonly style: string;
}

type AskQuestion = (question: Question) => Promise<string | null>;

const FRONTEND_SIGNAL = /\b(?:website|web\s+site|landing|frontend|front-end|ui|ux|interface|design|css|html|react|next(?:\.js)?|vue|svelte|tailwind|component|dashboard|page|site)\b/i;

/** Only frontend/design-shaped requests need a creative implementation brief. */
export function needsProjectBrief(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.startsWith('!') && FRONTEND_SIGNAL.test(trimmed);
}

const STACK_OPTIONS: readonly QuestionChoice[] = [
  { value: 'html-css-js', label: 'HTML + CSS + JavaScript', description: 'static, dependency-free page' },
  { value: 'react-ts', label: 'React + TypeScript', description: 'component-based interface' },
  { value: 'next-ts', label: 'Next.js + TypeScript', description: 'React app with routing and server features' },
  { value: 'vue-ts', label: 'Vue + TypeScript', description: 'Vue application' },
  { value: 'other', label: 'Other stack', description: 'type the stack in the same input' },
];

const STYLE_OPTIONS: readonly QuestionChoice[] = [
  { value: 'neo-minimalism', label: 'NeoMinimalism', description: 'quiet, precise, reduced interface' },
  { value: 'neomorphism', label: 'Neomorphism', description: 'soft depth and tactile surfaces' },
  { value: 'maximalism', label: 'Maximalism', description: 'expressive, dense, high-energy composition' },
  { value: 'editorial', label: 'Editorial', description: 'typography-led, structured, art-directed' },
  { value: 'brutalism', label: 'Brutalism', description: 'raw, direct, intentionally unconventional' },
  { value: 'other', label: 'Other visual style', description: 'type the direction in the same input' },
];

async function chooseOrType(
  ask: AskQuestion,
  question: string,
  context: string,
  options: readonly QuestionChoice[],
): Promise<string | null> {
  const selected = await ask({ text: question, context, options });
  if (!selected) return null;
  if (selected !== 'other') return selected;
  return await ask({
    text: 'Type the exact choice PLIF must use.',
    context: 'This value becomes part of the project brief and must be respected during implementation.',
  });
}

/** Ask through the existing Ink question broker, so the same input stays active. */
export async function askProjectBrief(ask: AskQuestion, request: string): Promise<ProjectBrief | undefined | null> {
  if (!needsProjectBrief(request)) return undefined;

  const stack = await chooseOrType(
    ask,
    'Which stack should PLIF use for this frontend task?',
    'Choose before implementation. The selected stack is authoritative for this request.',
    STACK_OPTIONS,
  );
  if (!stack) return null;

  const style = await chooseOrType(
    ask,
    'Which visual direction should PLIF follow?',
    'Choose the design language before implementation. Do not replace it with a generic default.',
    STYLE_OPTIONS,
  );
  if (!style) return null;

  return { stack, style };
}

export function projectBriefInstruction(brief: ProjectBrief): string {
  return [
    '[PLIF PROJECT BRIEF — USER SELECTED]',
    `Stack: ${brief.stack}`,
    `Visual direction: ${brief.style}`,
    'Treat these choices as hard constraints for this request. Preserve them in architecture, implementation, copy, and validation unless the user explicitly changes them.',
    '[/PLIF PROJECT BRIEF]',
  ].join('\n');
}
