import type { SessionAction } from './session.js';

export type PreToolProseVisibility = 'transient' | 'activity';

export function preToolProseAction(
  id: string,
  text: string,
  visibility: PreToolProseVisibility,
): SessionAction {
  if (visibility === 'transient') return { type: 'drop', id };

  return {
    type: 'update',
    id,
    patch: {
      kind: 'step',
      title: 'Preparing',
      detail: text.trim(),
      tone: 'faint',
      status: 'done',
    },
  };
}
