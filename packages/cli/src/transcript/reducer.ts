import type { ConversationEvent } from '@plif/core';

import type {
  ActivityItem,
  TranscriptAction,
  TranscriptCell,
  TranscriptState,
} from './types.js';

export const initialTranscriptState: TranscriptState = {
  finalized: [],
  active: null,
  seenEventIds: new Set(),
  calls: new Map(),
};

function finalized(cell: TranscriptCell): TranscriptCell {
  return cell.finalized ? cell : { ...cell, finalized: true };
}

function finalizeActive(state: TranscriptState): TranscriptState {
  if (!state.active) return state;
  return {
    ...state,
    finalized: [...state.finalized, finalized(state.active)],
    active: null,
  };
}

function beginCell(state: TranscriptState, cell: TranscriptCell): TranscriptState {
  const settled = finalizeActive(state);
  return { ...settled, active: cell };
}

function appendFinalized(state: TranscriptState, cell: TranscriptCell): TranscriptState {
  return { ...state, finalized: [...state.finalized, finalized(cell)] };
}

function streamCellId(
  lane: 'assistant' | 'reasoning',
  turnId: string,
  epoch: number,
): string {
  return `stream:${lane}:${turnId}:${epoch}`;
}

function isStreamCell(cell: TranscriptCell, turnId: string, lane?: 'assistant' | 'reasoning'): boolean {
  const prefix = lane ? `stream:${lane}:${turnId}:` : 'stream:';
  return cell.turnId === turnId && cell.id.startsWith(prefix);
}

/** Replace every ephemeral cell for one lane with its single durable form. */
function replaceStreamLane(
  state: TranscriptState,
  lane: 'assistant' | 'reasoning',
  turnId: string,
  cell: TranscriptCell,
): { state: TranscriptState; replaced: boolean } {
  const first = state.finalized.findIndex((item) => isStreamCell(item, turnId, lane));
  const activeMatches = state.active ? isStreamCell(state.active, turnId, lane) : false;
  if (first < 0 && !activeMatches) return { state, replaced: false };

  if (first >= 0) {
    const without = state.finalized.filter((item) => !isStreamCell(item, turnId, lane));
    return {
      replaced: true,
      state: {
        ...state,
        finalized: [
          ...without.slice(0, first),
          finalized(cell),
          ...without.slice(first),
        ],
        active: activeMatches ? null : state.active,
      },
    };
  }

  return { replaced: true, state: { ...state, active: cell } };
}

function cellBase(event: ConversationEvent) {
  return {
    id: event.eventId,
    turnId: event.turnId,
    at: event.at,
    finalized: false,
  } as const;
}

function withoutCall(
  calls: TranscriptState['calls'],
  callId: string,
): TranscriptState['calls'] {
  const next = new Map(calls);
  next.delete(callId);
  return next;
}

function removeActiveItem(state: TranscriptState, callId: string): TranscriptState {
  if (state.active?.kind !== 'activity') return state;
  const items = state.active.items.filter((item) => item.callId !== callId);
  return {
    ...state,
    active: items.length > 0 ? { ...state.active, items } : null,
  };
}

