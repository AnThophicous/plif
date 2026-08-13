# DME Skill Package and Tool Discovery Implementation Plan

> **For agentic workers:** Execute each task in order and keep the existing dirty worktree intact.

**Goal:** Add a discoverable DME skill package and proactive, quiet routing for skills and MCP tools.

**Architecture:** Extend skill catalogue metadata without changing child lookup, define DME children in a focused package module, and strengthen conditional prompt modules. Preserve all flat skill and MCP runtime behavior.

**Tech Stack:** TypeScript, Node.js test runner, modular prompt compiler.

## Global Constraints

- Do not copy the reference prompts verbatim.
- Do not add dependencies.
- Preserve unrelated user changes.
- Do not commit or publish without separate authorization.

### Task 1: Skill package catalogue

**Files:**
- Modify: `packages/core/src/harness/skills.ts`
- Test: `packages/core/test/skills.test.ts`

- [ ] Add optional package metadata to `Skill`.
- [ ] Group packaged entries in `SkillRegistry.catalogue()` while keeping flat output compatible.
- [ ] Test group visibility, child names, and exact child loading.

### Task 2: DME package

**Files:**
- Create: `packages/core/src/harness/skill-packages/dme.ts`
- Modify: `packages/core/src/harness/skills.ts`
- Test: `packages/core/test/skills.test.ts`

- [ ] Define focused, independently routable DME child skills.
- [ ] Replace the monolithic built-in entry with the DME package export.
- [ ] Test the expected inventory, descriptions, bodies, and package metadata.

### Task 3: Quiet capability discovery

**Files:**
- Modify: `packages/core/src/harness/prompts/skills.ts`
- Modify: `packages/core/src/harness/prompts/mcp.ts`
- Modify: `packages/core/src/harness/prompts/default.md`
- Test: `packages/core/test/prompt.test.ts`

- [ ] Require relevance checks without requiring explicit user mentions.
- [ ] Keep empty scans silent and use only the smallest sufficient capability set.
- [ ] Define bounded fallback for unavailable or poor integrations.
- [ ] Test the prompt invariants without snapshotting full prose.

### Task 4: Verification

**Files:**
- Verify only.

- [ ] Run focused skill and prompt tests.
- [ ] Run workspace typecheck.
- [ ] Run workspace build and inspect the final diff.
