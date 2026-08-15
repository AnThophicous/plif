# Expressive CLI, Stable LSP, TOML Schema, and Vision Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the inherited CLI work, make coding tool results visually expressive and theme-driven, make LSP sessions recoverable and useful during edits, replace the runtime JSON configuration schema with TOML guidance, and explain direct versus delegated vision clearly.

**Architecture:** Keep presentation in `packages/cli`, model/configuration and LSP contracts in `packages/core`, and preserve the existing event boundary between them. The LSP owns process lifecycle and diagnostics; the CLI owns syntax colour and maps semantic syntax roles through the active theme. Configuration remains backward-readable from JSONC but its canonical file, tool output, packaged reference, and documentation become TOML.

**Tech Stack:** TypeScript 5.7, Node.js 20+, Ink/React, `vscode-jsonrpc`, language servers over stdio, `smol-toml`, Node test runner.

## Global Constraints

- Preserve all unrelated local edits and the partial Claude implementation already in the worktree.
- `~/.plif/config.toml` is the only canonical personal configuration written by current code.
- Code colouring must use the selected Plif theme; hard-coded syntax foreground colours are not allowed.
- An unavailable LSP must never be reported as a clean file.
- A text-only model may inspect images only through the explicit `inspect_image` delegation path and a configured image-capable model.
- No credential, MCP header, environment value, or provider key may appear in tool output or tests.

---

### Task 1: Restore the inherited CLI baseline

**Files:**
- Modify: `packages/cli/test/format.test.ts`
- Verify: `packages/cli/src/app.tsx`, `packages/cli/src/status.ts`, `packages/cli/src/thinking-history.ts`

**Interfaces:**
- Consumes: the partial header, `/status`, searchable thinking history, concurrent slash command, and rich search-result implementation left in the worktree.
- Produces: a syntactically valid focused test set that can act as the baseline for later changes.

- [ ] **Step 1: Repair the malformed search fixture**

Replace the split string literal with `.join('\n')` without changing its expected three-result behavior.

- [ ] **Step 2: Run the inherited focused tests**

Run: `node --import tsx --test packages/cli/test/format.test.ts packages/cli/test/status.test.ts packages/cli/test/thinking-history.test.ts`

Expected: all inherited CLI tests pass.

### Task 2: Make coding tool results expressive and theme-driven

**Files:**
- Modify: `packages/cli/src/highlight.ts`
- Modify: `packages/cli/src/theme.ts`
- Modify: `packages/cli/src/themes.ts`
- Modify: `packages/cli/src/components/Diff.tsx`
- Modify: `packages/cli/src/format.ts`
- Modify: `packages/cli/test/diff.test.ts`
- Modify: `packages/cli/test/format.test.ts`
- Modify: `packages/cli/test/themes.test.ts`

**Interfaces:**
- Consumes: `SyntaxKey`, `syntaxColor()`, `ToolCategory`, `describeToolCall()`, and the current diff renderer.
- Produces: syntax tokens expressed as theme roles; themed TypeScript, JavaScript, Python, Go, Rust, shell, JSON, TOML, HTML, and CSS diff rows; concise names for diagnostics, definition, references, and outline tools.

- [ ] **Step 1: Write failing role and tool-description tests**

Assert that keywords, strings, calls, numbers, comments, and operators receive distinct syntax roles; TOML paths select TOML rules; and LSP tool calls render as `Diagnostics(path)`, `Definition(path)`, `References(path)`, and `Outline(path)` rather than raw snake_case names.

- [ ] **Step 2: Route syntax roles through the theme**

Change highlighter tokens from palette keys to syntax keys, extend the default/custom theme syntax surface with `keyword`, `function`, `type`, and `property`, and render every diff token with `syntaxColor()`.

- [ ] **Step 3: Expand practical file coverage**

Add conservative line tokenisation for TOML, HTML, CSS, and C/C++ while preserving the invariant that concatenated token text exactly equals the source line.

- [ ] **Step 4: Verify the visual contracts**

Run: `node --import tsx --test packages/cli/test/diff.test.ts packages/cli/test/format.test.ts packages/cli/test/themes.test.ts`

Expected: the text-preservation, theme-override, and expressive tool-label tests pass.

### Task 3: Stabilize and bundle the LSP runtime

**Files:**
- Modify: `packages/core/src/lsp/client.ts`
- Modify: `packages/core/src/lsp/manager.ts`
- Modify: `packages/core/src/lsp/servers.ts`
- Modify: `packages/core/src/lsp/tools.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json`
- Modify: `package-lock.json`
- Create: `packages/core/test/lsp-client.test.ts`
- Modify: `packages/core/test/lsp-servers.test.ts`

**Interfaces:**
- Consumes: `ResolvedServer`, `LspClient`, `LspManager.clientFor()`, and the existing LSP tools.
- Produces: one in-flight start per language, restart on the next request after a crash, quiescent diagnostics instead of a fixed 200 ms guess, canonical Windows document keys, actionable process errors, and bundled TypeScript/JavaScript plus HTML/CSS/JSON servers.

- [ ] **Step 1: Add failing lifecycle tests**

Use a real stdio fake server process to prove initialize/open/change/diagnostics/shutdown behavior, repeated diagnosis without content changes, clean response to `workspace/configuration`, and recovery after a process exit. Add a manager test proving warmup and first use share one start.

- [ ] **Step 2: Centralize manager starts and recovery**

Route warmup and demand through one promise map, discard stopped clients before retrying, and make `stop()` close both ready and in-flight clients without leaking a process.

- [ ] **Step 3: Make document synchronization deterministic**

