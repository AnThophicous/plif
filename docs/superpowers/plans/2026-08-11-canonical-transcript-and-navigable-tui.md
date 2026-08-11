# Canonical Transcript and Navigable TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Plif one canonical conversation history, a compact Codex-inspired activity model, an independent Ink composer, and a `Ctrl+T` navigable transcript while preserving native scrollback and the current Plif input identity.

**Architecture:** Versioned conversation events live in `@plif/core` and are the durable source of truth. A CLI transcript reducer projects those events into finalized cells plus one mutable active cell; the normal timeline and full-screen transcript consume the same projection. Composer state, transcript navigation, persistence, and event wiring move out of the 3,000-line application component behind typed controllers.

**Tech Stack:** TypeScript 5.7, Node.js 20.11+, React 18, Ink 5, Node test runner, append-only JSONL.

## Global Constraints

- Keep Ink; do not port the TUI to Rust, Ratatui, or a custom renderer.
- Preserve the existing Plif input visual identity, focus frame, prompt marker, theme family, and Plif dock.
- Preserve native terminal scrollback in the normal interface.
- Do not overwrite or discard the repository's existing uncommitted changes.
- Existing session JSONL files must remain resumable without destructive migration.
- Keep core free of React and Ink imports.
- Persist semantic event boundaries, not streaming token deltas.
- Routine activity may coalesce; diffs, failures, approvals, questions, and important results remain dedicated cells.
- Node.js support remains `>=20.11`.

---

## File Structure

### Core conversation and persistence

- Create `packages/core/src/session/events.ts`: canonical event types, event factories, v1 decoder, duplicate filtering, interrupted-turn recovery, and legacy record adapter.
- Modify `packages/core/src/session/store.ts`: append/read canonical events while retaining the existing metadata and truncated-line recovery behavior.
- Modify `packages/core/src/session/resume.ts`: reconstruct protocol-correct `Message[]` from canonical assistant tool calls and tool results.
- Modify `packages/core/src/events/bus.ts`: expose a typed `conversation.event` channel for durable harness events.
- Modify `packages/core/src/harness/loop.ts`: emit assistant/tool/turn terminal events at semantic boundaries.
- Modify `packages/core/src/index.ts`: export the canonical event API.
- Create `packages/core/test/session-events.test.ts`: decoding, legacy compatibility, idempotency, interruption, and malformed-line coverage.
- Modify `packages/core/test/resume.test.ts`: replace the legacy tool-flattening expectations with protocol-correct round-trip expectations.

### CLI transcript and composer

- Create `packages/cli/src/transcript/types.ts`: projected cell, activity item, and transcript state types.
- Create `packages/cli/src/transcript/reducer.ts`: canonical event projection, active-cell lifecycle, activity coalescing, and finalization.
- Create `packages/cli/src/transcript/scroll.ts`: overlay viewport/follow reducer and resize clamping.
- Create `packages/cli/src/composer/state.ts`: draft, cursor, multiline, queue, completion, and key-action reducer.
- Create `packages/cli/src/composer/history.ts`: local recall, reverse search, and optional persistent-history lookup boundary.
- Create `packages/cli/src/hooks/useTranscriptController.ts`: event-bus subscription, reducer dispatch, persistence, and bounded persistence warning.
- Create `packages/cli/src/live-status.ts`: pure global-busy priority and labels.
- Create `packages/cli/src/components/TranscriptOverlay.tsx`: full-height transcript rendering and navigation hints.
- Create `packages/cli/src/components/SessionHeader.tsx`: compact session-opening cell.
- Modify `packages/cli/src/components/Timeline.tsx`: render projected cells and compact activity groups while retaining existing user/assistant visuals.
- Modify `packages/cli/src/components/Prompt.tsx`: consume composer and derived live status without changing the focus-frame identity.
- Modify `packages/cli/src/components/Footer.tsx`: prioritize transcript, interrupt, queue, and history hints by width.
- Modify `packages/cli/src/session.ts`: remove transcript ownership after the compatibility bridge is complete; keep dialog, browser, task, and subagent UI state.
- Modify `packages/cli/src/app.tsx`: become the application shell and route keys/events through the new controllers.
- Create `packages/cli/test/transcript.test.ts`, `packages/cli/test/transcript-scroll.test.ts`, and `packages/cli/test/composer.test.ts`.
- Modify `packages/cli/test/frame.test.ts`, `packages/cli/test/follow.test.ts`, and `packages/cli/test/prompt.test.ts` for the new boundaries.

---

### Task 1: Define and decode canonical conversation events

**Files:**
- Create: `packages/core/src/session/events.ts`
- Create: `packages/core/test/session-events.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `ConversationEvent`, `ConversationEventV1`, `LegacyTranscriptEvent`, `decodeConversationEvent(value)`, `adaptLegacyTranscriptEvent(value, context)`, `dedupeConversationEvents(events)`, `recoverInterruptedTurns(events, at)`, and `eventBase(kind, turnId, at?)`.
- Consumes: `Attachment`, `ToolCall`, and `Message` shapes from `packages/core/src/model/provider.ts` only where provider reconstruction needs them; persisted user events remain text-first.

- [ ] **Step 1: Write decoder and compatibility tests**

Create `packages/core/test/session-events.test.ts` with concrete fixtures:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adaptLegacyTranscriptEvent,
  decodeConversationEvent,
  dedupeConversationEvents,
  recoverInterruptedTurns,
} from '../src/session/events.js';

const at = '2026-08-11T12:00:00.000Z';

describe('canonical conversation events', () => {
  it('decodes a versioned assistant message with tool calls', () => {
    const decoded = decodeConversationEvent({
      version: 1,
      eventId: 'evt-1',
      turnId: 'turn-1',
      at,
      kind: 'assistant.message',
      phase: 'commentary',
      text: 'vou verificar',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a.ts"}' }],
    });
    assert.equal(decoded?.kind, 'assistant.message');
    assert.equal(decoded?.turnId, 'turn-1');
  });

  it('rejects malformed records without throwing', () => {
    assert.equal(decodeConversationEvent({ version: 1, kind: 'assistant.message' }), null);
    assert.equal(decodeConversationEvent('not-an-object'), null);
  });

  it('adapts a legacy assistant record without changing its role', () => {
    const event = adaptLegacyTranscriptEvent(
      { kind: 'assistant', at, text: 'feito' },
      { turnId: 'legacy-turn-1', nextEventId: () => 'legacy-1' },
    );
    assert.equal(event?.kind, 'assistant.message');
    assert.equal(event && 'phase' in event ? event.phase : null, 'final');
  });

  it('is idempotent by event id', () => {
    const event = decodeConversationEvent({
      version: 1, eventId: 'same', turnId: 't', at,
      kind: 'user.message', text: 'oi',
    })!;
    assert.deepEqual(dedupeConversationEvents([event, event]), [event]);
  });

  it('recovers one unfinished turn exactly once', () => {
    const events = [
      { version: 1, eventId: 'u', turnId: 't', at, kind: 'user.message', text: 'rode' },
      { version: 1, eventId: 's', turnId: 't', at, kind: 'turn.started', userEventId: 'u' },
    ] as const;
    const recovered = recoverInterruptedTurns(events, '2026-08-11T12:01:00.000Z');
    assert.deepEqual(recovered.map((event) => event.kind), [
      'user.message', 'turn.started', 'turn.interrupted',
    ]);
    assert.equal(recoverInterruptedTurns(recovered, at).length, recovered.length);
  });
});
```

