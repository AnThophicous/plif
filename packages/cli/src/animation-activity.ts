export interface AnimationActivity {
  readonly effort?: string;
  readonly busy: boolean;
  readonly compacting: boolean;
  readonly browserLoading: boolean;
  readonly runningTask: boolean;
  readonly runningSubagent: boolean;
  readonly runningDiscovery: boolean;
  /** Bounded visual transition after changing the selected effort. */
  readonly effortTransitioning?: boolean;
  /** Active timeline rows can be driven by preview or an event-only surface. */
  readonly runningTimeline?: boolean;
}

/**
 * Whether the shared animation clock should advance.
 *
 * Only real work animates. An idle prompt used to keep the clock running for a
 * breathing caret, and every tick of that clock re-laid-out and repainted the
 * whole frame — so a session that was doing nothing still spent its CPU
 * redrawing itself eight times a second. Nothing is happening, so nothing
 * moves.
 */
export function animationClockActive(activity: AnimationActivity): boolean {
  return (
    activity.busy ||
    activity.compacting ||
    activity.browserLoading ||
    activity.runningTask ||
    activity.runningSubagent ||
    activity.runningDiscovery ||
    activity.effortTransitioning === true ||
    activity.runningTimeline === true
  );
}

/** Whether the prompt frame should carry its full travelling wave. */
export function strongFrameActive(activity: AnimationActivity): boolean {
  return (
    activity.busy ||
    activity.compacting ||
    activity.runningTask ||
    activity.runningSubagent ||
    activity.runningDiscovery ||
    activity.effortTransitioning === true ||
    activity.runningTimeline === true
  );
}
