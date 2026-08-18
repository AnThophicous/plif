import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/**
 * Terminal animation is deliberately sampled, not rendered at 60 FPS. One
 * provider owns two cadence-specific clocks: a slow one for spinners and a
 * faster one for visual pulse consumers. This keeps each effect smooth without
 * giving every widget its own interval.
 */
export const ANIMATION_INTERVAL_MS = 120;
export const FAST_ANIMATION_INTERVAL_MS = 33;

export type AnimationRate = 'slow' | 'fast';

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
  readonly fastClock: AnimationClockSource;
  readonly plif: boolean;
}

const idleClock = createAnimationClock();
const idleFastClock = createAnimationClock();
const AnimationClockContext = createContext<AnimationClockValue>({
  clock: idleClock,
  fastClock: idleFastClock,
  plif: false,
});
const EMPTY_SUBSCRIBE = (): (() => void) => () => undefined;
const ZERO_SNAPSHOT = (): number => 0;

export interface AnimationClockProviderProps {
  readonly active: boolean;
  readonly children: React.ReactNode;
  /** Stable glyph variant for active Plif work. */
  readonly plif?: boolean;
  /** Optional work that must share the same terminal paint pulse. */
  readonly onTick?: () => void;
  /** Exposed for deterministic tests; the slow runtime cadence is 120 ms. */
  readonly intervalMs?: number;
  /**
   * Whether the fast clock advances. Defaults to `active`.
   *
   * Ambient focus (an idle breathing prompt, an open menu) needs the slow
   * cadence only; keeping the 33 ms clock stopped then is what makes "alive
   * at rest" cheap enough to leave on.
   */
  readonly fastActive?: boolean;
}

export function AnimationClockProvider({
  active,
  children,
  plif = false,
  onTick,
  intervalMs = ANIMATION_INTERVAL_MS,
  fastActive,
}: AnimationClockProviderProps): React.ReactElement {
  const clock = useMemo(createAnimationClock, []);
  const fastClock = useMemo(createAnimationClock, []);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const fastRuns = fastActive ?? active;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      clock.tick();
      onTickRef.current?.();
    }, Math.max(1, intervalMs));
    // An animation must never keep a CLI process alive by itself.
    timer.unref?.();
    const fastTimer = fastRuns
      ? setInterval(() => fastClock.tick(), FAST_ANIMATION_INTERVAL_MS)
      : null;
    fastTimer?.unref?.();
    return () => {
      clearInterval(timer);
      if (fastTimer) clearInterval(fastTimer);
    };
  }, [active, fastRuns, clock, fastClock, intervalMs]);

  const value = useMemo(() => ({ clock, fastClock, plif }), [clock, fastClock, plif]);
  return (
    <AnimationClockContext.Provider value={value}>
      {children}
    </AnimationClockContext.Provider>
  );
}

/** Monotonic discrete frame number for all active Ink animation. */
export function useAnimationFrame(active = true, rate: AnimationRate = 'slow'): number {
  const clocks = useContext(AnimationClockContext);
  const clock = rate === 'fast' ? clocks.fastClock : clocks.clock;
  const subscribe = active ? clock.subscribe : EMPTY_SUBSCRIBE;
  const snapshot = active ? clock.getSnapshot : ZERO_SNAPSHOT;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Whether active spinner consumers should keep their glyph stable for Plif. */
export function usePlifAnimation(): boolean {
  return useContext(AnimationClockContext).plif;
}
