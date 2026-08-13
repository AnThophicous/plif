import type { WriteStream } from 'node:tty';

/** Keep Ink's dynamic output strictly below its clear-and-replay threshold. */
export function terminalFrameRows(rows: number): number {
  return Math.max(1, Math.floor(rows) - 1);
}

export type SessionFrameView = 'normal' | 'browser' | 'transcript';

/** Normal chat follows its content; only explicit full-screen views reserve rows. */
export function sessionFrameHeight(
  rows: number,
  view: SessionFrameView,
): number | undefined {
  return view === 'normal' ? undefined : terminalFrameRows(rows);
}

/**
 * Whether a new terminal size has to take effect before the resize settles.
 *
 * A window that got smaller cannot wait. The frame height is derived from the
 * size currently in state, so every repaint against a stale larger figure —
 * and the thinking highlight repaints continuously — draws a frame as tall as
 * the window now is, which is the `clearTerminal + fullStaticOutput` branch
 * this module exists to avoid. Growing can wait: being briefly out of date
 * there costs unused rows and nothing else.
 */
export function resizeAppliesImmediately(
  next: { columns: number; rows: number },
  applied: { columns: number; rows: number },
): boolean {
  return next.rows < applied.rows || next.columns < applied.columns;
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
