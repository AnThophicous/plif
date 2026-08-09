import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

const RESIZE_SETTLE_MS = 90;

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
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();

  const read = (): TerminalSize => ({
    columns: Math.max(48, Math.min(stdout?.columns ?? 80, 160)),
    rows: Math.max(10, stdout?.rows ?? 24),
  });

  const [size, setSize] = useState<TerminalSize>(read);

  useEffect(() => {
    if (!stdout) return;

    let timer: NodeJS.Timeout | undefined;

    const onResize = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        setSize((previous) => {
          const next = read();
          return next.columns === previous.columns && next.rows === previous.rows
            ? previous
            : next;
        });
      }, RESIZE_SETTLE_MS);
      timer.unref?.();
    };

    stdout.on('resize', onResize);
    return () => {
      if (timer) clearTimeout(timer);
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}
