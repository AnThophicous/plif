# Tool Compaction and Rounded UI Implementation Plan

> **For agentic workers:** Execute inline in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact repeated discovery tools, hide file-read bodies from the timeline, and finish the rounded monochrome interface.

**Architecture:** Core decides which tool output is safe and useful to expose. CLI session state groups adjacent discovery calls structurally, while the renderer owns expansion and visual hierarchy. User appearance remains in the existing global configuration path.

**Tech Stack:** TypeScript, React Ink, Node test runner, JSONC user configuration.

## Global Constraints

- The model must still receive complete tool results.
- Repeated tool groups must remain expandable with `Ctrl+T`.
- Internal documents remain local and unpublished.

---

### Task 1: Terminal output policy

- [ ] Add tests proving reads are hidden, lists and shell are visible, and hidden failures remain diagnosable.
- [ ] Apply the policy only to bus/display output; preserve model-facing tool messages.

### Task 2: Discovery compaction

- [ ] Add reducer tests for a mutable Read/List dock and final one-line flush.
- [ ] Route discovery calls away from ordinary timeline rows while preserving targets/listing output.
- [ ] Render the live dock above the composer and one final expandable transcript row.

### Task 3: Subagent dock and reasoning stream

- [ ] Add a regression test for cumulative reasoning snapshots.
- [ ] Normalize snapshots at the provider boundary without changing real token deltas.
- [ ] Suppress parent subagent tool rows and move the child session dock directly above the prompt.

### Task 4: Rounded monochrome UI

- [ ] Replace remaining square panel borders with rounded borders.
- [ ] Move theme selection to the actual global config and improve inactive contrast.
- [ ] Run focused tests, full tests, typecheck, build, and a global CLI smoke test.
