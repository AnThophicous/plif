# Compact Plan Tool Implementation Plan

> **For agentic workers:** Implement inline in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact, bounded `update_plan` tool and its minimal terminal presentation.

**Architecture:** Core owns tool validation and model guidance. CLI owns the specialized visual representation while continuing to use the existing tool event and transcript pipeline.

**Tech Stack:** TypeScript, Node test runner, React Ink.

## Global Constraints

- Plans contain no more than six checkpoints.
- At most one checkpoint is `in_progress`.
- Internal spec and plan documents remain local and unpublished.

---

### Task 1: Core planning tool

**Files:**
- Modify: `packages/core/src/harness/tools.ts`
- Modify: `packages/core/src/harness/prompt.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/plan.test.ts`

- [ ] Add failing validation tests for seven checkpoints and two active checkpoints.
- [ ] Implement `update_plan` with a six-item schema and runtime validation.
- [ ] Register/export the tool and add concise checkpoint guidance to the system prompt.
- [ ] Run the focused core test.

### Task 2: Minimal CLI rendering

**Files:**
- Modify: `packages/cli/src/format.ts`
- Modify: `packages/cli/src/components/ToolCall.tsx`
- Test: `packages/cli/test/format.test.ts`

- [ ] Add a failing description/render-data test for `update_plan`.
- [ ] Render `Plan updated` with compact state glyphs and existing `Ctrl+T` expansion.
- [ ] Run focused CLI tests, typecheck, full tests, and build.