Track last-sent text and monotonically increasing versions per canonical path, wait until diagnostics are quiet or the bounded deadline expires, clear timers, and retain a short stderr tail in status/failure detail.

- [ ] **Step 4: Ship useful default servers**

Add `typescript-language-server@^5.3.0`, resolve its `lib/cli.mjs` through Node like the bundled VS Code servers, add bundled HTML and CSS servers, and register Taplo (`taplo lsp stdio`) when installed for TOML.

- [ ] **Step 5: Verify LSP behavior**

Run: `node --import tsx --test packages/core/test/lsp-client.test.ts packages/core/test/lsp-servers.test.ts`

Expected: lifecycle, restart, routing, and bundled-resolution tests pass with no orphan server process.

### Task 4: Replace JSON configuration guidance with packaged TOML

**Files:**
- Delete: `packages/core/schema/config.schema.json`
- Create: `packages/core/schema/config.schema.toml`
- Modify: `packages/core/src/config/global.ts`
- Modify: `packages/core/src/harness/tools.ts`
- Modify: `packages/core/src/agenting/instructions/30-configuration/update-config.md`
- Modify: `packages/core/package.json`
- Modify: `packages/core/test/config.test.ts`
- Modify: `packages/core/test/secrets.test.ts`

**Interfaces:**
- Consumes: `CONFIG_SCHEMA_URL`, `configSchemaText()`, `loadGlobalConfig()`, `saveGlobalConfig()`, `redactedConfig()`, and `get_config`.
- Produces: a packaged TOML schema/reference, TOML-formatted redacted configuration output, and legacy JSON/JSONC read-only migration compatibility.

- [ ] **Step 1: Write failing TOML output and package tests**

Assert that schema guidance parses as TOML, `get_config` labels and emits TOML rather than JSON, credentials stay redacted, and the core package manifest includes `schema`.

- [ ] **Step 2: Add the TOML schema/reference**

Describe supported root fields, provider/model metadata, agents, MCP examples, vision modalities, and cost values as TOML tables with comments explaining defaults and security-sensitive fields.

- [ ] **Step 3: Switch runtime guidance to TOML**

Point `CONFIG_SCHEMA_URL` and `configSchemaText()` to `.toml`, serialize the redacted effective configuration with `smol-toml`, and stop presenting a JSON object as the contents of `config.toml`.

- [ ] **Step 4: Verify installed-package behavior**

Run: `node --import tsx --test packages/core/test/config.test.ts packages/core/test/secrets.test.ts`

Run: `npm pack --workspace @plif/core --dry-run`

Expected: tests pass and the dry-run file list contains `schema/config.schema.toml` but not `config.schema.json`.

### Task 5: Explain direct and delegated vision in the model experience

**Files:**
- Modify: `packages/core/src/model/catalog.ts`
- Modify: `packages/core/src/model/config.ts`
- Modify: `packages/core/src/agenting/capabilities.ts`
- Modify: `packages/cli/src/commands.ts`
- Modify: `packages/cli/src/components/Picker.tsx`
- Modify: `packages/cli/src/session.ts`
- Modify: `packages/core/test/model.test.ts`
- Modify: `packages/core/test/config.test.ts`
- Modify: `packages/cli/test/commands.test.ts`
- Modify: `README.md`
- Modify: `packages/cli/README.md`

**Interfaces:**
- Consumes: explicit `modalities = ["text", "image"]`, `visionCandidates()`, `visionModel`, `inspect_image`, and picker badges/hints.
- Produces: a pure capability description for direct vision, delegated vision, explicit text-only models, and unknown models; matching picker badges and documentation.

- [ ] **Step 1: Add failing capability-copy tests**

Cover a direct image model, a text-only model with a configured vision helper, a text-only model without one, and an undeclared live model whose direct modality remains unknown.

- [ ] **Step 2: Carry explicit modalities into the catalogue**

Preserve configured model modalities in user catalogue entries and derive badges without guessing from model ids.

- [ ] **Step 3: Explain the fallback where users choose models**

Add a model-picker hint that distinguishes `[vision]` from `[vision helper]`, and describe that a text-only main model calls `inspect_image`, sends only the attached image/question to the selected helper, and receives text observations back.

- [ ] **Step 4: Teach the agent the same boundary**

Update generated capability instructions so a text-only active model uses `inspect_image` and never claims direct pixel access.

- [ ] **Step 5: Document a runnable TOML example**

Show one text coding model, one image-capable helper, and `visionModel = "provider/model"` in both published README copies.

### Task 6: Final verification and review

**Files:**
- Review: every changed file from Tasks 1-5

**Interfaces:**
- Consumes: all deliverables above.
- Produces: fresh typecheck, focused tests, full test evidence, build evidence, and an explicit note for any pre-existing or environmental failure.

- [ ] **Step 1: Run formatting-safe source checks**

Run: `rg -n "config\.schema\.json|Configuration \(credentials redacted\):\\n\\{" packages README.md`

Expected: no current-runtime JSON schema reference or JSON-formatted TOML guidance remains.

- [ ] **Step 2: Run the full compiler and build**

Run: `npm run typecheck`

Run: `npm run build`

Expected: both exit 0.

- [ ] **Step 3: Run focused and full tests**

Run the focused commands from Tasks 1-5, then `npm test` with a timeout above the observed 118-second baseline.

Expected: zero failures and no timeout.

- [ ] **Step 4: Inspect the final diff**

Confirm the partial Claude changes remain present, no unrelated user work was reverted, no secrets were added, and package output contains the new server dependency and TOML schema.
