# Invalid Tool Call Recovery Implementation Plan

> **For agentic workers:** Execute inline in the current session. Keep this plan local; do not stage, commit, publish, or add it to a release.

**Goal:** Keep a model session alive when a provider emits malformed JSON for a tool call, while preserving the original error for model recovery.

**Architecture:** The loop will store a wire-safe `{}` argument string for assistant history while the raw string remains available to diagnostics and the tool error result. The OpenAI-compatible adapter will enforce the same invariant at serialization so resumed or externally-created messages cannot poison the next request.

**Tech Stack:** TypeScript ESM, existing `ModelProvider`, `runLoop`, Node test runner, no new dependencies.

## Global Constraints

- Never execute a malformed tool call.
- Preserve the raw malformed text only in local diagnostics/tool output.
- Keep tool-call IDs and ordering unchanged.
- Do not auto-repair JSON into a potentially different command.
- Do not alter unrelated dirty-worktree changes.

### Task 1: Regression at the loop boundary

**Files:**
- Modify: `packages/core/test/harness.test.ts`

- [ ] Add a fake provider that emits one malformed tool call, then captures the next request.
- [ ] Assert the malformed call produces a tool error and the second request contains the same call ID with `arguments: "{}"`, not the raw malformed text.
- [ ] Run the focused test and confirm it fails before the implementation.

### Task 2: Regression at the provider boundary

**Files:**
- Modify: `packages/core/test/model.test.ts`

- [ ] Send an assistant message with malformed tool arguments through `OpenAIProvider`.
- [ ] Assert the captured HTTP payload contains valid JSON arguments while preserving name and ID.
- [ ] Run the focused test and confirm it fails before the implementation.

### Task 3: Implement the invariant

**Files:**
- Modify: `packages/core/src/harness/loop.ts`
- Modify: `packages/core/src/model/openai.ts`

- [ ] Add a small JSON-validity helper at each boundary or a shared exported helper if that is the existing module pattern.
- [ ] Normalize only the stored/wire representation to `{}`; keep execution and displayed error paths unchanged.
- [ ] Do not catch or rewrite valid non-object JSON beyond the existing tool-schema behavior.

### Task 4: Verify and review

- [ ] Run focused harness/model tests.
- [ ] Run `npm run typecheck` and the full `npm test` suite.
- [ ] Run `npm run build` and `git diff --check`.
- [ ] Confirm the local plan remains unstaged and no temporary files remain.
