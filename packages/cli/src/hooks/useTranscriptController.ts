import { randomUUID } from 'node:crypto';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import {
  eventBase,
  recoverInterruptedTurns,
} from '@plif/core';
import type {
  ConversationEvent,
  Engine,
  Session,
} from '@plif/core';
import {
  initialTranscriptState,
  transcriptReducer,
} from '../transcript/reducer.js';
import type { TranscriptState } from '../transcript/types.js';
import type { StreamFrame } from '../stream-frame.js';
import { TranscriptPersistenceQueue } from '../transcript/persistence.js';

export interface TranscriptControllerOptions {
  readonly engine: Engine;
  readonly workspace: string;
  readonly session: Session | null;
  readonly replay: readonly ConversationEvent[];
}

export interface TranscriptController {
  readonly state: TranscriptState;
  readonly session: Session | null;
  readonly persistenceWarning: string | null;
  readonly appendUserTurn: (text: string) => string;
  readonly persist: (event: ConversationEvent) => Promise<void>;
  readonly flushPersistence: () => Promise<void>;
  /** Resolve the session after queued transcript writes have settled. */
  readonly resolveSession: () => Promise<Session | null>;
  readonly applyStreamFrame: (frame: StreamFrame) => void;
  readonly resetStream: () => void;
  readonly finishTurn: (turnId: string) => void;
  /** Move the live transcript pointer without remounting the Ink app. */
  readonly switchSession: (session: Session, replay: readonly ConversationEvent[]) => void;
}

function seedTranscript(events: readonly ConversationEvent[]): TranscriptState {
  return recoverInterruptedTurns(events).reduce(
    (state, event) => transcriptReducer(state, { type: 'event', event }),
    initialTranscriptState,
  );
}

