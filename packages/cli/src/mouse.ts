/**
 * The terminal's SGR mouse protocol is deliberately kept outside App. Ink's
 * key parser treats mouse sequences as unknown printable input, so this small
 * parser must run before the normal composer path sees them.
 */

export interface SgrMouseEvent {
  readonly button: number;
  /** One-based terminal column. */
  readonly column: number;
  /** One-based terminal row. */
  readonly row: number;
  readonly action: 'press' | 'release' | 'move';
}

/** Parse both the raw SGR sequence and Ink's version with the leading ESC removed. */
export function parseSgrMouse(input: string): SgrMouseEvent | null {
  const sequence = input.startsWith('\u001b') ? input.slice(1) : input;
  const match = /^\[<(\d+);(\d+);(\d+)([mM])$/.exec(sequence);
  if (!match) return null;

  const code = Number(match[1]);
  const column = Number(match[2]);
  const row = Number(match[3]);
  if (!Number.isSafeInteger(code) || !Number.isSafeInteger(column) || !Number.isSafeInteger(row)) {
    return null;
  }

  // Wheel events remain outside the application so they cannot become an
  // accidental answer. Motion is useful only while a question is active; App
  // filters it everywhere else, preserving the normal terminal behaviour.
  if ((code & 64) !== 0) return null;
  if (column < 1 || row < 1) return null;

  return {
    button: code & 3,
    column,
    row,
    action: (code & 32) !== 0 ? 'move' : match[4] === 'M' ? 'press' : 'release',
  };
}

export interface SgrMouseRead {
  readonly handled: boolean;
  readonly event: SgrMouseEvent | null;
  /** Printable input that only looked like an incomplete mouse prefix. */
  readonly text?: string;
}

/** Only text paste tokens expose the triple-click popup action. */
export function needsPasteClickTracking(
  attachments: readonly { readonly kind: string }[],
): boolean {
  return attachments.some((attachment) => attachment.kind === 'text');
}

/**
 * Stateful boundary reader for terminals that split one mouse report across
 * stdin reads. While a possible SGR prefix is incomplete, `handled` is true so
 * the composer never receives protocol bytes as text. If a candidate becomes
 * clearly printable rather than SGR, it is replayed through the normal
 * keyboard path instead of being silently discarded.
 */
export class SgrMouseReader {
  #buffer = '';

  read(chunk: string): SgrMouseRead {
    if (!chunk && !this.#buffer) return { handled: false, event: null };
    const candidate = this.#buffer + chunk;
    const prefix = candidate.startsWith('\u001b[<') || candidate.startsWith('[<');
    if (!prefix) {
      this.#buffer = '';
      return { handled: false, event: null };
    }

    if (/[mM]$/.test(candidate)) {
      const event = parseSgrMouse(candidate);
      this.#buffer = '';
      return { handled: true, event };
    }

    // A report is short and numeric. Once it exceeds this bound it cannot
    // become a valid SGR mouse event; consume it and start a clean boundary.
    if (candidate.length > 96 || /[^\u001b\[<;\d]/.test(candidate)) {
      this.#buffer = '';
      return { handled: true, event: null, text: candidate };
    }

    this.#buffer = candidate;
    return { handled: true, event: null };
  }

  reset(): void {
    this.#buffer = '';
  }
}

export interface ClickSequence {
  readonly count: number;
  readonly at: number;
  readonly column: number;
  readonly row: number;
}

export const EMPTY_CLICK_SEQUENCE: ClickSequence = { count: 0, at: 0, column: 0, row: 0 };

/**
 * Count only a tight sequence at the same point. A normal double click elsewhere
 * in the prompt never opens the modal, and a slow sequence starts over cleanly.
 */
export function nextClickSequence(
  previous: ClickSequence,
  event: Pick<SgrMouseEvent, 'column' | 'row'>,
  at: number,
  windowMs = 650,
  distance = 1,
): ClickSequence {
  const samePoint = previous.count > 0 &&
    at - previous.at <= windowMs &&
    Math.abs(previous.column - event.column) <= distance &&
    Math.abs(previous.row - event.row) <= distance;
  return {
    count: samePoint ? previous.count + 1 : 1,
    at,
    column: event.column,
    row: event.row,
  };
}
