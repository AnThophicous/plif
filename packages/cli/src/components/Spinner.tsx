import React, { useEffect, useState } from 'react';
import { Text } from 'ink';

import { color, formatDuration, supportsRichGlyphs } from '../theme.js';

/**
 * Braille dots. Eight frames, one cell wide, and — unlike a spinning slash —
 * the motion happens *inside* the character rather than by changing its
 * silhouette, so the line next to it does not appear to jitter.
 */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];
const ASCII_FRAMES = ['-', '\\', '|', '/'];

const frames = supportsRichGlyphs ? FRAMES : ASCII_FRAMES;

/**
 * Advances a frame index on an interval.
 *
 * Separated from the component so the timer exists once per spinner rather than
 * once per render, and so it can be shared by anything else that needs a tick.
 */
export function useSpinnerFrame(intervalMs = 80, active = true): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setIndex((value) => (value + 1) % frames.length), intervalMs);
    // Never let an animation be the reason the process stays alive.
    timer.unref?.();
    return () => clearInterval(timer);
  }, [intervalMs, active]);

  return frames[index % frames.length] as string;
}

/**
 * A live elapsed-time counter.
 *
 * Re-renders once a second, not on every spinner frame. A developer watching a
 * slow command wants to know it is alive (the spinner) and how long it has been
 * going (this) — and updating a duration ten times a second makes it unreadable
 * without telling them anything more.
 */
export function useElapsed(since: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [active, since]);

  return Math.max(0, now - since);
}

interface SpinnerProps {
  readonly label?: string;
  /** When set, an elapsed counter is drawn after the label. */
  readonly since?: number;
  readonly tone?: Parameters<typeof color>[0];
}

export function Spinner({ label, since, tone = 'accent' }: SpinnerProps): React.ReactElement {
  const frame = useSpinnerFrame();
  const elapsed = useElapsed(since ?? Date.now(), since !== undefined);

  return (
    <Text>
      <Text color={color(tone)}>{frame}</Text>
      {label && <Text color={color('muted')}> {label}</Text>}
      {since !== undefined && elapsed >= 1000 && (
        <Text color={color('ghost')}> {formatDuration(elapsed)}</Text>
      )}
    </Text>
  );
}