- [ ] **Step 2: Run the new test and verify the module is missing**

Run:

```powershell
node --import tsx --test packages/core/test/session-events.test.ts
```

Expected: FAIL because `src/session/events.ts` does not exist.

- [ ] **Step 3: Implement the v1 event union and safe decoder**

Create these exact public shapes in `packages/core/src/session/events.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { ToolCall } from '../model/provider.js';

interface EventBase<K extends string> {
  readonly version: 1;
  readonly eventId: string;
  readonly turnId: string;
  readonly at: string;
  readonly kind: K;
}

export type ConversationEventV1 =
  | (EventBase<'turn.started'> & { readonly userEventId: string })
  | (EventBase<'turn.completed'> & { readonly durationMs: number })
  | (EventBase<'turn.interrupted'> & { readonly reason: string })
  | (EventBase<'turn.failed'> & { readonly reason: string })
  | (EventBase<'user.message'> & { readonly text: string })
  | (EventBase<'assistant.message'> & {
      readonly phase: 'commentary' | 'final';
      readonly text: string;
      readonly reasoning?: string;
      readonly toolCalls?: readonly ToolCall[];
    })
  | (EventBase<'tool.started'> & { readonly call: ToolCall })
  | (EventBase<'tool.completed'> & {
      readonly callId: string;
      readonly output: string;
      readonly ok: boolean;
      readonly durationMs: number;
      readonly diff?: string;
    })
  | (EventBase<'approval.requested'> & { readonly requestId: string; readonly text: string })
  | (EventBase<'approval.resolved'> & { readonly requestId: string; readonly decision: string })
  | (EventBase<'question.requested'> & { readonly requestId: string; readonly text: string })
  | (EventBase<'question.resolved'> & { readonly requestId: string; readonly answer: string })
  | (EventBase<'compaction.completed'> & {
      readonly summary: string;
      readonly replacedEvents: number;
    })
  | (EventBase<'history.context'> & { readonly text: string })
  | (EventBase<'notice.recorded'> & {
      readonly level: 'info' | 'warn' | 'error';
      readonly text: string;
    });

export type ConversationEvent = ConversationEventV1;

export type LegacyTranscriptEvent =
  | { readonly kind: 'user'; readonly at: string; readonly text: string }
  | { readonly kind: 'assistant'; readonly at: string; readonly text: string }
  | { readonly kind: 'tool'; readonly at: string; readonly tool: string; readonly input: Record<string, unknown>; readonly output: string; readonly ok: boolean; readonly durationMs: number }
  | { readonly kind: 'note'; readonly at: string; readonly text: string; readonly level: 'info' | 'warn' | 'error' }
  | { readonly kind: 'compaction'; readonly at: string; readonly summary: string; readonly replacedEvents: number };

export function eventBase<K extends ConversationEvent['kind']>(kind: K, turnId: string, at = new Date().toISOString()) {
  return { version: 1 as const, eventId: randomUUID(), turnId, at, kind };
}
```

Implement the decoder with explicit object/string/number/boolean checks and exact per-kind validation. Return `null` for malformed or unknown records. Implement legacy adaptation deterministically with the supplied `nextEventId`; legacy tool records become `history.context` events whose text starts with `[historical tool activity]` because they lack a trustworthy assistant tool-call envelope.

`recoverInterruptedTurns` scans per `turnId`; when a `turn.started` lacks any of `turn.completed`, `turn.interrupted`, or `turn.failed`, append one deterministic `turn.interrupted` event with reason `previous process ended before the turn completed`. Calling it again must not add another terminal event.

- [ ] **Step 4: Export the event API and run focused tests**

Modify `packages/core/src/index.ts` to export the new functions and types, then run:

