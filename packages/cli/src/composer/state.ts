import { snap, stepLeft, stepRight } from '../text.js';

export interface PastedText {
  readonly kind: 'text';
  readonly token: string;
  readonly text: string;
}

export interface PastedImage {
  readonly kind: 'image';
  readonly token: string;
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: number;
}

export type PastedAttachment = PastedText | PastedImage;

export interface QueuedComposerMessage {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly PastedAttachment[];
}

export interface ComposerSubmission {
  readonly text: string;
  readonly attachments: readonly PastedAttachment[];
}

export interface ComposerState {
  readonly draft: string;
  /** UTF-16 offset snapped to a complete grapheme boundary. */
  readonly cursor: number;
  readonly attachments: readonly PastedAttachment[];
  readonly queue: readonly QueuedComposerMessage[];
  readonly queuedSelection: number;
  readonly completion: {
    readonly items: readonly string[];
    readonly selected: number;
  } | null;
  readonly historySearch: {
    readonly query: string;
    readonly before: number;
    readonly match: string | null;
  } | null;
}

export type ComposerAction =
  | { readonly type: 'insert'; readonly text: string }
  | { readonly type: 'newline' }
  | { readonly type: 'move.left' }
  | { readonly type: 'move.right' }
  | { readonly type: 'move.home' }
  | { readonly type: 'move.end' }
  | { readonly type: 'cursor.set'; readonly cursor: number }
  | { readonly type: 'delete.backward' }
  | { readonly type: 'delete.forward' }
  | { readonly type: 'draft.set'; readonly text: string; readonly cursor?: number }
  | { readonly type: 'reset.draft' }
  | { readonly type: 'attachment.add'; readonly attachment: PastedAttachment }
  | { readonly type: 'attachment.remove'; readonly token: string }
  | { readonly type: 'attachments.set'; readonly attachments: readonly PastedAttachment[] }
  | { readonly type: 'queue.current'; readonly id: string }
  | { readonly type: 'queue.drop'; readonly id: string }
  | { readonly type: 'queue.select'; readonly index: number }
  | { readonly type: 'completion.set'; readonly items: readonly string[] }
  | { readonly type: 'completion.move'; readonly delta: -1 | 1 }
  | { readonly type: 'completion.select'; readonly index: number }
  | { readonly type: 'completion.clear' }
  | {
      readonly type: 'history.search';
      readonly query: string;
      readonly before: number;
      readonly match: string | null;
    }
  | { readonly type: 'history.clear' };

export const initialComposerState: ComposerState = {
  draft: '',
  cursor: 0,
  attachments: [],
  queue: [],
  queuedSelection: 0,
  completion: null,
  historySearch: null,
};

function insert(state: ComposerState, text: string): ComposerState {
  if (!text) return state;
  const draft = state.draft.slice(0, state.cursor) + text + state.draft.slice(state.cursor);
  return {
    ...state,
    draft,
    cursor: state.cursor + text.length,
    completion: null,
    historySearch: null,
  };
}

function clampSelection(index: number, length: number): number {
  return length === 0 ? 0 : Math.max(0, Math.min(index, length - 1));
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'insert':
      return insert(state, action.text);
    case 'newline':
      return insert(state, '\n');
    case 'move.left':
      return { ...state, cursor: stepLeft(state.draft, state.cursor) };
    case 'move.right':
      return { ...state, cursor: stepRight(state.draft, state.cursor) };
    case 'move.home':
      return { ...state, cursor: 0 };
    case 'move.end':
      return { ...state, cursor: state.draft.length };
    case 'cursor.set':
      return {
        ...state,
        cursor: snap(state.draft, Math.max(0, Math.min(action.cursor, state.draft.length))),
      };
    case 'delete.backward': {
      const from = stepLeft(state.draft, state.cursor);
      if (from === state.cursor) return state;
      return {
        ...state,
        draft: state.draft.slice(0, from) + state.draft.slice(state.cursor),
        cursor: from,
        completion: null,
        historySearch: null,
      };
    }
    case 'delete.forward': {
      const to = stepRight(state.draft, state.cursor);
      if (to === state.cursor) return state;
      return {
        ...state,
        draft: state.draft.slice(0, state.cursor) + state.draft.slice(to),
        completion: null,
        historySearch: null,
      };
    }
    case 'draft.set': {
      const cursor = snap(
        action.text,
        Math.max(0, Math.min(action.cursor ?? action.text.length, action.text.length)),
      );
      return { ...state, draft: action.text, cursor, completion: null, historySearch: null };
    }
    case 'reset.draft':
      return {
        ...state,
        draft: '',
        cursor: 0,
        attachments: [],
        completion: null,
        historySearch: null,
      };
    case 'attachment.add':
      return {
        ...state,
        attachments: [...state.attachments, action.attachment],
      };
    case 'attachment.remove':
      return {
        ...state,
        attachments: state.attachments.filter((item) => item.token !== action.token),
      };
    case 'attachments.set':
      return { ...state, attachments: [...action.attachments] };
    case 'queue.current': {
      const submission = submissionFromComposer(state);
      if (!submission) return state;
      return {
        ...state,
        queue: [...state.queue, { id: action.id, ...submission }],
        queuedSelection: state.queue.length,
      };
    }
    case 'queue.drop': {
      const queue = state.queue.filter((item) => item.id !== action.id);
      return {
        ...state,
        queue,
        queuedSelection: clampSelection(state.queuedSelection, queue.length),
      };
    }
    case 'queue.select':
      return {
        ...state,
        queuedSelection: clampSelection(action.index, state.queue.length),
      };
    case 'completion.set':
      return {
        ...state,
        completion: action.items.length > 0 ? { items: [...action.items], selected: 0 } : null,
      };
    case 'completion.move': {
      if (!state.completion) return state;
      return {
        ...state,
        completion: {
          ...state.completion,
          selected: clampSelection(
            state.completion.selected + action.delta,
            state.completion.items.length,
          ),
        },
      };
    }
    case 'completion.select':
      if (!state.completion) {
        return { ...state, completion: { items: [], selected: Math.max(0, action.index) } };
      }
      return {
        ...state,
        completion: {
          ...state.completion,
          selected: state.completion.items.length > 0
            ? clampSelection(action.index, state.completion.items.length)
            : Math.max(0, action.index),
        },
      };
    case 'completion.clear':
      return { ...state, completion: null };
    case 'history.search':
      return {
        ...state,
        historySearch: {
          query: action.query,
          before: action.before,
          match: action.match,
        },
      };
    case 'history.clear':
      return { ...state, historySearch: null };
  }
}

export function submissionFromComposer(state: ComposerState): ComposerSubmission | null {
  const text = state.draft.trim();
  if (!text && state.attachments.length === 0) return null;
  return { text, attachments: [...state.attachments] };
}
