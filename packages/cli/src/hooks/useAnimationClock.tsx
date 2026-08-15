import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/**
 * Terminal animation is deliberately discrete. A coding session does not need
 * a 60 FPS paint loop, and a timer per spinner makes an idle TUI surprisingly
 * expensive on Windows. One provider owns the only Ink animation clock.
 */
export const ANIMATION_INTERVAL_MS = 120;

interface AnimationClockSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => number;
  readonly tick: () => void;
}

const EMPTY_SUBSCRIBE = (): (() => void) => () => undefined;
const ZERO_SNAPSHOT = (): number => 0;
const AnimationClockContext = createContext<AnimationClockSource | null>(null);

function createAnimationClock(): AnimationClockSource {
  let frame = 0;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return frame;
    },
    tick() {
      frame += 1;
      for (const listener of listeners) listener();
    },
  };
}

export interface AnimationClockProviderProps {
  readonly active: boolean;
  readonly children: React.ReactNode;
  /** Optional work that must share the same terminal paint pulse. */
  readonly onTick?: () => void;
  /** Exposed for deterministic tests; the runtime uses 120 ms. */
  readonly intervalMs?: number;
}

export function AnimationClockProvider({
  active,
  children,
  onTick,
  intervalMs = ANIMATION_INTERVAL_MS,
}: AnimationClockProviderProps): React.ReactElement {
  const clock = useMemo(createAnimationClock, []);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      clock.tick();
      onTickRef.current?.();
    }, Math.max(1, intervalMs));
    // An animation must never keep a CLI process alive by itself.
    timer.unref?.();
    return () => clearInterval(timer);
  }, [active, clock, intervalMs]);

  return (
    <AnimationClockContext.Provider value={clock}>
      {children}
    </AnimationClockContext.Provider>
  );
}

/** Monotonic discrete frame number for all active Ink animation. */
export function useAnimationFrame(): number {
  const clock = useContext(AnimationClockContext);
  return useSyncExternalStore(
    clock?.subscribe ?? EMPTY_SUBSCRIBE,
    clock?.getSnapshot ?? ZERO_SNAPSHOT,
    clock?.getSnapshot ?? ZERO_SNAPSHOT,
  );
}