```powershell
node --import tsx --test packages/core/test/session-events.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the canonical event contract**

```powershell
git add packages/core/src/session/events.ts packages/core/test/session-events.test.ts packages/core/src/index.ts
git commit -m "feat(core): add canonical conversation events"
```

---

### Task 2: Persist canonical events and reconstruct provider history correctly

**Files:**
- Modify: `packages/core/src/session/store.ts`
- Modify: `packages/core/src/session/resume.ts`
- Modify: `packages/core/test/resume.test.ts`
- Create: `packages/core/test/session-store-events.test.ts`

**Interfaces:**
- Consumes: `ConversationEvent`, `decodeConversationEvent`, and `adaptLegacyTranscriptEvent` from Task 1.
- Produces: `Session.append(event: ConversationEvent)`, `SessionStore.transcript(session) -> AsyncGenerator<ConversationEvent>`, `SessionStore.replay(session) -> Promise<ConversationEvent[]>`, and `conversationFromTranscript(events) -> Message[]`.

- [ ] **Step 1: Replace legacy flattening tests with protocol-correct expectations**

In `packages/core/test/resume.test.ts`, add canonical events and assert exact provider roles:

```ts
it('restores an assistant tool call followed by its tool result', () => {
  const events: ConversationEvent[] = [
    { version: 1, eventId: 'u', turnId: 't', at, kind: 'user.message', text: 'leia a.ts' },
    {
      version: 1, eventId: 'a', turnId: 't', at, kind: 'assistant.message',
      phase: 'commentary', text: 'vou ler',
      toolCalls: [{ id: 'c', name: 'read_file', arguments: '{"path":"a.ts"}' }],
    },
    {
      version: 1, eventId: 's', turnId: 't', at, kind: 'tool.started',
      call: { id: 'c', name: 'read_file', arguments: '{"path":"a.ts"}' },
    },
    {
      version: 1, eventId: 'r', turnId: 't', at, kind: 'tool.completed',
      callId: 'c', output: 'conteúdo', ok: true, durationMs: 4,
    },
  ];

  assert.deepEqual(conversationFromTranscript(events), [
    { role: 'user', content: 'leia a.ts' },
    {
      role: 'assistant', content: 'vou ler',
      toolCalls: [{ id: 'c', name: 'read_file', arguments: '{"path":"a.ts"}' }],
    },
    { role: 'tool', content: 'conteúdo', toolCallId: 'c' },
  ]);
});

it('does not emit an orphaned tool result as a tool-role message', () => {
  const events: ConversationEvent[] = [{
    version: 1, eventId: 'r', turnId: 't', at, kind: 'tool.completed',
    callId: 'missing', output: 'x', ok: false, durationMs: 1,
  }];
  assert.deepEqual(conversationFromTranscript(events), []);
});
```

- [ ] **Step 2: Add store tests for mixed legacy/v1 JSONL and truncation**

Create `packages/core/test/session-store-events.test.ts` with a real temporary store:

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { SessionStore, workspaceKey } from '../src/session/store.js';
import { StorePaths } from '../src/store/paths.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe('versioned session event storage', () => {
  it('reads legacy and v1 lines and ignores a truncated final line', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plif-session-events-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const store = new SessionStore(new StorePaths(root));
    const session = await store.create(workspace);
    const transcript = path.join(root, 'sessions', workspaceKey(workspace), `${session.id}.jsonl`);
    await fs.writeFile(transcript, [
      JSON.stringify({ kind: 'assistant', at: '2026-08-11T12:00:00.000Z', text: 'feito' }),
      JSON.stringify({
        version: 1, eventId: 'u1', turnId: 't1', at: '2026-08-11T12:00:01.000Z',
        kind: 'user.message', text: 'continue',
      }),
      '{"version":1,"eventId":',
    ].join('\n'), 'utf8');

    const replay = await session.replay();
    assert.deepEqual(replay.map((event) => event.kind), ['assistant.message', 'user.message']);
    assert.equal(new Set(replay.map((event) => event.eventId)).size, 2);
  });
});
```

- [ ] **Step 3: Run focused tests and confirm old behavior fails**

```powershell
node --import tsx --test packages/core/test/resume.test.ts packages/core/test/session-store-events.test.ts
```

Expected: FAIL because the store and resume projector still consume `TranscriptEvent` and flatten tools into assistant prose.

- [ ] **Step 4: Upgrade the append-only store without rewriting existing files**

Keep `SessionMeta` and workspace scoping intact. Change new appends to serialize `ConversationEvent`. During reads:

1. parse each line independently;
2. call `decodeConversationEvent` first;
3. otherwise call `adaptLegacyTranscriptEvent` with a deterministic turn cursor;
4. ignore a malformed final line;
5. surface a bounded warning record for malformed non-final lines;
6. deduplicate by `eventId` before replay.

Do not rewrite legacy transcript files on open.

- [ ] **Step 5: Implement protocol reconstruction**

In `packages/core/src/session/resume.ts`, build `Message[]` as follows:

```ts
case 'user.message':
  messages.push({ role: 'user', content: event.text });
  break;
case 'assistant.message':
  messages.push({
    role: 'assistant',
    content: event.text,
    ...(event.reasoning ? { reasoning: event.reasoning } : {}),
    ...(event.toolCalls?.length ? { toolCalls: event.toolCalls } : {}),
  });
  for (const call of event.toolCalls ?? []) knownCalls.add(call.id);
  break;
case 'tool.completed':
  if (knownCalls.has(event.callId)) {
    messages.push({ role: 'tool', content: clip(event.output, limit), toolCallId: event.callId });
  }
  break;
case 'compaction.completed':
  messages.push({ role: 'user', content: `[earlier turns, summarised]\n${event.summary}` });
  break;
case 'history.context':
  messages.push({ role: 'user', content: event.text });
  break;
```

Ignore presentation-only lifecycle events. Preserve `reasoning` and `toolCalls` exactly enough for DeepSeek/OpenAI-compatible follow-up requirements.

- [ ] **Step 6: Run focused and core tests**