export function useTranscriptController({
  engine,
  workspace,
  session,
  replay,
}: TranscriptControllerOptions): TranscriptController {
  const [state, dispatch] = useReducer(transcriptReducer, replay, seedTranscript);
  const [liveSession, setLiveSession] = useState<Session | null>(session);
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  const persistenceFailed = useRef(false);
  const persisted = useRef(new Set(replay.map((event) => event.eventId)));
  const currentTurnId = useRef<string | null>(null);
  const durableTurns = useRef(new Map<string, number | null>());
  const frameEpochs = useRef(new Map<string, number>());

  const persistence = useRef<TranscriptPersistenceQueue | null>(null);
  persistence.current ??= new TranscriptPersistenceQueue({
    initialSession: session,
    createSession: () => engine.sessions.create(workspace),
    onSession: (created) => {
      setLiveSession(created);
    },
    onFailure: (error: unknown) => {
      persistenceFailed.current = true;
      setPersistenceWarning(
        `Conversation will continue in memory; transcript persistence failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });

  const persist = useCallback((event: ConversationEvent): Promise<void> => {
    if (persisted.current.has(event.eventId)) return Promise.resolve();
    persisted.current.add(event.eventId);
    dispatch({ type: 'event', event });
    if (persistenceFailed.current) return Promise.resolve();
    return persistence.current?.enqueue(event) ?? Promise.resolve();
  }, []);

  const appendUserTurn = useCallback((text: string): string => {
    const turnId = randomUUID();
    currentTurnId.current = turnId;
    const userEvent: ConversationEvent = {
      ...eventBase('user.message', turnId),
      text,
    };
    persist(userEvent);
    persist({
      ...eventBase('turn.started', turnId),
      userEventId: userEvent.eventId,
    });
    return turnId;
  }, [persist]);

  useEffect(() => engine.bus.on('conversation.event', (event) => {
    if (event.kind === 'assistant.message') {
      durableTurns.current.set(event.turnId, frameEpochs.current.get(event.turnId) ?? null);
    }
    persist(event);
  }), [engine, persist]);

  const applyStreamFrame = useCallback((frame: StreamFrame): void => {
    const turnId = currentTurnId.current;
    if (!turnId || frame.kind === 'reset') return;
    // The durable assistant event is emitted before the loop's terminal event.
    // Its text is already authoritative, so a completion frame arriving after
    // that boundary must not create a second ephemeral assistant cell. A new
    // data frame means a later tool cycle has started and may stream normally.
    if (frame.kind === 'data') {
      const durableEpoch = durableTurns.current.get(turnId);
      const previousEpoch = frameEpochs.current.get(turnId);
      if (durableEpoch === null) {
        durableTurns.current.set(turnId, frame.epoch);
      } else if (
        durableEpoch !== undefined &&
        previousEpoch !== undefined &&
        frame.epoch !== durableEpoch
      ) {
        durableTurns.current.delete(turnId);
      }
      frameEpochs.current.set(turnId, frame.epoch);
    } else if (
      (frame.kind === 'complete' || frame.kind === 'dispose') &&
      durableTurns.current.has(turnId) &&
      (durableTurns.current.get(turnId) === null || durableTurns.current.get(turnId) === frame.epoch)
    ) {
      return;
    }
    const at = new Date().toISOString();
    if (frame.reasoning) {
      dispatch({
        type: 'reasoning.frame',
        turnId,
        at,
        epoch: frame.epoch,
        text: frame.reasoning,
      });
    }
    if (frame.answer) {
      dispatch({
        type: 'assistant.frame',
        turnId,
        at,
        epoch: frame.epoch,
        text: frame.answer,
      });
    }
  }, []);

  const resetStream = useCallback((): void => {
    const turnId = currentTurnId.current;
    if (turnId) dispatch({ type: 'stream.reset', turnId });
  }, []);

  const finishTurn = useCallback((turnId: string): void => {
    durableTurns.current.delete(turnId);
    frameEpochs.current.delete(turnId);
    if (currentTurnId.current === turnId) currentTurnId.current = null;
  }, []);

  const flushPersistence = useCallback((): Promise<void> => {
    return persistence.current?.flush() ?? Promise.resolve();
  }, []);

  const resolveSession = useCallback(async (): Promise<Session | null> => {
    if (!persistence.current) return liveSession;
    await persistence.current.flush();
    return persistence.current.session();
  }, [liveSession]);

  const switchSession = useCallback((nextSession: Session, nextReplay: readonly ConversationEvent[]): void => {
    persistence.current?.setSession(nextSession);
    persisted.current = new Set(nextReplay.map((event) => event.eventId));
    durableTurns.current.clear();
    frameEpochs.current.clear();
    currentTurnId.current = null;
    persistenceFailed.current = false;
    setPersistenceWarning(null);
    setLiveSession(nextSession);
    dispatch({ type: 'replace', events: [...nextReplay] });
  }, []);

  useEffect(() => {
    const turnFor = (requestId: string): string => currentTurnId.current ?? `dialog:${requestId}`;
    return engine.bus.on('approval.request', (request) => {
      persist({
        ...eventBase('approval.requested', turnFor(request.id)),
        requestId: request.id,
        text: `${request.action} ${request.target}: ${request.reason}`,
      });
    });
  }, [engine, persist]);

  useEffect(() => engine.bus.on('approval.response', (response) => {
    persist({
      ...eventBase('approval.resolved', currentTurnId.current ?? `dialog:${response.id}`),
      requestId: response.id,
      decision: response.decision,
    });
  }), [engine, persist]);

  useEffect(() => engine.bus.on('question.asked', (question) => {
    persist({
      ...eventBase('question.requested', currentTurnId.current ?? `dialog:${question.id}`),
      requestId: question.id,
      text: question.text,
    });
  }), [engine, persist]);

  useEffect(() => engine.bus.on('question.answered', (answer) => {
    persist({
      ...eventBase('question.resolved', currentTurnId.current ?? `dialog:${answer.id}`),
      requestId: answer.id,
      answer: answer.redacted ? '[redacted]' : answer.answer ?? '[no answer]',
    });
  }), [engine, persist]);

  useEffect(() => {
    const replayIds = new Set(replay.map((event) => event.eventId));
    for (const event of recoverInterruptedTurns(replay)) {
      if (!replayIds.has(event.eventId)) persist(event);
    }
  }, [persist, replay]);

  return {
    state,
    session: liveSession,
    persistenceWarning,
    appendUserTurn,
    persist,
    flushPersistence,
    resolveSession,
    applyStreamFrame,
    resetStream,
    finishTurn,
    switchSession,
  };
}
