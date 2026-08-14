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
  readonly persist: (event: ConversationEvent) => void;
  readonly applyStreamFrame: (frame: StreamFrame) => void;
  readonly resetStream: () => void;
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
  const sessionRef = useRef<Session | null>(session);
  const sessionCreate = useRef<Promise<Session> | null>(session ? Promise.resolve(session) : null);
  const persistenceFailed = useRef(false);
  const persisted = useRef(new Set(replay.map((event) => event.eventId)));
  const currentTurnId = useRef<string | null>(null);

  const persist = useCallback((event: ConversationEvent): void => {
    if (persisted.current.has(event.eventId)) return;
    persisted.current.add(event.eventId);
    dispatch({ type: 'event', event });
    if (persistenceFailed.current) return;

    sessionCreate.current ??= engine.sessions.create(workspace);
    void sessionCreate.current
      .then(async (created) => {
        sessionRef.current = created;
        setLiveSession(created);
        await created.append(event);
      })
      .catch((error: unknown) => {
        persistenceFailed.current = true;
        setPersistenceWarning(
          `Conversation will continue in memory; transcript persistence failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }, [engine, workspace]);

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
    persist(event);
    if (
      event.turnId === currentTurnId.current &&
      (event.kind === 'turn.completed' ||
        event.kind === 'turn.interrupted' ||
        event.kind === 'turn.failed')
    ) {
      currentTurnId.current = null;
    }
  }), [engine, persist]);

  const applyStreamFrame = useCallback((frame: StreamFrame): void => {
    const turnId = currentTurnId.current;
    if (!turnId || frame.kind === 'reset') return;
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
    applyStreamFrame,
    resetStream,
  };
}
