import type { PastedAttachment } from './state.js';

export interface MaterializedPaste {
  readonly text: string;
  readonly attachments: readonly PastedAttachment[];
}

/**
 * Large text pastes are represented by a short token in the editor, but the
 * token is never the model payload. Replace each token at its exact insertion
 * point before sending, preserving the order of typed text and multiple pastes.
 */
export function materializePastedLine(
  line: string,
  attachments: readonly PastedAttachment[],
): MaterializedPaste {
  let text = line;
  const consumed = new Set<number>();
  attachments.forEach((attachment, index) => {
    if (attachment.kind !== 'text' || !attachment.token) return;
    const at = text.indexOf(attachment.token);
    if (at < 0) return;
    text = text.slice(0, at) + attachment.text + text.slice(at + attachment.token.length);
    consumed.add(index);
  });
  return {
    text,
    attachments: attachments.filter((_attachment, index) => !consumed.has(index)),
  };
}