```powershell
node --import tsx --test packages/core/test/session-events.test.ts packages/core/test/session-store-events.test.ts packages/core/test/resume.test.ts packages/core/test/harness.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit persistence and resume semantics**

```powershell
git add packages/core/src/session/store.ts packages/core/src/session/resume.ts packages/core/test/resume.test.ts packages/core/test/session-store-events.test.ts
git commit -m "feat(core): persist protocol-correct conversation history"
```

---

### Task 3: Emit durable semantic events from the harness

**Files:**
- Modify: `packages/core/src/events/bus.ts`
- Modify: `packages/core/src/harness/loop.ts`
- Modify: `packages/core/test/queue.test.ts`
- Create: `packages/core/test/conversation-events.test.ts`

**Interfaces:**
- Consumes: `ConversationEvent` and `eventBase` from Task 1.
- Produces: `EventMap['conversation.event'] = ConversationEvent` and `LoopOptions.turnId?: string`.

- [ ] **Step 1: Add a harness event-sequence test**

Create `packages/core/test/conversation-events.test.ts` with the existing scripted provider/test tool helpers. Subscribe to `conversation.event`, run one user turn that requests `read_file`, and assert this order:

```ts
assert.deepEqual(events.map((event) => event.kind), [
  'assistant.message',
  'tool.started',
  'tool.completed',
  'assistant.message',
  'turn.completed',
]);
assert.equal(new Set(events.map((event) => event.turnId)).size, 1);
assert.equal(events.find((event) => event.kind === 'tool.started')?.call.id, 'call-1');
```

Add a cancellation case expecting `turn.interrupted`, and a permanent provider failure case expecting `turn.failed`.

- [ ] **Step 2: Run the test and verify no durable channel exists**

```powershell
node --import tsx --test packages/core/test/conversation-events.test.ts
```

Expected: FAIL because `conversation.event` and `turnId` are not defined.

- [ ] **Step 3: Add the typed bus channel and turn identity**

Add this event to the event map in `packages/core/src/events/bus.ts`:

```ts
'conversation.event': ConversationEvent;
```

Add `readonly turnId?: string` to `LoopOptions`. At loop start use `options.turnId ?? randomUUID()` and reuse it for every durable event in that run.

- [ ] **Step 4: Emit only semantic boundaries**

After the provider stream has assembled an assistant message, emit one `assistant.message` carrying text, reasoning, and safe tool calls. Emit `tool.started` immediately before executing each prepared call and `tool.completed` after it settles. Emit exactly one terminal event in the loop's exit path: completed, interrupted, or failed.

Keep `agent.text`, `agent.reasoning`, `agent.tool`, and other existing events as ephemeral presentation/progress channels during the migration. Do not emit `conversation.event` for each text delta.

- [ ] **Step 5: Verify event order, queue injection, and cancellation**

```powershell
node --import tsx --test packages/core/test/conversation-events.test.ts packages/core/test/queue.test.ts packages/core/test/retry.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit harness semantic events**

```powershell
git add packages/core/src/events/bus.ts packages/core/src/harness/loop.ts packages/core/test/conversation-events.test.ts packages/core/test/queue.test.ts
git commit -m "feat(core): emit durable conversation events"
```

---

### Task 4: Build the transcript projector and compact activity lifecycle

**Files:**
- Create: `packages/cli/src/transcript/types.ts`
- Create: `packages/cli/src/transcript/reducer.ts`
- Create: `packages/cli/test/transcript.test.ts`

**Interfaces:**
- Consumes: `ConversationEvent` from `@plif/core`.
- Produces: `TranscriptCell`, `ActivityItem`, `TranscriptState`, `initialTranscriptState`, `TranscriptAction`, `transcriptReducer(state, action)`, `allTranscriptCells(state)`.

- [ ] **Step 1: Write reducer tests for semantic cells and coalescing**

Create `packages/cli/test/transcript.test.ts` with event helpers and these assertions:

```ts
it('keeps user and assistant messages semantically distinct', () => {
  let state = transcriptReducer(initialTranscriptState, { type: 'event', event: user('u', 't', 'faça') });
  state = transcriptReducer(state, { type: 'event', event: assistant('a', 't', 'feito', 'final') });
  assert.deepEqual(allTranscriptCells(state).map((cell) => cell.kind), ['user', 'assistant']);
});

it('coalesces routine tools within one turn', () => {
  let state = initialTranscriptState;
  state = transcriptReducer(state, { type: 'event', event: toolStarted('s1', 't', 'c1', 'read_file') });
  state = transcriptReducer(state, { type: 'event', event: toolCompleted('r1', 't', 'c1', true) });
  state = transcriptReducer(state, { type: 'event', event: toolStarted('s2', 't', 'c2', 'list_dir') });
  assert.equal(state.active?.kind, 'activity');
  assert.equal(state.active?.kind === 'activity' ? state.active.items.length : 0, 2);
});

it('promotes failed tools and diffs to dedicated cells', () => {
  let state = initialTranscriptState;
  state = transcriptReducer(state, {
    type: 'event',
    event: toolStarted('s1', 't', 'c1', 'run_command'),
  });
  state = transcriptReducer(state, {
    type: 'event',
    event: {
      version: 1, eventId: 'r1', turnId: 't', at,
      kind: 'tool.completed', callId: 'c1', output: 'exit 1', ok: false, durationMs: 5,
    },
  });
  state = transcriptReducer(state, {
    type: 'event',
    event: toolStarted('s2', 't', 'c2', 'apply_patch'),
  });
  state = transcriptReducer(state, {
    type: 'event',
    event: {
      version: 1, eventId: 'r2', turnId: 't', at,
      kind: 'tool.completed', callId: 'c2', output: 'patched', ok: true, durationMs: 3,
      diff: '@@ -1 +1 @@\n-old\n+new',
    },
  });
  assert.deepEqual(allTranscriptCells(state).map((cell) => cell.kind), ['error', 'diff']);
});

it('does not duplicate an event id during replay', () => {
  const event = user('same', 't', 'oi');
  const once = transcriptReducer(initialTranscriptState, { type: 'event', event });
  const twice = transcriptReducer(once, { type: 'event', event });
  assert.deepEqual(twice, once);
});
```

- [ ] **Step 2: Run the test and verify the projector is missing**

```powershell
node --import tsx --test packages/cli/test/transcript.test.ts
```

Expected: FAIL because the transcript modules do not exist.

- [ ] **Step 3: Define projected cell types**

Use a discriminated union with shared `id`, `turnId`, `at`, and `finalized` fields:

```ts
export type TranscriptCell =
  | (CellBase<'user'> & { readonly text: string })
  | (CellBase<'assistant'> & { readonly text: string; readonly phase: 'commentary' | 'final' })
  | (CellBase<'activity'> & { readonly items: readonly ActivityItem[]; readonly expanded: boolean })
  | (CellBase<'diff'> & { readonly title: string; readonly diff: string })
  | (CellBase<'error'> & { readonly title: string; readonly detail: string })
  | (CellBase<'approval'> & { readonly requestId: string; readonly text: string; readonly resolution?: string })
  | (CellBase<'question'> & { readonly requestId: string; readonly text: string; readonly answer?: string })
  | (CellBase<'notice'> & { readonly tone: 'muted' | 'warn' | 'danger'; readonly text: string });

export interface TranscriptState {
  readonly finalized: readonly TranscriptCell[];
  readonly active: TranscriptCell | null;
  readonly seenEventIds: ReadonlySet<string>;
  readonly calls: ReadonlyMap<string, { readonly turnId: string; readonly name: string }>;
}
```

