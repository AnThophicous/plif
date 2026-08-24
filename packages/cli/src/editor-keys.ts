export interface EditorKeyFlags {
  readonly backspace: boolean;
  readonly delete: boolean;
}

export type EditorDeleteAction = 'backward' | 'forward' | null;

/**
 * Ink 5 maps both Windows Backspace (DEL, 0x7f) and the Delete escape sequence
 * to key.delete. The raw sequence is the only way to keep their directions
 * distinct.
 */
export function editorDeleteAction(
  key: EditorKeyFlags,
  rawInput: string | null,
): EditorDeleteAction {
  if (key.backspace) return 'backward';
  if (!key.delete) return null;
  if (rawInput === '\x7f' || rawInput === '\x1b\x7f' || rawInput === '\b') return 'backward';
  return 'forward';
}
