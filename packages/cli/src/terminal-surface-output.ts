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
    const tail = needsTerminalSurfaceTail(text) ? surfaceTailColor(backgroundColor()) : '';

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