- [ ] **Step 4: Implement deterministic projection**

The reducer must:

1. ignore duplicate event IDs;
2. finalize an active assistant cell before starting activity;
3. append routine tool lifecycle updates to one active activity cell per turn;
4. remove a failed item from routine activity and create a dedicated error cell;
5. finalize the active cell on turn completion/interruption/failure;
6. create one interruption/failure notice at the turn boundary;
7. keep finalized cells immutable.

For the initial implementation, classify `apply_patch`, `write_file`, and `edit_file` as dedicated edit activity when a diff is present; approvals/questions are always dedicated.

- [ ] **Step 5: Run projector and type tests**

```powershell
node --import tsx --test packages/cli/test/transcript.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the transcript projector**

```powershell
git add packages/cli/src/transcript packages/cli/test/transcript.test.ts
git commit -m "feat(cli): add canonical transcript projector"
```

---

### Task 5: Extract composer editing, recall, search, and queue state

**Files:**
- Create: `packages/cli/src/composer/state.ts`
- Create: `packages/cli/src/composer/history.ts`
- Create: `packages/cli/test/composer.test.ts`
- Modify: `packages/cli/test/prompt.test.ts`

**Interfaces:**
- Produces: `ComposerState`, `ComposerAction`, `initialComposerState`, `composerReducer`, `ComposerHistory`, `HistoryLookup`, and `submissionFromComposer`.
- Consumes: existing grapheme helpers from `packages/cli/src/text.ts` and `PastedAttachment` after moving that type into the composer module.

- [ ] **Step 1: Write composer state-machine tests**

Cover exact transitions:

```ts
it('inserts and deletes complete grapheme clusters', () => {
  let state = composerReducer(initialComposerState, { type: 'insert', text: 'a👩‍💻b' });
  state = composerReducer(state, { type: 'move.left' });
  state = composerReducer(state, { type: 'delete.backward' });
  assert.equal(state.draft, 'ab');
});

it('restores the draft after leaving recalled history', () => {
  const history = new ComposerHistory();
  history.record('first');
  history.record('second');
  assert.equal(history.previous('draft'), 'second');
  assert.equal(history.previous('second'), 'first');
  assert.equal(history.next('first'), 'second');
  assert.equal(history.next('second'), 'draft');
});

it('reverse-searches newest matching input first', () => {
  const history = new ComposerHistory();
  history.record('git status');
  history.record('npm test');
  history.record('git diff');
  assert.equal(history.search('git', -1), 'git diff');
});

it('queues an immutable snapshot of text and attachments', () => {
  const attachment = { kind: 'text' as const, token: '[paste-1]', text: 'complete payload' };
  let state = composerReducer(initialComposerState, { type: 'insert', text: 'review this' });
  state = composerReducer(state, { type: 'attachment.add', attachment });
  state = composerReducer(state, { type: 'queue.current', id: 'queued-1' });
  state = composerReducer(state, { type: 'reset.draft' });
  assert.deepEqual(state.queue, [{ id: 'queued-1', text: 'review this', attachments: [attachment] }]);
});
```

- [ ] **Step 2: Run tests and verify the modules are missing**

```powershell
node --import tsx --test packages/cli/test/composer.test.ts packages/cli/test/prompt.test.ts
```

Expected: FAIL because composer state still lives in `app.tsx`.

- [ ] **Step 3: Implement the composer reducer**

`ComposerState` owns `draft`, `cursor`, `attachments`, `queue`, `queuedSelection`, `completion`, and `historySearch`. Actions perform grapheme-safe edits, newline insertion, queue snapshot/drop, completion selection, and draft reset. The reducer stays pure; submission and command execution remain shell responsibilities.

- [ ] **Step 4: Implement local and persistent history boundaries**

`ComposerHistory` keeps current-session submissions synchronously and accepts this async boundary for older records:

```ts
export interface HistoryLookup {
  previous(before: number): Promise<{ readonly index: number; readonly text: string } | null>;
  search(query: string, before: number): Promise<{ readonly index: number; readonly text: string } | null>;
}
```

Cache fetched entries by stable index, preserve the user's original draft, skip blank entries, and collapse consecutive duplicates.

- [ ] **Step 5: Verify composer behavior**

```powershell
node --import tsx --test packages/cli/test/composer.test.ts packages/cli/test/prompt.test.ts packages/cli/test/input.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit composer state**

```powershell
git add packages/cli/src/composer packages/cli/test/composer.test.ts packages/cli/test/prompt.test.ts
git commit -m "refactor(cli): isolate composer state and history"
```

---

### Task 6: Add transcript viewport state and the Ctrl+T overlay

**Files:**
- Create: `packages/cli/src/transcript/scroll.ts`
- Create: `packages/cli/src/components/TranscriptOverlay.tsx`
- Create: `packages/cli/test/transcript-scroll.test.ts`
- Modify: `packages/cli/src/components/Timeline.tsx`
- Modify: `packages/cli/test/follow.test.ts`

**Interfaces:**
- Consumes: `TranscriptCell[]`, terminal width/height, and the existing `TimelineRow` rendering primitives.
- Produces: `TranscriptViewport`, `viewportReducer`, `visibleTranscriptSlice`, and `<TranscriptOverlay />`.

- [ ] **Step 1: Write viewport reducer tests**

```ts
describe('transcript viewport', () => {
  it('opens at the live tail', () => {
    const state = viewportReducer(initialViewport, { type: 'open', contentLines: 120, height: 30 });
    assert.equal(state.offset, 90);
    assert.equal(state.follow, true);
  });

  it('suspends follow when moving upward and restores it at the end', () => {
    let state = viewportReducer(initialViewport, { type: 'open', contentLines: 120, height: 30 });
    state = viewportReducer(state, { type: 'line', delta: -1, contentLines: 120, height: 30 });
    assert.equal(state.follow, false);
    state = viewportReducer(state, { type: 'end', contentLines: 120, height: 30 });
    assert.equal(state.follow, true);
  });

  it('clamps the offset after a resize', () => {
    const state = viewportReducer(
      { open: true, offset: 90, follow: false },
      { type: 'resize', contentLines: 50, height: 25 },
    );
    assert.equal(state.offset, 25);
  });
});
```

