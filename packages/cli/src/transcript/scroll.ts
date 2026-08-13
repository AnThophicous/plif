export interface TranscriptViewport {
  readonly open: boolean;
  /** Zero-based terminal line at the top of the overlay body. */
  readonly offset: number;
  /** Follow new content while the viewport is at the live tail. */
  readonly follow: boolean;
}

interface ViewportMetrics {
  readonly contentLines: number;
  readonly height: number;
}

export type TranscriptViewportAction =
  | ({ readonly type: 'open' } & ViewportMetrics)
  | { readonly type: 'close' }
  | ({ readonly type: 'line'; readonly delta: -1 | 1 } & ViewportMetrics)
  | ({ readonly type: 'page'; readonly delta: -1 | 1 } & ViewportMetrics)
  | ({ readonly type: 'home' } & ViewportMetrics)
  | ({ readonly type: 'end' } & ViewportMetrics)
  | ({ readonly type: 'content' } & ViewportMetrics)
  | ({ readonly type: 'resize' } & ViewportMetrics);

export const initialViewport: TranscriptViewport = {
  open: false,
  offset: 0,
  follow: true,
};

function maxOffset(metrics: ViewportMetrics): number {
  return Math.max(0, metrics.contentLines - Math.max(1, metrics.height));
}

function clamp(offset: number, metrics: ViewportMetrics): number {
  return Math.max(0, Math.min(offset, maxOffset(metrics)));
}

export function viewportReducer(
  state: TranscriptViewport,
  action: TranscriptViewportAction,
): TranscriptViewport {
  if (action.type === 'close') return { ...state, open: false };
  const end = maxOffset(action);

  switch (action.type) {
    case 'open':
      return { open: true, offset: end, follow: true };
    case 'line': {
      const offset = clamp(state.offset + action.delta, action);
      return { ...state, open: true, offset, follow: offset === end };
    }
    case 'page': {
      const page = Math.max(1, action.height - 2);
      const offset = clamp(state.offset + action.delta * page, action);
      return { ...state, open: true, offset, follow: offset === end };
    }
    case 'home':
      return { ...state, open: true, offset: 0, follow: end === 0 };
    case 'end':
      return { ...state, open: true, offset: end, follow: true };
    case 'content':
    case 'resize':
      return {
        ...state,
        offset: state.follow ? end : clamp(state.offset, action),
      };
  }
}

/** Return whole semantic cells intersecting a line-based viewport. */
export function visibleTranscriptSlice<T>(
  items: readonly T[],
  viewport: TranscriptViewport,
  height: number,
  measure: (item: T) => number = () => 1,
): readonly T[] {
  const start = viewport.offset;
  const end = start + Math.max(1, height);
  const visible: T[] = [];
  let line = 0;

  for (const item of items) {
    const next = line + Math.max(1, measure(item));
    if (next > start && line < end) visible.push(item);
    if (line >= end) break;
    line = next;
  }
  return visible;
}