function project(state: TranscriptState, event: ConversationEvent): TranscriptState {
  switch (event.kind) {
    case 'user.message':
      if (!event.text.trim()) return state;
      return beginCell(state, { ...cellBase(event), kind: 'user', text: event.text });

    case 'assistant.message': {
      let next = state;
      if (event.reasoning?.trim()) {
        const reasoning: TranscriptCell = {
          ...cellBase(event),
          id: `${event.eventId}:reasoning`,
          kind: 'reasoning',
          text: event.reasoning,
        };
        const replacement = replaceStreamLane(next, 'reasoning', event.turnId, reasoning);
        next = replacement.replaced ? replacement.state : beginCell(next, reasoning);
      }

      if (!event.text.trim()) return next;
      const assistant: TranscriptCell = {
        ...cellBase(event),
        kind: 'assistant',
        text: event.text,
        phase: event.phase,
      };
      const replacement = replaceStreamLane(next, 'assistant', event.turnId, assistant);
      return replacement.replaced ? replacement.state : beginCell(next, assistant);
    }

    case 'tool.started': {
      const calls = new Map(state.calls);
      calls.set(event.call.id, { turnId: event.turnId, name: event.call.name });
      const item: ActivityItem = {
        id: event.eventId,
        callId: event.call.id,
        name: event.call.name,
        status: 'running',
      };
      if (state.active?.kind === 'activity' && state.active.turnId === event.turnId) {
        return {
          ...state,
          calls,
          active: { ...state.active, items: [...state.active.items, item] },
        };
      }
      const settled = finalizeActive(state);
      return {
        ...settled,
        calls,
        active: {
          ...cellBase(event),
          kind: 'activity',
          items: [item],
          expanded: false,
        },
      };
    }

    case 'tool.completed': {
      const call = state.calls.get(event.callId);
      const name = call?.name ?? event.callId;
      const calls = withoutCall(state.calls, event.callId);

      if (!event.ok || event.diff) {
        let next = removeActiveItem({ ...state, calls }, event.callId);
        if (!event.ok) {
          return appendFinalized(next, {
            ...cellBase(event),
            kind: 'error',
            title: name,
            detail: event.output,
          });
        }
        return appendFinalized(next, {
          ...cellBase(event),
          kind: 'diff',
          title: name,
          diff: event.diff!,
        });
      }

      const doneItem: ActivityItem = {
        id: event.eventId,
        callId: event.callId,
        name,
        status: 'done',
        output: event.output,
        durationMs: event.durationMs,
      };
      if (state.active?.kind === 'activity' && state.active.turnId === event.turnId) {
        const found = state.active.items.some((item) => item.callId === event.callId);
        const items = found
          ? state.active.items.map((item) => item.callId === event.callId ? doneItem : item)
          : [...state.active.items, doneItem];
        return { ...state, calls, active: { ...state.active, items } };
      }
      return {
        ...state,
        calls,
        active: {
          ...cellBase(event),
          kind: 'activity',
          items: [doneItem],
          expanded: false,
        },
      };
    }

    case 'approval.requested':
      return beginCell(state, {
        ...cellBase(event),
        kind: 'approval',
        requestId: event.requestId,
        text: event.text,
      });

    case 'approval.resolved':
      if (state.active?.kind === 'approval' && state.active.requestId === event.requestId) {
        return appendFinalized(
          { ...state, active: null },
          { ...state.active, finalized: false, resolution: event.decision },
        );
      }
      return appendFinalized(state, {
        ...cellBase(event),
        kind: 'notice',
        tone: 'muted',
        text: `Approval ${event.requestId}: ${event.decision}`,
      });

    case 'question.requested':
      return beginCell(state, {
        ...cellBase(event),
        kind: 'question',
        requestId: event.requestId,
        text: event.text,
      });

    case 'question.resolved':
      if (state.active?.kind === 'question' && state.active.requestId === event.requestId) {
        return appendFinalized(
          { ...state, active: null },
          { ...state.active, finalized: false, answer: event.answer },
        );
      }
      return appendFinalized(state, {
        ...cellBase(event),
        kind: 'notice',
        tone: 'muted',
        text: `Question ${event.requestId} answered`,
      });

    case 'turn.completed':
      return finalizeActive(state);

    case 'turn.interrupted': {
      const settled = finalizeActive(state);
      return appendFinalized(settled, {
        ...cellBase(event),
        kind: 'notice',
        tone: 'warn',
        text: `Turn interrupted: ${event.reason}`,
      });
    }

    case 'turn.failed': {
      const settled = finalizeActive(state);
      return appendFinalized(settled, {
        ...cellBase(event),
        kind: 'notice',
        tone: 'danger',
        text: `Turn failed: ${event.reason}`,
      });
    }

    case 'notice.recorded':
      return appendFinalized(state, {
        ...cellBase(event),
        kind: 'notice',
        tone: event.level === 'error' ? 'danger' : event.level === 'warn' ? 'warn' : 'muted',
        text: event.text,
      });

    case 'compaction.completed':
      return appendFinalized(state, {
        ...cellBase(event),
        kind: 'notice',
        tone: 'muted',
        text: `Earlier context compacted (${event.replacedEvents} events)`,
      });

    case 'history.context':
      return appendFinalized(state, {
        ...cellBase(event),
        kind: 'notice',
        tone: 'muted',
        text: event.text,
      });

    case 'turn.started':
      return state;
  }
}

export function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction,
): TranscriptState {
  if (action.type === 'reset') return initialTranscriptState;
  if (action.type === 'stream.reset') {
    return {
      ...state,
      finalized: state.finalized.filter((cell) => !isStreamCell(cell, action.turnId)),
      active: state.active && isStreamCell(state.active, action.turnId) ? null : state.active,
    };
  }
  if (action.type === 'assistant.frame' || action.type === 'reasoning.frame') {
    if (!action.text) return state;
    const lane = action.type === 'assistant.frame' ? 'assistant' : 'reasoning';
    const id = streamCellId(lane, action.turnId, action.epoch);
    if (state.active?.id === id && state.active.kind === lane) {
      return {
        ...state,
        active: { ...state.active, text: action.text },
      };
    }
    const finalizedIndex = state.finalized.findIndex((cell) => cell.id === id && cell.kind === lane);
    if (finalizedIndex >= 0) {
      return {
        ...state,
        finalized: state.finalized.map((cell, index) =>
          index === finalizedIndex && (cell.kind === 'assistant' || cell.kind === 'reasoning')
            ? { ...cell, text: action.text }
            : cell,
        ),
      };
    }
    return beginCell(state, {
      id,
      turnId: action.turnId,
      at: action.at,
      finalized: false,
      text: action.text,
      ...(lane === 'assistant'
        ? { kind: 'assistant' as const, phase: 'final' as const }
        : { kind: 'reasoning' as const }),
    });
  }
  if (state.seenEventIds.has(action.event.eventId)) return state;

  const seenEventIds = new Set(state.seenEventIds);
  seenEventIds.add(action.event.eventId);
  return project({ ...state, seenEventIds }, action.event);
}

export function allTranscriptCells(state: TranscriptState): readonly TranscriptCell[] {
  return state.active ? [...state.finalized, state.active] : state.finalized;
}

export type {
  ActivityItem,
  TranscriptAction,
  TranscriptCell,
  TranscriptState,
} from './types.js';
