# Minimal Terminal and Themes Implementation Plan

> **For agentic workers:** Implement inline in the current session. Do not publish files under `docs/superpowers`.

**Goal:** Deliver a minimal task/tool timeline, shell-aware rendering, working PowerShell/Bash LSP registration, and user themes discovered from `~/.plif/*.theme`.

**Architecture:** Keep lifecycle filtering in App state, presentation in focused Ink components, shell tokenization as a pure CLI module, LSP registration in core, and theme discovery/validation in a dedicated CLI theme store. Components continue consuming semantic palette keys so custom themes do not couple to component internals.

**Tech Stack:** TypeScript, Ink, Node test runner, JSONC configuration, LSP over stdio.

## Global Constraints

- Preserve all existing uncommitted product work.
- Do not commit or publish `docs/superpowers`.
- `Ctrl+T` owns task/transcript expansion; `Ctrl+R` owns thinking expansion.
- No more than three parallel tools.
- Theme files live at `~/.plif/*.theme`.

---

### Task 1: Task lifecycle and shortcuts

**Files:** `packages/cli/src/app.tsx`, `packages/cli/src/components/TaskIndicator.tsx`, `packages/cli/src/components/TaskPanel.tsx`, CLI tests.

- [ ] Add tests proving completed tasks disappear and only attention tasks remain.
- [ ] Filter task snapshots at the event boundary and close an empty panel.
- [ ] Change every task hint/handler to `Ctrl+T`.
- [ ] Run focused CLI tests.

### Task 2: Minimal tool transcript

**Files:** `packages/cli/src/components/ToolCall.tsx`, `packages/cli/src/components/Diff.tsx`, `packages/cli/src/components/Timeline.tsx`, `packages/cli/src/format.ts`, CLI tests.

- [ ] Add tests for `Ran`, folded rail output, line counts and edit stats.
- [ ] Render compact output head/tail with `ctrl + t to view transcript`.
- [ ] Route `Ctrl+T` to the newest tool when no task panel owns it.
- [ ] Aggregate/edit headings without stdout/stderr labels.

### Task 3: Thinking and calm model behaviour

**Files:** `packages/cli/src/app.tsx`, `packages/cli/src/components/Timeline.tsx`, `packages/core/src/harness/prompt.ts`, tests.

- [ ] Verify `Ctrl+R` toggles completed thinking.
- [ ] Ensure completed blocks render grey `Thinking:` rails.
- [ ] Add batching guidance that requests one useful intention before a coherent tool batch.

### Task 4: Shell syntax and LSP

**Files:** create `packages/cli/src/shell-highlight.ts`; modify `ToolCall.tsx`, `packages/core/src/lsp/servers.ts`, tests.

- [ ] Test PowerShell/Bash token categories without changing source text.
- [ ] Render command tokens through theme syntax keys.
- [ ] Register PowerShell Editor Services and bash-language-server extensions, markers and commands.
- [ ] Test server lookup and language ids.

### Task 5: Theme API and `/theme`

**Files:** create `packages/cli/src/themes.ts`; modify `theme.ts`, `commands.ts`, `app.tsx`, global config types/schema, tests.

- [ ] Define exhaustive serializable palette/syntax/diff/border/emphasis/glyph/layout schema.
- [ ] Discover and parse JSONC `.theme` files from `~/.plif` with inheritance from the built-in theme.
- [ ] Make the active theme mutable before Ink render and expose semantic accessors.
- [ ] Add `/theme` picker and persist its id to config JSONC.
- [ ] Test malformed files, overrides, discovery, selection and schema.

### Task 6: Verification

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Parse the config schema and run CLI `--help` smoke test.
- [ ] Run `git diff --check` and confirm docs remain uncommitted.
