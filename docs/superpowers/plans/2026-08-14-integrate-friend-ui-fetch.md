# Integrate Friend UI and Fetch Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the friend's selector, navigable MCP/browser UI, and fetch/render performance improvements into the current Plif worktree while preserving existing local work and secure credential behavior, then replace the header ASCII with the requested `plifcat` PowerShell function.

**Architecture:** Compare the remote branch against the current commit and worktree, then apply only compatible commits or file-level patches. Existing local changes remain authoritative where they overlap; security-sensitive credential storage is retained unless a concrete regression is demonstrated. Header output is updated at the current header/banner ownership point and covered by existing CLI tests.

**Tech Stack:** TypeScript, React/Ink CLI, Node.js, npm workspaces, Vitest, Git.

## Global Constraints

- Preserve all pre-existing uncommitted user changes.
- Include navigable selector/browser UI behavior and the remote performance improvements.
- Do not remove encrypted credential storage without evidence that it is harmful or unused.
- Do not use destructive Git operations such as reset or checkout of user files.
- Verify typechecking and relevant tests after integration.

---

### Task 1: Establish the integration boundary

**Files:**
- Read-only: Git history, `packages/cli/src`, `packages/core/src`, and existing tests.
- Create: `docs/superpowers/plans/2026-08-14-integrate-friend-ui-fetch.md`

- [ ] **Step 1: Record clean integration inputs**

Run `git status --short --branch`, `git fetch --all --prune`, and compare `HEAD` with `origin/codex/model-effort-mcp-ui`.

- [ ] **Step 2: Map the remote commits to requested outcomes**

Inspect diffs for selector navigation, browser/MCP navigation, fetch/render performance, credential handling, and tests before choosing commit-level or file-level integration.

### Task 2: Integrate compatible remote behavior

**Files:**
- Modify only the remote files whose behavior is compatible with the current worktree, especially `packages/cli/src/app.tsx`, `packages/cli/src/commands.ts`, `packages/cli/src/components/Browser.tsx`, `packages/cli/src/components/Picker.tsx`, `packages/cli/src/hooks/useAnimationClock.tsx`, `packages/cli/src/stream-frame.ts`, `packages/core/src/harness/mcp.ts`, and `packages/core/src/model/config.ts`.
- Test: corresponding CLI/core tests from the remote branch and existing local suites.

- [ ] **Step 1: Apply the smallest non-destructive integration**

Use a merge only if it preserves the worktree; otherwise apply reviewed patches or cherry-pick into a temporary comparison and copy compatible changes without overwriting unrelated local edits.

- [ ] **Step 2: Preserve secure credential behavior**

Keep the existing encrypted credential store and ensure the selector flow does not prompt unsolicitedly or expose keys in config/transcript.

- [ ] **Step 3: Verify selector/browser navigation and performance paths**

Run focused tests for picker, browser, input, stream frames, MCP OAuth, and animation/render scheduling; fix only integration regressions caused by this change.

### Task 3: Replace the header/banner

**Files:**
- Modify: the current header/banner owner identified during inspection, likely `packages/cli/src/components/Header.tsx` or `packages/cli/src/banner.ts`.
- Test: the matching header/banner test.

- [ ] **Step 1: Replace the current ASCII output with the requested Plif cat glyph**

Preserve the existing terminal color and spacing contract while rendering the four requested lines.

- [ ] **Step 2: Run the header test and CLI typecheck**

Confirm the new output is stable and does not break narrow terminal rendering.

### Task 4: Full verification and handoff

**Files:**
- Read-only: final Git diff, package scripts, test output.

- [ ] **Step 1: Run the repository's relevant checks**

Run the package test/typecheck/build commands defined in `package.json` and workspace manifests.

- [ ] **Step 2: Review requirements against the final diff**

Confirm selector navigation, navigable UIs, fetch/render speed changes, secure key storage, and the requested header are all present, with no unrelated user work reverted.
