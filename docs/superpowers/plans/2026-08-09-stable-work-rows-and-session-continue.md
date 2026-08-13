# Stable Work Rows and Session Continue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize live work chrome and support `plif continue [id]`.

**Architecture:** Work detail visibility becomes exclusively user-controlled, so asynchronous events cannot change frame height. The CLI parser gives `continue` an optional ID and the interactive runner resolves either that ID or the latest session.

**Tech Stack:** TypeScript, Ink, Node test runner.

## Global Constraints

- Preserve existing dirty-worktree changes.
- Do not commit without separate authorization.
- Keep `resume` backward compatible.
- Keep collapsed work chrome exactly one row tall.

---

### Task 1: Stable work rows

**Files:**
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/session.ts`
- Test: `packages/cli/test/frame.test.ts`

**Interfaces:**
- Consumes: `WorkDock`, `tasksOpen`, `subagentsOpen`, task/subagent events.
- Produces: asynchronous work events that never open the details pane.

- [ ] Add a reducer regression asserting `subagent.start` preserves `subagentsOpen: false`.
- [ ] Remove automatic `setTasksOpen(true)` from task creation/start handlers.
- [ ] Remove automatic `subagentsOpen: true` from `subagent.start`.
- [ ] Run the focused frame/session tests.

### Task 2: Optional continue ID

**Files:**
- Modify: `packages/cli/src/argv.ts`
- Modify: `packages/cli/src/main.tsx`
- Test: `packages/cli/test/argv.test.ts`

**Interfaces:**
- Produces: `{ kind: 'continue'; id: string | null; flags: GlobalFlags }`.

- [ ] Add parser tests for `continue`, `continue abc123`, and `resume abc123`.
- [ ] Parse an optional positional ID after `continue`.
- [ ] Resolve `continue.id` with `sessions.resolve`, otherwise use `sessions.latest`.
- [ ] Update help text to document `plif continue [id]`.
- [ ] Run argument tests, build, and `git diff --check`.

## Self-Review

- Spec coverage: both work-row stability and session resolution are covered.
- Placeholder scan: no TODO/TBD remains.
- Type consistency: `continue.id` is nullable in parser and runner.