- [ ] **Step 2: Run the viewport test and verify it fails**

```powershell
node --import tsx --test packages/cli/test/transcript-scroll.test.ts
```

Expected: FAIL because viewport state does not exist.

- [ ] **Step 3: Implement pure scrolling and line measurement**

The viewport reducer supports `open`, `close`, `line`, `page`, `home`, `end`, `content`, and `resize`. Keep this state entirely inside the overlay path; normal mode still has no application-owned viewport, preserving the existing native-scrollback invariant.

Export a pure `measureTranscriptCells(cells, width)` function from `Timeline.tsx` so resize/navigation calculations share the same height rules as rendering.

- [ ] **Step 4: Build the full-screen Ink overlay**

`TranscriptOverlay` receives:

```ts
interface TranscriptOverlayProps {
  readonly cells: readonly TranscriptCell[];
  readonly active: TranscriptCell | null;
  readonly viewport: TranscriptViewport;
  readonly width: number;
  readonly height: number;
}
```

Render a one-line title, the clipped transcript body, and one-line hints. Reuse message/activity renderers from `Timeline`; do not create a second visual interpretation. The active cell snapshot is appended render-only and is never added to finalized state by the overlay.

- [ ] **Step 5: Replace separator tests with overlay/native-scrollback invariants**

In `packages/cli/test/follow.test.ts`, retain the assertion that normal session state has no `scrollOffset`. Remove cycle-separator expectations and assert that finalized cells use turn spacing while the overlay owns the only viewport reducer.

- [ ] **Step 6: Run transcript and frame tests**

```powershell
node --import tsx --test packages/cli/test/transcript.test.ts packages/cli/test/transcript-scroll.test.ts packages/cli/test/follow.test.ts packages/cli/test/frame.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit transcript navigation**

```powershell
git add packages/cli/src/transcript/scroll.ts packages/cli/src/components/TranscriptOverlay.tsx packages/cli/src/components/Timeline.tsx packages/cli/test/transcript-scroll.test.ts packages/cli/test/follow.test.ts
git commit -m "feat(cli): add navigable transcript overlay"
```

---

### Task 7: Wire persistence, transcript, and composer through focused controllers

**Files:**
- Create: `packages/cli/src/hooks/useTranscriptController.ts`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/session.ts`
- Modify: `packages/cli/src/main.tsx`
- Modify: `packages/cli/test/frame.test.ts`
- Create: `packages/cli/test/session-roundtrip.test.ts`

**Interfaces:**
- Consumes: core canonical events, `transcriptReducer`, `composerReducer`, `viewportReducer`, `Session.append`, and existing engine events.
- Produces: `useTranscriptController({ engine, session, replay })` with `state`, `appendUserTurn`, `persist`, and `persistenceWarning`.

- [ ] **Step 1: Write a live/resume equivalence test**

Create `packages/cli/test/session-roundtrip.test.ts`. Feed a user message, assistant commentary/tool call, tool result, final answer, and turn completion through `transcriptReducer`; serialize each event to JSONL; decode and replay it; assert:

```ts
assert.deepEqual(
  allTranscriptCells(replayed).map(({ kind, turnId }) => ({ kind, turnId })),
  allTranscriptCells(live).map(({ kind, turnId }) => ({ kind, turnId })),
);
assert.deepEqual(conversationFromTranscript(decoded), expectedProviderMessages);
```

Add an unfinished-turn fixture and assert replay ends with one interruption notice and no active running cell.

Use this concrete unfinished sequence:

```ts
const unfinished: ConversationEvent[] = [
  { version: 1, eventId: 'u', turnId: 't', at, kind: 'user.message', text: 'rode os testes' },
  { version: 1, eventId: 'ts', turnId: 't', at, kind: 'turn.started', userEventId: 'u' },
  {
    version: 1, eventId: 'as', turnId: 't', at, kind: 'tool.started',
    call: { id: 'c', name: 'run_command', arguments: '{"command":"npm test"}' },
  },
];
const recovered = recoverInterruptedTurns(unfinished, '2026-08-11T12:01:00.000Z');
const state = recovered.reduce(
  (current, event) => transcriptReducer(current, { type: 'event', event }),
  initialTranscriptState,
);
assert.equal(state.active, null);
assert.equal(allTranscriptCells(state).filter((cell) => cell.kind === 'notice').length, 1);
```

- [ ] **Step 2: Run the round-trip test and verify the controller path is absent**

```powershell
node --import tsx --test packages/cli/test/session-roundtrip.test.ts
```

Expected: FAIL until canonical replay and interrupted-turn finalization are wired.

- [ ] **Step 3: Implement `useTranscriptController`**

The hook must:

1. seed the reducer from canonical replay once;
2. subscribe to `conversation.event` and dispatch each event;
3. append each durable event to the lazily created session;
4. expose `appendUserTurn(text)` that creates `user.message` and `turn.started` with one new `turnId`;
5. suppress duplicate event IDs;
6. on the first append failure, expose one warning and stop repeated warning rows while continuing in memory;
7. synthesize `turn.interrupted` during replay when the final turn has no terminal event.

- [ ] **Step 4: Move input ownership to the composer**

Replace `input`, `cursor`, `history`, `historyIndex`, attachment tray, and queue-specific state in `app.tsx` with `useReducer(composerReducer, initialComposerState)` and one `ComposerHistory` ref. Preserve existing command dispatch and paste decoding by converting their results into composer actions.

- [ ] **Step 5: Route Ctrl+T and overlay keys before composer keys**

In `useInput`, apply this priority:

1. approvals/questions/pickers;
2. transcript overlay navigation and close;
3. global interrupt/exit shortcuts;
4. composer completion/history/edit actions.

Opening `Ctrl+T` must not toggle task/subagent detail; move that existing binding to a non-conflicting key shown in the footer.

- [ ] **Step 6: Replace timeline persistence calls**

