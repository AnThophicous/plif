export interface EditorKeyFlags {
  readonly backspace: boolean;
  readonly delete: boolean;
}

export type EditorDeleteAction = 'backward' | 'forward' | null;

/**
 * Ink normally reports a control shortcut as the printable letter plus
 * `key.ctrl`. Some Windows terminals deliver the ASCII control byte instead
 * (Ctrl+E is 0x05) and Ink leaves `key.ctrl` unset. Accept both wire forms so
 * shortcuts do not silently become no-ops on one terminal family.
 */
export function isControlShortcut(
  char: string,
  key: { readonly ctrl?: boolean },
  letter: string,
): boolean {
  if (letter.length !== 1) return false;
  const controlByte = String.fromCharCode(letter.toLowerCase().charCodeAt(0) - 96);
  return char === controlByte || (key.ctrl === true && char.toLowerCase() === letter.toLowerCase());
}

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
