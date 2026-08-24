import type { SessionAction } from './session.js';

export type PreToolProseVisibility = 'transient' | 'activity';

/**
 * Review receipts are orchestration noise, not user-facing answer prose.
 * Models sometimes repeat a complete audit table before every final tool call;
 * keep the state visible while reducing that repeated receipt to one quiet row.
 */
export function compactPlifReviewCheckpoint(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const namesReview = /\b(?:review gate|checkpoint|gate)\b/i.test(normalized);
  const namesEvidence = /\b(?:evidence|evidência|validation|validação|verified|verificad|changed files|arquivos alterados|achados)\b/i.test(normalized);
  if (!namesReview || !namesEvidence) return null;

  if (/\b(?:satisfied|satisfeito|complete|completed|conclu|verified|verificad|passed|passou|fechad|closed)\b/i.test(normalized)) {
    return 'Review checkpoint complete';
  }
  if (/\b(?:pending|pendente|missing|falt|still|ainda|need|precis|incomplete|incomplet|failed|falh)\b/i.test(normalized)) {
    return 'Review checkpoint in progress';
  }
  return 'Review checkpoint';
}

export function preToolProseAction(
  id: string,
  text: string,
  visibility: PreToolProseVisibility,
  title = 'Preparing',
): SessionAction {
  if (visibility === 'transient') return { type: 'drop', id };

  return {
    type: 'update',
    id,
    patch: {
      kind: 'step',
      title,
      detail: text.trim(),
      tone: 'faint',
      status: 'done',
    },
  };
}
