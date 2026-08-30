# PLIF 0.4.0 Implementation Plan

> **For agentic workers:** Execute the tasks in order and keep the checkboxes
> current. Preserve unrelated worktree changes. Do not add comments to new
> production code.

**Goal:** Implement the approved PLIF 0.4.0 design: durable SQLite history,
isolated forked subagents, project/global memory, project-scoped `/env`,
interactive terminals, secret-safe composer behavior, local writing
assistance, and an NPM-only Rust updater for Windows/Linux x64/ARM64.

**Architecture:** Keep the Node.js/TypeScript CLI and harness as the primary
runtime. Put persistence behind repositories with separate `history.db` and
`memory.db` files. Give every conversation lane and terminal an explicit
owner. Keep OS credential access and the updater behind isolated adapters.
Build the updater as a standalone Rust executable and package one binary per
supported platform/architecture inside `@plif/cli`.

**Tech Stack:** TypeScript, Node.js `>=20.11`, React/Ink, Node test runner,
SQLite compiled to WASM through `sql.js` behind a repository boundary, Rust
stable with Cargo, Linux PTY, Windows ConPTY, existing `koffi` Win32 bridge,
Windows Credential Manager, and Linux Secret Service.

## Global constraints

- Preserve unrelated user changes already present in the worktree.
- Do not use Git as an update source.
- Do not add C#, a DLL, or a mandatory native Node addon to the updater or
  normal CLI installation.
- Keep the default interface, installer, updater, warnings, and settings text
  in English.
- Keep global memory, project memory, chat history, and `/env` in separate
  storage boundaries.
- Never write secret values to model context, history, logs, status output,
  clipboard redaction paths, or ordinary tool output.
- Subagents may read memory and inherit controlled project environment values,
  but cannot write, edit, delete, or merge memories.
- New production code contains no comments. Existing comments are left alone
  unless the changed code requires their correction.
- Use `apply_patch` for source edits and keep each implementation slice
  buildable and testable.

## Task 1: Establish the portable persistence foundation

**Files:**

- Modify: `package.json`
- Modify: `packages/core/package.json`
- Modify: `package-lock.json`
- Create: `packages/core/src/persistence/sqlite.ts`
- Create: `packages/core/src/persistence/migrations.ts`
- Create: `packages/core/test/sqlite.test.ts`

**Interfaces:**

- `SqliteDatabase.open(path, migrations)` opens or creates a database and
  applies migrations atomically.
- `SqliteDatabase.transaction(fn)` serializes writes and commits one durable
  unit.
- `SqliteDatabase.query`, `run`, and `close` expose only typed repository
  primitives needed by core.
- The adapter configures foreign keys, busy timeout, journal mode, schema
  versioning, and an explicit cross-process lock around file replacement.

- [ ] Add the portable `sql.js` dependency and load its WASM asset through a
  package-owned resolver that works from source, build output, and an installed
  NPM package.
- [ ] Implement atomic database creation, migration tracking, transaction
  rollback, close/reopen persistence, and lock recovery for interrupted writes.
- [ ] Add focused tests for two handles, migration retry, malformed data,
  concurrent append serialization, and Windows path handling.
- [ ] Run `npm run typecheck --workspace @plif/core` and the focused test.

## Task 2: Replace JSONL session persistence with canonical SQLite history

**Files:**

- Modify: `packages/core/src/session/events.ts`
- Modify: `packages/core/src/session/store.ts`
- Modify: `packages/core/src/session/index.ts`
- Create: `packages/core/src/session/history-repository.ts`
- Create: `packages/core/src/session/history-migrations.ts`
- Create: `packages/core/test/history-repository.test.ts`
- Modify: existing `packages/core/test/session-store*.test.ts`

**Interfaces:**

- `HistoryRepository` owns `sessions`, `events`, `checkpoints`, and
  `queued_inputs` rows.
- `SessionStore` remains the compatibility facade used by the harness, but
  reads and writes canonical SQLite rows.
- `HistoryRepository.importLegacyJsonl()` is idempotent, keeps source files,
  preserves legacy order/IDs, and records an import marker.

- [ ] Define versioned event payloads for user/assistant messages, reasoning,
  tool start/result, command input, terminal output, approvals, questions,
  failures, cancellation, compaction, queued input, and final answer.
