export interface ActivityItem {
  readonly id: string;
  readonly callId: string;
  readonly name: string;
  readonly status: 'running' | 'done';
  readonly output?: string;
  readonly durationMs?: number;
}

interface CellBase<K extends string> {
  readonly id: string;
  readonly turnId: string;
  readonly at: string;
  readonly kind: K;
  readonly finalized: boolean;
}

export type TranscriptCell =
  | (CellBase<'user'> & { readonly text: string })
  | (CellBase<'assistant'> & {
      readonly text: string;
      readonly phase: 'commentary' | 'final';
    })
  | (CellBase<'reasoning'> & { readonly text: string })
  | (CellBase<'activity'> & {
      readonly items: readonly ActivityItem[];
      readonly expanded: boolean;
    })
  | (CellBase<'diff'> & { readonly title: string; readonly diff: string })
  | (CellBase<'error'> & { readonly title: string; readonly detail: string })
  | (CellBase<'approval'> & {
      readonly requestId: string;
      readonly text: string;
      readonly resolution?: string;
    })
  | (CellBase<'question'> & {
      readonly requestId: string;
      readonly text: string;
      readonly answer?: string;
    })
  | (CellBase<'notice'> & {
      readonly tone: 'muted' | 'warn' | 'danger';
      readonly text: string;
    });

export interface TranscriptState {
  readonly finalized: readonly TranscriptCell[];
  readonly active: TranscriptCell | null;
  readonly seenEventIds: ReadonlySet<string>;
  readonly calls: ReadonlyMap<string, { readonly turnId: string; readonly name: string }>;
}

export type TranscriptAction =
  | { readonly type: 'replace'; readonly events: readonly import('@plif/core').ConversationEvent[] }
  | { readonly type: 'event'; readonly event: import('@plif/core').ConversationEvent }
  | {
      readonly type: 'assistant.frame';
      readonly turnId: string;
      readonly at: string;
      readonly epoch: number;
      readonly text: string;
    }
  | {
      readonly type: 'reasoning.frame';
      readonly turnId: string;
      readonly at: string;
      readonly epoch: number;
      readonly text: string;
    }
  | { readonly type: 'stream.reset'; readonly turnId: string }
  | { readonly type: 'reset' };
