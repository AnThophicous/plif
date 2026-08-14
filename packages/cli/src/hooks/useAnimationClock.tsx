import React, { createContext, useContext, useEffect, useState } from 'react';

/**
 * Terminal animation is deliberately discrete. A coding session does not need
 * a 60 FPS paint loop, and a timer per spinner makes an idle TUI surprisingly
 * expensive on Windows. One provider owns the only Ink animation clock.
 */
export const ANIMATION_INTERVAL_MS = 180;

interface AnimationClockValue {
  readonly frame: number;
}

const AnimationClockContext = createContext<AnimationClockValue>({ frame: 0 });

export interface AnimationClockProviderProps {
  readonly active: boolean;
  readonly children: React.ReactNode;
  /** Exposed for deterministic tests; the runtime uses 180 ms. */
  readonly intervalMs?: number;
}

export function AnimationClockProvider({
  active,
  children,
  intervalMs = ANIMATION_INTERVAL_MS,
}: AnimationClockProviderProps): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setFrame((value) => value + 1);
    }, Math.max(1, intervalMs));
    // An animation must never keep a CLI process alive by itself.
    timer.unref?.();
    return () => clearInterval(timer);
  }, [active, intervalMs]);

  return (
    <AnimationClockContext.Provider value={{ frame }}>
      {children}
    </AnimationClockContext.Provider>
  );
}

/** Monotonic discrete frame number for all active Ink animation. */
export function useAnimationFrame(): number {
  return useContext(AnimationClockContext).frame;
}
