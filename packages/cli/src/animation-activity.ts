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
  /**
   * A menu or the focused idle prompt wants subtle motion.
   *
   * Kept separate from the strong-frame inputs: it advances the shared clock
   * so breathing carets and selections can tick, without promoting the prompt
   * frame to its full travelling wave.
   */
  readonly ambientFocus?: boolean;
}

/** Whether the shared Ink animation clock should advance. */
export function animationClockActive(activity: AnimationActivity): boolean {
  return (
    activity.busy ||
    activity.compacting ||
    activity.browserLoading ||
    activity.runningTask ||
    activity.runningSubagent ||
    activity.runningDiscovery ||
    activity.effortTransitioning === true ||
    activity.runningTimeline === true ||
    activity.ambientFocus === true
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
