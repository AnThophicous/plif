# Canonical Transcript and Navigable TUI Design

**Date:** 2026-08-11

**Status:** approved for implementation

**Publication:** local internal design; do not publish or release without separate authorization.

## Goal

Make Plif's interactive terminal feel coherent, minimal, and professional while
retaining Ink and the existing visual identity of the input. A live session and
a resumed session must represent the same conversation with the same semantic
message types, and the developer must be able to inspect the complete transcript
without giving up native terminal scrollback.

## Confirmed diagnosis

Plif currently maintains four histories with different formats and ownership:

- prompt recall is an in-memory string array in the main application;
- the visible timeline is split into mutable entries and Ink `Static` entries;
- provider context is held separately as model `Message` objects;
- the persisted JSONL transcript stores a smaller event union.

Those representations do not round-trip. On resume, an assistant response is
rendered as a generic step instead of an answer, while tool calls are flattened
into synthetic assistant prose for provider context. The main Ink application
also owns event interpretation, input editing, persistence, streaming buffers,
layout budgeting, overlays, and rendering decisions in one component. This
makes changes to message behavior difficult to reason about and test.

## Chosen approach

Keep TypeScript and Ink. Combine a focused visual refinement with a structural
change: introduce a canonical conversation event model and derive the live TUI,
navigable transcript, persisted log, and resumed provider context from it.

Do not port Ratatui or Rust code. Reuse the architectural principle demonstrated
by Codex's TUI: finalized transcript cells are immutable, one in-flight cell may
change while work streams, and the composer is a separate state machine.

## Architecture

```text
Harness and engine events
        |
        v
Canonical ConversationEvent stream
        |
        v
Transcript reducer / projector
  |-- finalized cells
  |-- active mutable cell
  `-- current turn state
        |
        |-- normal timeline and native scrollback
        |-- Ctrl+T navigable transcript
        |-- versioned JSONL persistence
        `-- provider context reconstruction on resume
```

### Canonical events

Every durable conversation event has a schema version, stable `eventId`,
`turnId`, timestamp, and explicit kind. Tool events also carry a stable
`callId`. The durable event set must distinguish at least:

- turn start, completion, interruption, and failure;
- user message;
- assistant commentary and final response;
- tool start and tool result;
- approval request and resolution;
- question request and resolution;
- compaction boundary;
- operational notice worth retaining.

Streaming deltas remain ephemeral UI input and are accumulated into the active
cell. Completed semantic events, not every token delta, are appended to JSONL.
A turn or tool start may be persisted before its result so a crash can be
recovered honestly as interrupted.

### Transcript projection

The transcript reducer owns two categories of cells:

- **finalized cells** are immutable and may be handed to Ink `Static` or shown
  in the transcript overlay;
- **the active cell** is mutable and represents the currently streaming answer
  or coalesced activity group.

Projection, not the React component tree, decides whether an event becomes a
user message, assistant response, activity, approval, diff, error, or notice.
The normal timeline and transcript overlay consume the same projected cells.
The overlay additionally receives a render-only snapshot of the active cell so
work in progress appears immediately without finalizing it.

### Composer ownership

The composer becomes an independent reducer or hook that owns:

- draft text and cursor movement;
- multiline editing and terminal-width-aware wrapping;
- local recall and persistent history lookup;
- reverse search;
- queued messages and attachments;
- slash-command completion;
- input-specific keyboard routing.

Conversation history is not prompt recall. Navigating submitted drafts must not
mutate transcript state or provider context.

### Application shell

The main application coordinates controllers and renders surfaces. It no longer
contains the detailed transition rules for transcript cells, composer editing,
or persisted session reconstruction. Existing event bus contracts may be
adapted at the application boundary; the core harness must never import Ink or
presentation components.

## Interaction and visual behavior

### Input and live status

Keep the existing Plif input identity, including the focus frame, border family,
prompt marker, and Plif dock. Improve its logic and responsive behavior without
turning it into a copy of Codex.

There is one authoritative live-status presentation. Agent work, MCP startup,
compaction, and other busy lifecycles feed a derived status value. The interface
must not show equivalent simultaneous spinners in the prompt, thinking row, and
tool row. Specific activity may animate inside its cell, while the composer
shows the single global interrupt or queue affordance.

### Header and contextual information

Replace the permanently repeated header with a compact session-opening cell that
enters native scrollback. It shows Plif identity and the stable facts useful at
session start, including workspace, model/provider, version, and the truthful
sandbox summary.

Live context belongs with the composer. Model, workspace, context pressure,
effort, and current state collapse by priority as terminal width shrinks. Do not
repeat the same fact in both the opening header and a permanent top row.

### Messages and spacing

- User messages retain a discreet boxed treatment.
- Assistant answers remain unboxed Markdown with a stable gutter marker.
- Consecutive routine tool activity is coalesced into one mutable activity cell.
- Completed activity collapses to a concise summary and can be expanded in the
  navigable transcript.
- Diffs, failures, approvals, questions, and materially important results keep
  dedicated cells.
