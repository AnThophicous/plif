import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/**
 * Terminal animation is deliberately sampled, not rendered at 60 FPS. One
 * shared 120ms clock gives gradients enough intermediate colour samples to
 * avoid stepping while keeping the renderer quiet compared with a per-widget
 * timer.
 */
export const ANIMATION_INTERVAL_MS = 120;

interface AnimationClockSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => number;
  readonly tick: () => void;
}

function createAnimationClock(): AnimationClockSource {
  let frame = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => frame,
    tick() {
      frame += 1;
      for (const listener of listeners) listener();
    },
  };
}

interface AnimationClockValue {
  readonly clock: AnimationClockSource;
  readonly plif: boolean;
}

const idleClock = createAnimationClock();
const AnimationClockContext = createContext<AnimationClockValue>({ clock: idleClock, plif: false });

export interface AnimationClockProviderProps {
  readonly active: boolean;
  readonly children: React.ReactNode;
  /** Stable glyph variant for active Plif work. */
  readonly plif?: boolean;
  /** Optional work that must share the same terminal paint pulse. */
  readonly onTick?: () => void;
  /** Exposed for deterministic tests; the runtime uses 120 ms. */
  readonly intervalMs?: number;
}

export function AnimationClockProvider({
  active,
  children,
  plif = false,
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
    <AnimationClockContext.Provider value={{ clock, plif }}>
      {children}
    </AnimationClockContext.Provider>
  );
}

/** Monotonic discrete frame number for all active Ink animation. */
export function useAnimationFrame(): number {
  const clock = useContext(AnimationClockContext).clock;
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}

/** Whether active spinner consumers should keep their glyph stable for Plif. */
export function usePlifAnimation(): boolean {
  return useContext(AnimationClockContext).plif;
}