- [ ] Persist a full UUID, short compatibility ID, workspace key, parent UUID,
  fork checkpoint, provider/model route, title, lifecycle, and timestamps.
- [ ] Make append operations transactional and monotonic per session; ensure
  UI-facing reads use the same canonical stream rather than a render-only
  projection.
- [ ] Import existing JSONL only after a verified transaction and make a
  second import a no-op.
- [ ] Keep raw events forever by default; implement checkpoint/summary writes
  without deleting raw rows.
- [ ] Update replay, compaction, interruption, and restart paths to rebuild
  the model-facing state from SQLite.
- [ ] Add tests proving commands, tool calls/results, approvals, failures,
  user text, and assistant text survive restart and compaction, including
  concurrent appends and failed provider turns.

## Task 3: Implement separate global and project memory in SQLite

**Files:**

- Modify: `packages/core/src/harness/memory.ts`
- Create: `packages/core/src/harness/memory-repository.ts`
- Create: `packages/core/src/harness/memory-migrations.ts`
- Modify: `packages/core/src/harness/tools.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/memory-repository.test.ts`
- Modify: existing memory tests

**Interfaces:**

- `MemoryScope = "global" | "workspace"`.
- `MemoryRepository.listApplicable(workspaceKey)` returns global records plus
  records for exactly one canonical workspace.
- `remember(content, scope?)` defaults to workspace and accepts global only
  when explicitly requested by the model/tool call.
- Child tool registries omit the write tool and the core boundary rejects a
  child write even if a forged tool call reaches it.

- [ ] Canonicalize project paths with platform-aware case and separator rules;
  never use a display name as the scope key.
- [ ] Add versioned records with kind, tags, confirmation/contradiction state,
  active/deleted state, timestamps, and source metadata.
- [ ] Import existing JSON memory into the matching global/workspace scope,
  preserve source files, retain conflicts, and make import retry-safe.
- [ ] Preserve the existing relevance/confirmation ranking over the SQLite
  records and avoid automatic whole-conversation capture.
- [ ] Add tests for cross-folder isolation, same-folder session sharing,
  global visibility, migration, intentional remember calls, and child write
  denial.

## Task 4: Make `/env` project-scoped and secure at bootstrap

**Files:**

- Modify: `packages/core/src/auth/session-env.ts`
- Modify: `packages/core/src/auth/store.ts`
- Create: `packages/core/src/auth/project-env.ts`
- Create: `packages/core/src/auth/credential-backends.ts`
- Modify: `packages/core/src/container/container.ts`
- Modify: `packages/cli/src/commands/env.ts`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/commands.ts`
- Create/modify: core and CLI environment tests

**Interfaces:**

- `ProjectEnvironmentStore` binds every record to a canonical workspace key.
- Native adapters implement Windows Credential Manager and Linux Secret
  Service; an encrypted local vault is the explicit fallback.
- `bootstrapProjectEnvironment()` returns a controlled environment overlay,
  never a model-visible prompt field.
- `/env` lists names/status only and supports set/remove/inspect without ever
  printing values.

- [ ] Replace session-only scope with project scope while preserving a
  migration path for existing session environment records.
- [ ] Implement testable native backend adapters and inject fake backends in
  tests; use DPAPI/systemd-creds only as compatibility migration paths where
  needed, not as the product's default backend names.
- [ ] Implement a passphrase-unlocked encrypted fallback that never stores the
  passphrase, never writes plaintext, separates project records, and emits a
  reduced-protection warning when active.
- [ ] Load the project overlay during PLIF bootstrap and pass it only to
  controlled providers, child agents, and terminal processes.
- [ ] Redact known values from command/terminal output, history payloads,
  diagnostics, status, and provider-facing context; keep running-process
  environments stable after later `/env` changes.
- [ ] Add tests for same-folder sharing, different-folder rejection, native
  backend selection, fallback unlock/relock, names-only UI, redaction, and
  child inheritance without model visibility.

## Task 5: Add model identity and secret-defense instructions to the harness

**Files:**

- Modify: `packages/core/src/agenting/types.ts`
- Modify: `packages/core/src/harness/prompt.ts`
- Modify: `packages/core/src/harness/loop.ts`
- Modify: `packages/core/src/model/config.ts`
- Modify: `packages/core/src/model/catalog.ts`
- Create: `packages/core/src/harness/security-instructions.ts`
- Create: `packages/core/test/harness-security.test.ts`
- Create/modify: model identity tests

**Interfaces:**

- `PromptContext` carries provider ID, exact model ID, display name, endpoint
  route, and capabilities without credentials.
- `securityInstructions()` is included once in the effective system guidance.

- [ ] Make the agent identify PLIF as its host/orchestrator while answering
  model questions with the configured provider/model route or an honest
  unavailable-metadata answer.
- [ ] Add the approved rule that chat-pasted credentials are compromised and
  must never be used, repeated, transformed, or forwarded; only `/env` values
  are approved for controlled execution.
- [ ] Explicitly forbid exposing secret values through prompts, tool output,
  logs, transcript, previews, or model-generated command text, and require
  revoke/rotate guidance after a user sends one anyway.
- [ ] Ensure the instruction is inherited by the main agent and composed into
  child prompts without copying a competing parent system prompt.
- [ ] Test provider/model identity, missing metadata, secret refusal, and
  absence of environment values from serialized prompt context.

## Task 6: Add the two-stage local `sk_` composer warning

**Files:**

- Create: `packages/cli/src/security/secret-detector.ts`
- Create: `packages/cli/src/components/SecretWarning.tsx`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/composer/history.ts`
- Modify: `packages/cli/src/composer/state.ts`
- Create: `packages/cli/test/secret-detector.test.ts`
- Create/modify: CLI composer/app tests

