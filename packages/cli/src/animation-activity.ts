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
    activity.runningTimeline === true
  );
}