- Use the largest vertical separation between turns. Cells within one turn use
  compact spacing and do not receive decorative separators after every model or
  tool cycle.
- Replayed cells use their original semantic type. The interface may mark the
  resume boundary once, but must not tag every historical row as a different
  class of message.

### Navigable transcript

`Ctrl+T` opens a full-height transcript overlay containing all finalized cells
and the current active-cell snapshot. It does not replace or erase native
scrollback.

The initial bindings are:

- Up/Down: move by visual line;
- Page Up/Page Down: move by viewport;
- Home/End: jump to the beginning or live tail;
- Esc or Ctrl+T: close the overlay.

Opening the overlay follows the live tail. Manual upward navigation disables
follow until the user returns to the end. Terminal resize recalculates wrapping
and clamps the offset without changing transcript data.

## Persistence and compatibility

Continue using append-only JSONL. Add an explicit schema version and parse each
line independently so a truncated final write does not invalidate earlier
events. Unknown future event kinds are skipped for projection but retained when
the log is copied or inspected; malformed lines are reported as bounded session
warnings rather than crashing the interactive interface.

Provide a legacy adapter for the current transcript union. Old user, assistant,
tool, note, and compaction records must remain resumable. The adapter reconstructs
the best available canonical events without rewriting the original file.

Provider context reconstruction preserves protocol roles and tool-call/result
relationships. Tool results must not be converted into fabricated assistant
prose. If an old record lacks the identifiers required for a protocol-perfect
tool replay, its clipped content may be supplied as clearly labeled historical
context, but never as a claim that the assistant authored it.

A turn whose start has no terminal event resumes as interrupted. Active cells
are not restored as running, and the developer sees one concise interruption
notice at the resume boundary.

## Error handling

- A failed persistence append never blocks the active turn; emit one bounded
  warning and disable repeated warning spam for that session.
- Projection of an unknown or malformed event must not corrupt prior cells.
- An event carrying an unknown `turnId` starts an isolated recovered turn rather
  than attaching itself to unrelated work.
- Duplicate `eventId` values are idempotent during replay.
- A tool result with an unknown `callId` renders as an orphaned result notice and
  is excluded from protocol tool-result reconstruction.
- Transcript overlay failures fall back to the normal timeline and never stop
  the harness.

## File and component boundaries

The implementation plan must preserve the repository's package split and use
small units with clear ownership. Expected responsibilities are:

- core conversation event types and versioned decoding;
- core append-only session store and legacy adapter;
- core provider-context reconstruction;
- CLI transcript reducer/projector;
- CLI composer reducer/history controller;
- CLI transcript overlay and scroll state;
- presentational cells for user, assistant, activity, and exceptional events;
- a smaller application shell that wires bus events to controllers.

Exact filenames and migration order belong in the implementation plan after the
current working tree is reconciled. Existing user changes must not be overwritten.

## Verification

Use focused reducer and projection tests before Ink snapshots. Cover:

- active-cell creation, mutation, coalescing, and finalization;
- turn boundaries and compact intra-turn spacing;
- dedicated handling for diffs, failures, approvals, and questions;
- idempotent duplicate events and orphaned tool results;
- composer cursor, multiline wrapping, recall, reverse search, and queue state;
- transcript navigation, follow suspension, jump-to-tail, close behavior, and
  resize clamping;
- round-trip equivalence between a live canonical event stream and a resumed
  session;
- protocol-correct assistant tool calls and tool results after resume;
- legacy JSONL compatibility and truncated-final-line recovery;
- crash recovery for an unfinished turn or tool call;
- Ink frame snapshots at narrow, standard, and wide terminal sizes;
- native scrollback behavior and protection against duplicate repaint output on
  Windows terminal resize.

Run focused core and CLI tests during each migration step, then the workspace
typecheck, complete test suite, and build before claiming completion.

## Acceptance criteria

- Plif remains an Ink application and retains its input identity.
- A resumed conversation has the same user/assistant/tool semantics as the live
  conversation that produced it.
- The normal interface preserves native terminal scrollback.
- `Ctrl+T` provides a complete navigable transcript including live activity.
- Routine consecutive tools appear as one compact activity group while running
  and after completion; exceptional events remain prominent.
- Only one global running state is presented at a time.
- The permanent top header is removed in favor of a compact opening cell and
  responsive context beside the input.
- The main application no longer owns detailed transcript, composer, persistence,
  and projection transition logic.
- Existing session files remain resumable without destructive migration.
- Resize, interrupted streams, failed tools, and malformed final JSONL lines do
  not duplicate the interface or prevent the next prompt.

## Out of scope

- Replacing Ink with Ratatui, a Rust port, or a custom terminal renderer.
- Copying Codex styling, branding, or Rust implementation code.
- Redesigning MCP transport reliability or skill loading in this specification;
  those are separate follow-up subprojects.
- Changing sandbox policy, model-provider behavior, or permission semantics.
- Replacing native terminal scrollback with an always-on alternate screen.