**Interfaces:**

- `detectDraftSecrets(text)` returns redaction spans and confidence without
  network access.
- `SecretWarning` exposes first-warning and final-warning states with English
  actions: `Cancel and Edit`, `Save Redacted Prompt and Cancel`, and `Send
  Anyway`.

- [ ] Detect high-confidence `sk_` token-like values locally before the first
  provider submission; structure the detector for later bearer/private-key/
  database credential patterns.
- [ ] Implement the approved warning copy and keep the original draft out of
  the clipboard redaction path.
- [ ] Make Enter open the final confirmation, redacted save remove only the
  detected secret and preserve the safe prompt in up-arrow history, and
  explicit send-anyway submit/persist normally without repeated interception.
- [ ] Ensure warning state does not leak the secret into rendered diagnostics
  or test snapshots.
- [ ] Test first warning, final warning, cancel/edit, redacted recovery,
  clipboard behavior, explicit bypass, and multiline prompts.

## Task 7: Add local spellcheck, autocomplete, autocorrect, and emoji text

> Current implementation note (2026-08-29): the shipped composer is
> prediction-only. Spellcheck/fuzzy correction and automatic correction were
> removed; the active path is a local contextual predictor with inline ghost
> text, `Tab` acceptance, and `Enter` submission.

**Files:**

- Modify: `packages/cli/src/configuration.ts`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/composer/state.ts`
- Modify: `packages/cli/src/composer/history.ts`
- Modify: `packages/cli/src/components/Completions.tsx`
- Modify: `packages/cli/src/emoji.ts`
- Create: `packages/cli/src/composer/local-assistance.ts`
- Create: `packages/cli/src/composer/dictionaries/en.json`
- Create/modify: CLI configuration/composer/emoji tests

**Interfaces:**

- Settings are independent: local spellcheck, local autocomplete, automatic
  correction, and language; English is the default.
- `suggestLocal(text, cursor, context)` returns non-mutating ranked
  suggestions.
- `applyLocalSuggestion()` changes only the selected span; `Tab` accepts,
  arrows select, and `Esc` dismisses.

- [ ] Register persisted settings in the existing configuration categories and
  retain compatibility with current config files.
- [ ] Implement CPU/local dictionary, edit-distance, frequency, prompt
  history, command, project vocabulary, and emoji alias ranking without any
  remote draft request.
- [ ] Keep automatic correction disabled by default and block it for commands,
  paths, URLs, code, identifiers, env names, tokens, and secrets.
- [ ] Expand emoji names/aliases and convert selected `:name:` input to normal
  Unicode text sent to the model, never an attachment.
- [ ] Test settings persistence, Tab/arrow/Esc behavior, protected spans,
  offline/local-only behavior, language fallback, and emoji Unicode output.

## Task 8: Implement fork checkpoints and isolated child history

**Files:**

- Modify: `packages/core/src/harness/subagent.ts`
- Modify: `packages/core/src/session/store.ts`
- Modify: `packages/core/src/session/events.ts`
- Modify: `packages/core/src/agenting/types.ts`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/components/Subagents.tsx`
- Modify: `packages/cli/src/components/WorkDock.tsx`
- Create/modify: core and CLI subagent/history tests