Remove the old `record({ kind: ... })` calls and replay switch from `app.tsx`. The canonical controller handles persistence and projection. Remove `committed`/`entries` ownership from `SessionState` only after all render sites consume transcript state. Keep `Static` fed by finalized cells and the dynamic timeline fed by the projector's active/recent tail.

- [ ] **Step 7: Verify focused integration**

```powershell
node --import tsx --test packages/cli/test/session-roundtrip.test.ts packages/cli/test/composer.test.ts packages/cli/test/transcript.test.ts packages/cli/test/transcript-scroll.test.ts packages/cli/test/frame.test.ts packages/core/test/resume.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit controller integration**

```powershell
git add packages/cli/src/hooks/useTranscriptController.ts packages/cli/src/app.tsx packages/cli/src/session.ts packages/cli/src/main.tsx packages/cli/test/frame.test.ts packages/cli/test/session-roundtrip.test.ts
git commit -m "refactor(cli): wire canonical transcript controllers"
```

---

### Task 8: Apply the minimal visual hierarchy and derived running state

**Files:**
- Create: `packages/cli/src/live-status.ts`
- Create: `packages/cli/src/components/SessionHeader.tsx`
- Modify: `packages/cli/src/components/Timeline.tsx`
- Modify: `packages/cli/src/components/ToolCall.tsx`
- Modify: `packages/cli/src/components/Prompt.tsx`
- Modify: `packages/cli/src/components/PlifDock.tsx`
- Modify: `packages/cli/src/components/Footer.tsx`
- Modify: `packages/cli/src/app.tsx`
- Create: `packages/cli/test/tui-layout.test.ts`
- Create: `packages/cli/test/ink-frame.test.ts`

**Interfaces:**
- Consumes: projected transcript cells, composer state, MCP startup state, compaction state, and agent-turn state.
- Produces: `deriveLiveStatus(inputs)` from `live-status.ts`, `<SessionHeader />`, `cellSpacing` from `Timeline.tsx`, `plifDockItems` from `PlifDock.tsx`, compact activity summaries, and responsive footer/dock layouts.

- [ ] **Step 1: Write pure layout and live-status tests**

Create `packages/cli/test/tui-layout.test.ts`:

```ts
it('shows one authoritative running state by priority', () => {
  assert.deepEqual(
    deriveLiveStatus({ agent: true, mcp: 'connecting github', compacting: false, queued: 2 }),
    { kind: 'agent', label: 'Working', interruptible: true, queued: 2 },
  );
  assert.deepEqual(
    deriveLiveStatus({ agent: false, mcp: 'connecting github', compacting: false, queued: 0 }),
    { kind: 'mcp', label: 'Connecting github', interruptible: false, queued: 0 },
  );
});

it('collapses dock facts by width without dropping the working state', () => {
  const facts = {
    workspace: 'C:\\src\\plif', model: 'openai/gpt-5', effort: 'high',
    contextUsed: 40_000, contextMax: 128_000, working: true,
  } as const;
  assert.deepEqual(plifDockItems(52, facts), ['workspace', 'context', 'working']);
  assert.deepEqual(plifDockItems(28, facts), ['working']);
});

it('uses compact intra-turn spacing and a larger turn boundary', () => {
  assert.equal(cellSpacing({ previousTurnId: 'a', turnId: 'a' }), 0);
  assert.equal(cellSpacing({ previousTurnId: 'a', turnId: 'b' }), 1);
});
```

- [ ] **Step 2: Run the layout test and verify helpers are missing**

```powershell
node --import tsx --test packages/cli/test/tui-layout.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the compact opening header**

`SessionHeader` renders once as a finalized opening cell and contains:

- Plif name and version;
- shortened workspace;
- model/provider;
- truthful sandbox state, including a visible warning when degradations exist.

Do not render a fixed top header. Remove dead `Header.tsx` imports and delete that component only after `rg "Header" packages/cli/src` proves no remaining consumer.

Use this prop contract:

```ts
export interface SessionHeaderProps {
  readonly version: string;
  readonly cwd: string;
  readonly model: string | null;
  readonly provider: string | null;
  readonly sandboxGaps: readonly string[];
  readonly width: number;
}
```

- [ ] **Step 4: Implement activity and message hierarchy**

Keep the existing boxed user row and unboxed Markdown assistant row. Replace per-cycle separators with `cellSpacing`. Render a collapsed activity cell as one summary line such as `Read 4 files` or `Ran tests`, with an active spinner only while the group is live. Expanded overlay rendering shows each `ActivityItem`; the normal timeline remains compact.

- [ ] **Step 5: Derive one global live status**

Add `deriveLiveStatus` as a pure function. Priority is approval/question, agent turn, compaction, MCP startup, background work, idle. The prompt/dock owns the global indicator and interrupt/queue hint. Tool cells may show item-level progress but must not repeat the global `Working` label.

- [ ] **Step 6: Make footer and dock responsive**

Wide mode shows transcript, history/search, interrupt/queue, model/context, and workspace as available. Narrow mode keeps the actionable key plus working/queued state, then drops ambient facts in this order: provider, workspace, effort, numeric context detail. Preserve the current `FocusFrame` and colors.

- [ ] **Step 7: Run visual-layout and existing theme tests**

Create `packages/cli/test/ink-frame.test.ts` to exercise real Ink rendering at 28, 80, and 140 columns. Use this capture helper rather than a second renderer:

```ts
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import React from 'react';
import { render } from 'ink';

import { SessionHeader } from '../src/components/SessionHeader.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

async function capture(width: number): Promise<string> {
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperties(stdout, {
    columns: { value: width, configurable: true },
    rows: { value: 24, configurable: true },
    isTTY: { value: true, configurable: true },
  });
  let output = '';
  stdout.on('data', (chunk) => { output += chunk.toString(); });
  const instance = render(React.createElement(SessionHeader, {
    version: '0.3.0', cwd: 'C:\\src\\plif', model: 'openai/gpt-5', provider: 'openai',
    sandboxGaps: ['filesystem write block unavailable'], width,
  }), { stdout, patchConsole: false, exitOnCtrlC: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  instance.unmount();
  return output.replace(ANSI, '').replace(/\r/g, '');
}

describe('Ink frame hierarchy', () => {
  for (const width of [28, 80, 140]) {
    it(`renders a bounded ${width}-column opening cell`, async () => {
      const frame = await capture(width);
      assert.match(frame, /Plif/);
      assert.match(frame, /0\.3\.0/);
      assert.match(frame, /filesystem write block unavailable/);
      assert.ok(frame.split('\n').every((line) => [...line].length <= width));
    });
  }
});
```

