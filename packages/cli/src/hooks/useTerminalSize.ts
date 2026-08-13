import { useEffect, useRef, useState } from 'react';
import { useStdout } from 'ink';

export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

/**
 * Terminal dimensions that track window resizes.
 *
 * Ink's `useStdout` hands back the stream, not a reactive size, so a layout
 * built from `stdout.columns` at mount time is frozen at whatever width the
 * window happened to be. Dragging the terminal wider then leaves every box
 * drawn at the old width — one of those bugs nobody files and everybody
 * notices.
 *
 * Width is clamped: below ~48 columns no layout here is readable, and above
 * ~160 a full-width prompt box becomes a very long horizontal line that is
 * harder to scan than a bounded one.
 *
 * Every resize is applied immediately. A delayed size leaves Ink painting an
 * old, taller frame into a new, shorter terminal; on Windows that is exactly
 * the condition that duplicates scrollback instead of erasing it cleanly.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();

  const read = (): TerminalSize => ({
    columns: Math.max(48, Math.min(stdout?.columns ?? 80, 160)),
    rows: Math.max(10, stdout?.rows ?? 24),
  });

  const [size, setSize] = useState<TerminalSize>(read);
  const applied = useRef<TerminalSize>(size);

  useEffect(() => {
    if (!stdout) return;

    const settle = (): void => {
      const next = read();
      applied.current = next;
      setSize((previous) =>
        next.columns === previous.columns && next.rows === previous.rows ? previous : next,
      );
    };

    const onResize = (): void => {
      settle();
    };

    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}