**Interfaces:**

- `createForkCheckpoint(parentSessionId)` flushes the parent queue and returns
  a bounded model-facing snapshot with its source sequence.
- `createChildSession({ parentId, checkpoint, task })` creates a new full UUID,
  isolated event bus, history, queue, route, and lifecycle.
- The first child context visibly contains
  `Forked from ID-<parent-full-uuid>`.

- [ ] Build the checkpoint at the latest complete model-facing boundary and
  preserve objective, completed actions, assumptions, IDs, blockers, next
  action, relevant tool calls/results, approvals, and failures.
- [ ] Copy memory as a read-only global/workspace snapshot and omit child
  memory-write tools and parent system prompt duplication.
- [ ] Persist parent UUID/checkpoint metadata and expose only bounded progress,
  completion, final answer, child ID, and history reference to the parent.
- [ ] Make the work dock focus a child and route transcript/history shortcuts
  to that child's own SQLite rows.
- [ ] Test full UUID provenance, bounded fork context, no parent/child event
  mixing, restart/reopen, and child memory write denial.

## Task 9: Add durable child follow-up queues and lane routing

**Files:**

- Modify: `packages/core/src/harness/subagent.ts`
- Modify: `packages/core/src/session/history-repository.ts`
- Modify: `packages/core/src/harness/loop.ts`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/components/Subagents.tsx`
- Create: `packages/core/test/subagent-queue.test.ts`
- Create/modify: CLI queue tests

**Interfaces:**

- `send_message` resolves a child by full/short ID and resumes its persisted
  conversation; it never creates a replacement child.
- `enqueueChildInput()` durably records an input while a child is busy.
- `deliverQueuedInputs()` orders tool calls/results before queued inputs and
  delivers each input exactly once before the next provider request.

- [ ] Serialize one model turn per child and keep parent, child, and terminal
  queues separate.
- [ ] Queue parent follow-ups during tool calls without interrupting the
  in-flight call; preserve enqueue order and visible pending state.
- [ ] Include queued user events in the child history and recover pending
  delivery after process restart without duplication.
- [ ] Keep completed child views available for later `send_message` and record
  explicit cancellation without deleting history.
- [ ] Test multiple follow-ups, tool-boundary delivery, restart recovery,
  short-ID compatibility, duplicate prevention, and parent transcript purity.

## Task 10: Add persistent PTY/ConPTY terminal sessions

**Files:**

- Modify: `packages/sandbox/src/backend.ts`
- Modify: `packages/sandbox/src/linux/backend.ts`
- Modify: `packages/sandbox/src/win32/backend.ts`
- Modify: `packages/sandbox/src/portable/backend.ts`
- Modify: `packages/sandbox/src/index.ts`
- Modify: `packages/core/src/container/container.ts`
- Create: `packages/core/src/container/terminal-session.ts`
- Modify: tool registration files and `packages/core/src/index.ts`
- Create/modify: sandbox/core terminal tests

**Interfaces:**

- `TerminalSession.start`, `.write`, `.read`, `.resize`, `.signal`, and
  `.close` expose one lifecycle across Linux PTY and Windows ConPTY.
- Every terminal has an owning session UUID/container ID and bounded output
  chunks.

- [ ] Preserve buffered stdin for simple commands while adding a persistent
  terminal API with Linux PTY support and Windows ConPTY support.
- [ ] Implement output streaming, exit/interruption state, resize, supported
  interrupt/signal behavior, and cleanup when PLIF exits.
- [ ] Route terminal input only to its owning lane; reject parent/child or
  cross-container terminal IDs.
- [ ] Apply execution policy at terminal start, avoid automated sudo/private
  credential authentication, inherit controlled `/env` values, and redact
  output before persistence/model delivery.
- [ ] Test echo/password-like prompts, partial output, resize, interrupt,
  process exit, cleanup, ownership, redaction, and portable fallback errors on
  both platform backends.

## Task 11: Build the isolated Rust NPM updater

**Files:**

- Create: `updater/Cargo.toml`
- Create: `updater/src/main.rs`
- Create: `updater/src/npm.rs`
- Create: `updater/src/install.rs`
- Create: `updater/src/verify.rs`
- Create: `packages/cli/assets/updater/<platform>-<arch>/plif-updater[.exe]`
  during release only
- Modify: `packages/core/src/update/check.ts`
- Create: `packages/core/src/update/changelog.ts`
- Create: `packages/core/src/update/preferences.ts`
- Create/modify: update tests

**Interfaces:**

- Rust updater args carry package name, exact target version, NPM registry,
  current executable/entrypoint, package integrity, and relaunch data.
- TypeScript update service performs nonblocking NPM checks and hands one
  approved exact-version update to the detached updater.

- [ ] Extend NPM metadata handling to resolve the exact tarball/integrity and
  package `CHANGELOG.md`; reject missing/unversioned changelog sections.
- [ ] Check at startup and every six hours without blocking the agent; failed
  or offline checks stay silent and retry later.
- [ ] Add per-target-version `Don't ask again`, `Later`, and update preference
  persistence plus safe-turn shutdown before spawning the updater.