If Ink emits several repaint frames, normalize to the substring after the final clear-screen sequence before applying the assertions; keep that normalization inside `capture` and cover it with a two-frame unit fixture.

Then run:

```powershell
node --import tsx --test packages/cli/test/tui-layout.test.ts packages/cli/test/ink-frame.test.ts packages/cli/test/frame.test.ts packages/cli/test/prompt.test.ts packages/cli/test/themes.test.ts packages/cli/test/thinking.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the visual hierarchy**

```powershell
git add packages/cli/src/live-status.ts packages/cli/src/components/SessionHeader.tsx packages/cli/src/components/Timeline.tsx packages/cli/src/components/ToolCall.tsx packages/cli/src/components/Prompt.tsx packages/cli/src/components/PlifDock.tsx packages/cli/src/components/Footer.tsx packages/cli/src/app.tsx packages/cli/test/tui-layout.test.ts packages/cli/test/ink-frame.test.ts
git commit -m "feat(cli): refine transcript and composer hierarchy"
```

---

### Task 9: Verify Windows resize, malformed sessions, and the complete workspace

**Files:**
- Modify: `packages/cli/test/frame.test.ts`
- Modify: `packages/cli/test/follow.test.ts`
- Modify: `packages/core/test/session-store-events.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: documented controls, compatibility notes, and complete verification evidence.

- [ ] **Step 1: Add regression cases discovered during integration**

Add these assertions to the existing focused test files:

```ts
// packages/cli/test/transcript-scroll.test.ts
it('clamps an open overlay when wrapping increases after a narrow resize', () => {
  const wide = viewportReducer(initialViewport, { type: 'open', contentLines: 60, height: 20 });
  const moved = viewportReducer(wide, { type: 'line', delta: -8, contentLines: 60, height: 20 });
  const narrow = viewportReducer(moved, { type: 'resize', contentLines: 110, height: 20 });
  assert.equal(narrow.open, true);
  assert.equal(narrow.follow, false);
  assert.ok(narrow.offset >= 0 && narrow.offset <= 90);
});

// packages/cli/test/follow.test.ts
it('keeps normal mode independent from transcript viewport state', () => {
  assert.equal('scrollOffset' in initialSession, false);
  assert.equal('viewport' in initialSession, false);
});

// packages/cli/test/session-roundtrip.test.ts
it('deduplicates replay for both cells and provider messages', () => {
  const event = { version: 1, eventId: 'same', turnId: 't', at, kind: 'user.message', text: 'oi' } as const;
  const decoded = dedupeConversationEvents([event, event]);
  const state = decoded.reduce(
    (current, item) => transcriptReducer(current, { type: 'event', event: item }),
    initialTranscriptState,
  );
  assert.equal(allTranscriptCells(state).length, 1);
  assert.equal(conversationFromTranscript(decoded).length, 1);
});
```

Extend `packages/core/test/session-store-events.test.ts` with a file containing a malformed middle line followed by a valid event and assert that the valid event still replays with exactly one `notice.recorded` warning. Reuse the truncated-final-line fixture from Task 2 and assert it adds no warning. Reuse the unfinished sequence from Task 7 and assert one interruption notice and `state.active === null`.

- [ ] **Step 2: Run the focused regression set**

```powershell
node --import tsx --test packages/core/test/session-events.test.ts packages/core/test/session-store-events.test.ts packages/core/test/resume.test.ts packages/core/test/conversation-events.test.ts packages/cli/test/transcript.test.ts packages/cli/test/transcript-scroll.test.ts packages/cli/test/composer.test.ts packages/cli/test/session-roundtrip.test.ts packages/cli/test/tui-layout.test.ts packages/cli/test/frame.test.ts packages/cli/test/follow.test.ts
```

Expected: PASS with zero failed tests and no unhandled rejection.

- [ ] **Step 3: Document the interaction model**

Update `README.md` and `CHANGELOG.md` with:

- `Ctrl+T` transcript overlay;
- Up/Down, Page Up/Page Down, Home/End, and Esc behavior;
- native scrollback remaining available in normal mode;
- compact tool activity and dedicated exceptional rows;
- session-history compatibility and protocol-correct resume;
- preserved Plif input identity and Ink implementation.

- [ ] **Step 4: Run full verification**

```powershell
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: all commands exit 0. Record the test count from `npm test` in the final handoff.

- [ ] **Step 5: Inspect the final diff for unrelated changes**

```powershell
git status --short
git diff --stat
git diff -- packages/core/src/session packages/core/src/harness/loop.ts packages/core/src/events/bus.ts packages/cli/src/transcript packages/cli/src/composer packages/cli/src/hooks/useTranscriptController.ts packages/cli/src/components packages/cli/src/app.tsx README.md CHANGELOG.md
```

Confirm every changed hunk belongs to this specification and that pre-existing user changes were preserved rather than replaced.

- [ ] **Step 6: Commit documentation and final regressions**

```powershell
git add README.md CHANGELOG.md packages/core/test/session-store-events.test.ts packages/cli/test/frame.test.ts packages/cli/test/follow.test.ts
git commit -m "docs: describe navigable canonical transcript"
```

---

## Implementation Order and Review Gates

1. Tasks 1-3 establish the core durable contract. Do not begin CLI integration until their focused tests and typecheck pass.
2. Tasks 4-6 build pure CLI state machines and navigation. Review the projected cell shapes before wiring the application.
3. Task 7 is the migration gate. Preserve compatibility adapters until the round-trip and old-session tests pass.
4. Task 8 changes presentation only after behavior is stable.
5. Task 9 is the completion gate; no success claim is allowed before all four verification commands pass.

If an existing uncommitted edit overlaps a planned hunk, inspect and merge it manually. Never replace the whole file from the plan snippets.
