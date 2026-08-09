import type { WriteStream } from 'node:tty';

/** Keep Ink's dynamic output strictly below its clear-and-replay threshold. */
export function terminalFrameRows(rows: number): number {
  return Math.max(1, Math.floor(rows) - 1);
}

/**
 * Ink handles SIGWINCH before React can render with the new dimensions. Its
 * intermediate render may be taller than the restored window, which activates
 * `clearTerminal + fullStaticOutput` and duplicates scrollback on Windows.
 * Plif owns resize through `useTerminalSize`, so remove only the listener Ink
 * added during `render()` and leave every pre-existing/application listener.
 */
export function detachImmediateInkResize(
  stream: WriteStream,
  before: ReadonlySet<(...args: unknown[]) => void>,
): number {
  let removed = 0;
  for (const listener of stream.listeners('resize')) {
    const candidate = listener as (...args: unknown[]) => void;
    if (before.has(candidate) || listener.name !== 'resized') continue;
    stream.off('resize', candidate);
    removed += 1;
  }
  return removed;
}
