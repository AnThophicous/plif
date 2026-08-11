# Plif Focus Mode and Transient Prose Design

**Date:** 2026-08-09
**Status:** implemented and verified
**Publication:** local internal design only; do not commit, publish, or release it without separate authorization.

## Goal

Make Plif effort mode feel distinctly premium without losing the terminal's quiet,
minimal character. The visual identity is concentrated in the prompt and compact
operational docks instead of recolouring the full transcript.

At the same time, remove the noisy warning produced when an endpoint emits a
partial prose preamble immediately before requesting a tool. The harness must
preserve that preamble for protocol continuity while keeping it out of the
developer-facing answer, timeline, and transcript.

## Confirmed diagnosis

The issue is not raw SSE parsing. The OpenAI SDK owns raw SSE decoding; Plif
consumes decoded completion chunks, splits reasoning channels, and assembles
fragmented tool calls. Existing tests cover fragmented function arguments.

The observed behaviour is a model or gateway ending a prose delta at the tool
boundary. The current loop detects a mid-sentence preamble, logs a warning, and
the UI renders the partial prose as if it were user-facing output. That is a
presentation and lifecycle problem, not a malformed SSE parser.

## UX direction

### Plif focus identity

- In `plif` effort only, the input gains a moving blue-violet gradient outline.
  The gradient is terminal-safe: coloured border cells, not a bitmap or rainbow.
- A small animated infinity glyph occupies the prompt's far right edge while the
  agent works. It stays static and dim while idle.
- The supplied infinity mascot informs a compact terminal ASCII mark. It appears
  only in Plif-mode chrome and never as a large banner in the conversation.
- Thinking uses the same blue-violet motion family, but answer text remains
  readable neutral text. The transcript does not receive a global colour wash.

### Docks

- The top dock is no longer a general status header. It appears only for active
  tasks or subagents, automatically opens while they work, and contains their
  concise operational details and controls. It can collapse with the keyboard
  and accepts a left click in SGR mouse-capable terminals.
- The bottom dock lives immediately under the prompt. It shows the project path,
  active effort, compact context pressure, and a working infinity state. It
  is visually attached to the prompt with an inset lower border and collapses
  gracefully on narrow terminals.
- Existing task and subagent data remains the source of truth. The visual change
  must not alter scheduling, task ownership, subagent lifecycle, or context
  accounting.

### Tool and chat treatment

- Tool rows stay categorised and scannable. Their running state uses subtle
  motion only; output, failures, diffs, and plans keep their existing semantic
  colours.
- The conversation area remains the quietest surface. Prompt, docks, and live
  activity carry the Plif identity; completed answers do not.

## Transient pre-tool prose

For every model turn that requests tools:

1. The loop retains the exact assistant message in model history so tool-result
   follow-up requests remain protocol-correct.
2. It classifies prose ending mid-sentence as transient when tools were requested.
3. It omits transient prose from the user-facing aggregate result and emits a
   dedicated lifecycle event for consumers.
4. The TUI removes the live answer row associated with that transient preamble;
   it never becomes a completed timeline entry or transcript answer.
5. A complete pre-tool sentence is rendered as compact activity, never as a
   completed answer. No warning is printed to the timeline for either case.

This preserves useful protocol data without presenting a clipped phrase as a
conclusion. It deliberately does not invent or reconstruct missing model text.

## Architecture

```text
OpenAI SDK SSE stream
  -> OpenAIProvider completion events
  -> runLoop detects tool-boundary transient prose
      -> assistant history retains original prose
      -> result text excludes pre-tool prose
      -> agent.pre_tool_prose event
  -> TUI drops clipped provisional prose or folds complete prose into activity

Plif effort state
  -> Prompt receives focus-mode visual state
  -> BottomDock renders project / effort / context / infinity
  -> WorkDock renders only active task and subagent state
```

The new components must be presentational and consume existing state through
small typed props. Animation utilities belong beside the existing pulse helpers;
the core loop never imports CLI presentation code.

## Tests

- Add a loop regression test proving a clipped pre-tool sentence remains in
  assistant history but not the returned visible text, and that the lifecycle
  event is emitted once.
- Add UI tests for prompt gradient segmentation, infinity animation fallback,
  dock visibility, narrow-width fallback, and transient-row removal.
- Keep existing fragmented-SSE and tool-call reassembly tests intact.
- Run typecheck and the full core, sandbox, and CLI test suite.

## Acceptance criteria

- `/effort plif` changes only focused interactive chrome to the blue-violet
  Plif identity; completed chat remains calm and readable.
- The prompt has a visible moving gradient and infinity affordance in Plif mode.
- The lower dock exposes project, effort, context, and work state without adding
  more than a compact terminal row on normal widths.
- The upper dock is reserved for active tasks and subagents and is absent when
  neither exists.
- Clipped pre-tool prose and the old endpoint warning no longer pollute the
  developer-facing timeline or final answer.
- Original assistant protocol messages continue to be sent before tool results.
- No change weakens retry behaviour, sandboxing, permissions, or persistence.

## Out of scope

- Replacing the OpenAI SDK SSE decoder.
- Suppressing complete model answers or reconstructing text not received.
- Adding bitmap rendering dependencies to the terminal CLI.
- Changing model providers, effort negotiation, task scheduling, or permissions.
