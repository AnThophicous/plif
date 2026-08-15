type WriteCallback = (error?: Error | null) => void;

export interface TerminalSurfaceStream {
  readonly columns?: number;
  readonly rows?: number;
  write(
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean;
}

function surfaceTailColor(backgroundColor: string): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(backgroundColor.trim());
  if (!match) return '';

  const hex = match[1]!.length === 3
    ? match[1]!.split('').map((digit) => digit + digit).join('')
    : match[1]!;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `\u001b[48;2;${red};${green};${blue}m\u001b[2K\u001b[49m`;
}

const ERASE_LINE = '\u001b[2K';
const CURSOR_UP_ONE = '\u001b[1A';
const CURSOR_COLUMN = '\u001b[G';
const CURSOR_DOWN_ONE = '\u001b[1B';

interface InkErasePrefix {
  readonly length: number;
  readonly lines: number;
}

/**
 * Ink's log-update writes `eraseLines(previousLineCount) + frame`. The
 * default implementation erases every live row before writing the next one,
 * even when an animation changed only the prompt dock. Recognising that
 * prefix lets the surface stream replace the full erase with a row diff.
 */
function inkErasePrefix(value: string): InkErasePrefix | null {
  let offset = 0;
  let lines = 0;
  const up = `${ERASE_LINE}${CURSOR_UP_ONE}`;

  while (value.startsWith(up, offset)) {
    offset += up.length;
    lines += 1;
  }

  const final = `${ERASE_LINE}${CURSOR_COLUMN}`;
  if (!value.startsWith(final, offset)) return null;
  return { length: offset + final.length, lines: lines + 1 };
}

function frameRows(value: string): readonly string[] | null {
  if (!value.endsWith('\n')) return null;
  return value.slice(0, -1).split('\n');
}

function cursorDelta(delta: number): string {
  if (delta === 0) return '';
  return delta > 0
    ? `\u001b[${delta}B${CURSOR_COLUMN}`
    : `\u001b[${Math.abs(delta)}A${CURSOR_COLUMN}`;
}

/**
 * Produce a terminal patch while preserving Ink's cursor position. The
 * cursor is at the first row after the previous frame when log-update calls
 * us. Only changed rows are erased and written; unchanged rows are skipped.
 */
function diffInkFrame(
  previous: readonly string[],
  next: readonly string[],
): string {
  const rows = Math.max(previous.length, next.length);
  if (rows === 0) return '';

  const changed = Array.from({ length: rows }, (_, index) => index).filter(
    (index) => previous[index] !== next[index],
  );
  if (changed.length === 0) return '';

  const first = changed[0]!;
  let patch = cursorDelta(first - previous.length);
  let current = first;
  for (const index of changed) {
    if (index !== first) {
      patch += cursorDelta(index - current);
    }
    patch += `${ERASE_LINE}${next[index] ?? ''}`;
    current = index;
  }

  // Ink expects the cursor at the first row after the new frame, ready for the
  // reserved surface row. Jump there directly from the last changed row;
  // walking through every unchanged row makes terminal animation visibly
  // stutter on larger frames.
  patch += cursorDelta(next.length - current);
  return patch;
}

export function needsTerminalSurfaceTail(chunk: string): boolean {
  return chunk.includes('\n') || chunk.includes('\u001b[2J') || chunk.includes('\u001b[3J');
}

export function terminalSurfaceTail(backgroundColor: string): string {
  return surfaceTailColor(backgroundColor);
}

/**
 * Keep Ink's live frame one row short while painting the otherwise unused row
 * with the shell surface. Erasing the current line does not move the cursor,
 * so Ink's line accounting remains unchanged and scrollback stays stable.
 */
export function createTerminalSurfaceStream<T extends TerminalSurfaceStream>(
  stream: T,
  backgroundColor: () => string,
): T {
  let previousFrame: readonly string[] | null = null;
  let lastSurfaceTail = '';

  const write = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean => {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    const text = typeof chunk === 'string'
      ? chunk
      : Buffer.from(chunk).toString(encoding ?? 'utf8');
    const erase = inkErasePrefix(text);

    // A bare erase is `log.clear()`, used when static scrollback is about to
    // be printed. Its cursor movement is significant, so pass it through and
    // discard our frame coordinates until Ink paints the next live frame.
    if (erase && erase.length === text.length) {
      previousFrame = null;
      lastSurfaceTail = '';
      if (encoding === undefined) return done ? stream.write(chunk, done) : stream.write(chunk);
      return done ? stream.write(chunk, encoding, done) : stream.write(chunk, encoding);
    }

    if (erase && previousFrame !== null && erase.lines === previousFrame.length + 1) {
      const next = frameRows(text.slice(erase.length));
      if (next !== null) {
        const before = previousFrame;
        previousFrame = next;
        const patch = diffInkFrame(before, next);
        const surfaceTail = surfaceTailColor(backgroundColor());
        const tail = surfaceTail === lastSurfaceTail ? '' : surfaceTail;
        const value = patch + tail;
        if (!value) {
          done?.();
          return true;
        }
        lastSurfaceTail = surfaceTail;
        if (encoding === undefined) return done ? stream.write(value, done) : stream.write(value);
        return done ? stream.write(value, encoding, done) : stream.write(value, encoding);
      }
    }

    // The first live frame, and the frame immediately after static output,
    // have no erase prefix. Keep them intact; the next prefixed frame gives us
    // a safe baseline for incremental updates without guessing which raw
    // newline write was scrollback.
    if (erase) {
      const next = frameRows(text.slice(erase.length));
      if (next !== null) previousFrame = next;
    } else if (text.includes('\n')) {
      previousFrame = null;
    }

    const tail = needsTerminalSurfaceTail(text) ? surfaceTailColor(backgroundColor()) : '';
    if (tail) lastSurfaceTail = tail;

    if (!tail) {
      if (encoding === undefined) return done ? stream.write(chunk, done) : stream.write(chunk);
      return done ? stream.write(chunk, encoding, done) : stream.write(chunk, encoding);
    }

    if (typeof chunk === 'string') {
      const value = chunk + tail;
      if (encoding === undefined) return done ? stream.write(value, done) : stream.write(value);
      return done ? stream.write(value, encoding, done) : stream.write(value, encoding);
    }

    const accepted = encoding === undefined ? stream.write(chunk) : stream.write(chunk, encoding);
    if (done) {
      stream.write(tail, done);
    } else {
      stream.write(tail);
    }
    return accepted;
  };

  return new Proxy(stream, {
    get(target, property, receiver) {
      if (property === 'write') return write;
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;
}
