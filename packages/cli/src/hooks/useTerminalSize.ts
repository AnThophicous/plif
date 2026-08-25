import { useEffect, useRef, useState } from 'react';
import { useStdout } from 'ink';
import { nextTerminalSize } from '../terminal-resize.js';
import type { TerminalSize } from '../terminal-resize.js';

/**
 * Terminal dimensions that track window resizes.
 *
 * Ink's `useStdout` hands back the stream, not a reactive size, so a layout
 * built from `stdout.columns` at mount time is frozen at whatever width the
 * window happened to be. Dragging the terminal wider then leaves every box
 * drawn at the old width — one of those bugs nobody files and everybody
 * notices.
 *
 * Report the physical dimensions. Layout components decide how to degrade at
 * narrow sizes; inventing a 48x10 terminal here makes the tree larger than the
 * real viewport and is the direct cause of resize/scrollback duplication.
 * Shrinks apply immediately while growth is coalesced for one short burst.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();

  const read = (): TerminalSize => readTerminalSize(stdout);

  const [size, setSize] = useState<TerminalSize>(read);
  const applied = useRef<TerminalSize>(size);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!stdout) return;

    const clearPending = (): void => {
      if (pendingTimer.current === undefined) return;
      clearTimeout(pendingTimer.current);
      pendingTimer.current = undefined;
    };

    const apply = (next: TerminalSize): void => {
      const previous = applied.current;
      if (next.columns === previous.columns && next.rows === previous.rows) return;
      applied.current = next;
      setSize((previous) =>
        next.columns === previous.columns && next.rows === previous.rows ? previous : next,
      );
    };

    const settle = (): void => {
      pendingTimer.current = undefined;
      apply(readTerminalSize(stdout));
    };

    const onResize = (): void => {
      const measured = readTerminalSize(stdout);
      const decision = nextTerminalSize(applied.current, measured, Date.now());
      if (decision.deferredUntil === null) {
        clearPending();
        apply(decision.size);
        return;
      }

      clearPending();
      pendingTimer.current = setTimeout(
        settle,
        Math.max(1, decision.deferredUntil - Date.now()),
      );
      pendingTimer.current.unref?.();
    };

    stdout.on('resize', onResize);
    // Windows Terminal and classic console hosts do not consistently emit a
    // resize event when switching in or out of fullscreen. A cheap dimension
    // poll closes that gap while keeping the event path instantaneous.
    const poll = setInterval(onResize, 100);
    return () => {
      clearPending();
      clearInterval(poll);
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}

function readTerminalSize(stdout: { readonly columns?: number; readonly rows?: number } | undefined): TerminalSize {
  const columns = Number.isFinite(stdout?.columns) && (stdout?.columns ?? 0) > 0
    ? Math.floor(stdout!.columns!)
    : 80;
  const rows = Number.isFinite(stdout?.rows) && (stdout?.rows ?? 0) > 0
    ? Math.floor(stdout!.rows!)
    : 24;
  return { columns: Math.max(1, columns), rows: Math.max(1, rows) };
}