- [ ] Implement Rust verification, exact `npm install -g @plif/cli@<version>`
  execution, result verification, detached relaunch, and failure reporting
  that leaves the existing install usable.
- [ ] Keep the updater independent of Node internals and never consult Git or
  GitHub for version/changelog data.
- [ ] Cross-compile and smoke-test Windows x64/ARM64 and Linux x64/ARM64;
  add unit tests for argument validation, version mismatch, unavailable NPM,
  failed install, and successful relaunch contract.

## Task 12: Finish installers, package contents, and release automation

**Files:**

- Modify: `install.ps1`
- Create: `install.sh`
- Modify: `scripts/prepack.mjs`
- Modify: `packages/cli/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: root `CHANGELOG.md`
- Create/modify: packaging/install smoke tests

**Interfaces:**

- PowerShell and Bash installers share the same NPM install behavior and
  English setup/preflight output.
- The package contains `CHANGELOG.md`, the correct updater asset, and no
  foreign platform updater.

- [ ] Keep `npm install -g @plif/cli@latest` as the documented primary path.
- [ ] Add Node preflight, NPM install, notification preference prompt with an
  enabled default, and actionable offline/permission failures to both scripts.
- [ ] Make prepack copy the canonical root changelog and selected Rust asset;
  fail if the target version is absent or an asset is missing.
- [ ] Add release matrix jobs for Rust targets, package assembly, changelog
  validation, tarball inspection, and NPM publish ordering.
- [ ] Keep package version/changelog text aligned with the approved 0.4.0
  entries already present in the worktree; do not erase unrelated edits.
- [ ] Document project-scoped memory/env, child history, local assistance,
  secret warnings, and NPM-only updates in English.

## Task 13: Integrate migration, recovery, and end-to-end validation

**Files:**

- Modify only the affected files discovered by integration tests.
- Create: `packages/core/test/recovery.integration.test.ts`
- Create: `packages/cli/test/release-smoke.test.ts`

- [ ] Run legacy JSONL and JSON memory migration against copied fixtures and
  verify sources remain recoverable.
- [ ] Run a restart scenario with a parent, child, queued follow-up, tool
  failure, terminal output, compaction checkpoint, and resumed history.
- [ ] Verify different project folders cannot read one another's memory or
  environment values while same-folder sessions can share them.
- [ ] Verify a secret draft follows both warnings, redacted recovery never
  copies the original, and send-anyway does not authorize harness use.
- [ ] Verify model identity answers use the exact configured route.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build` for all workspaces.
- [ ] Run package dry-runs for Windows/Linux and inspect `CHANGELOG.md`, the
  updater asset, and CLI entrypoint in the generated tarball.
- [ ] Run focused installer/updater/sandbox tests on each native target and
  record any unsupported local target as a CI-only check rather than silently
  skipping it.

## Verification commands

```powershell
npm test
npm run typecheck
npm run build
npm pack --workspace @plif/cli --dry-run
cargo test --manifest-path updater/Cargo.toml
git diff --check
```

The implementation is complete only when the acceptance criteria in
`docs/superpowers/specs/2026-08-29-plif-0-4-0-design.md` are demonstrable and
the root `CHANGELOG.md` remains present in the published CLI package.
