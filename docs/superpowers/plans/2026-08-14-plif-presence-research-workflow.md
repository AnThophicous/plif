# Plif Presence, Research, and Engineering Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `effort=plif` into a high-presence, theme-native working state and a rigorous agent workflow with deep research, reliable tool use, disciplined subagent orchestration, persistent planning, review, and audit.

**Architecture:** Keep the terminal geometry stable and drive every Plif visual effect from the existing shared animation clock and semantic theme palette. Extend Markdown instruction routing so specialist prompt modules load only when their owning tools exist, then add a batch research tool and paged/focused source reader. Preserve the existing runtime Plan -> Work -> Review gates and make the Plif prompt add a durable Markdown plan plus orchestrator-worker and evaluator-optimizer loops.

**Tech Stack:** TypeScript 5.7, React 18, Ink 5, Node test runner, Markdown prompt modules, DuckDuckGo search, Jina Reader.

## Global Constraints

- The principal agent authors every prompt module; delegated agents may map or implement non-prompt code only.
- Every delegated agent uses `gpt-5.6-luna` with reasoning effort `max`.
- Preserve every pre-existing dirty-worktree change and do not commit, stage, reset, publish, or deploy.
- Plif animation changes colour only: glyphs, text, width, height, wrapping, and component geometry stay stable between frames.
- `ready` remains static. Continuous animation is allowed only while genuine foreground or background work is active.
- Use one shared 180 ms clock; add no component-local animation intervals.
- Derive animation colours exclusively from the active theme's semantic palette. Selecting Plif must not force Midnight or hard-coded Plif colours.
- Research snippets are discovery leads, never final evidence. Factual synthesis must use opened sources and preserve provenance.
- Compaction must preserve the current workflow phase, plan path, unfinished checkpoints, source ledger, delegated work, failures, and next action.
- Prompt modules must not emit emoji and must not weaken authority, approval, sandbox, or mutation boundaries.

---

### Task 1: Tool-aware Markdown instruction routing

**Files:**
- Modify: `packages/core/src/agenting/instruction-loader.ts`
- Modify: `packages/core/src/agenting/compiler.ts`
- Modify: `packages/core/test/prompt.test.ts`

**Interfaces:**
- Produces: `MarkdownInstruction.tools: readonly string[] | undefined` parsed from `tools=name1,name2`.
- Produces: compiler selection in which every declared tool name must exist in `PromptContext.tools`.
- Consumes: existing `ToolSpec.name` values and static `modes`/`effort` filters.

- [x] **Step 1: Write the failing routing tests**

```ts
const withoutResearch = buildSystemPrompt({ ...base, tools: [] });
const withResearch = buildSystemPrompt({
  ...base,
  tools: [{ name: 'research', description: 'Batch research.', parameters: {} }],
});
assert.doesNotMatch(withoutResearch, /Research operating protocol/);
assert.match(withResearch, /Research operating protocol/);
```

- [x] **Step 2: Run the prompt test and confirm it fails because tool-qualified Markdown is not supported**

Run: `node --import tsx --test packages/core/test/prompt.test.ts`

- [x] **Step 3: Parse and apply the tool requirement**

```ts
export interface MarkdownInstruction {
  readonly tools: readonly string[] | undefined;
}

const tools = metadata.get('tools')?.split(',').filter(Boolean);

const available = new Set(context.tools?.map((tool) => tool.name) ?? []);
.filter((module) => module.tools?.every((name) => available.has(name)) ?? true)
```

- [x] **Step 4: Cover the boundary cases**

Test deterministic ordering, combined `modes + effort + tools`, missing tools, and compaction isolation.

- [x] **Step 5: Run the focused tests**

Run: `node --import tsx --test packages/core/test/prompt.test.ts`

---

### Task 2: Principal-authored mastery prompts

**Files:**
- Create: `packages/core/src/agenting/instructions/20-runtime/tool-mastery.md`
- Create: `packages/core/src/agenting/instructions/20-runtime/research.md`
- Create: `packages/core/src/agenting/instructions/20-runtime/subagenting.md`
- Modify: `packages/core/src/agenting/instructions/20-runtime/plif-effort.md`
- Modify: `packages/core/src/agenting/instructions/10-modes/subagent.md`
- Modify: `packages/core/src/agenting/instructions/10-modes/compaction.md`
- Modify: `packages/core/test/prompt.test.ts`

**Interfaces:**
- `tool-mastery.md`: global non-compaction protocol for schema binding, dependency ordering, result interpretation, recovery, authority, and verification.
- `research.md`: `tools=research` module for query planning, source selection, opening evidence, contradiction handling, citation, prompt-injection defense, and stopping criteria.
- `subagenting.md`: `modes=primary tools=subagent` manager-worker contract.
- `plif-effort.md`: `effort=plif` engineering workflow and durable plan contract.
- `subagent.md`: bounded worker execution and evidence handoff contract.
- `compaction.md`: continuity requirements for workflow and research state.

- [x] **Step 1: Add failing prompt-contract tests**

```ts
assert.match(plif, /durable Markdown execution plan/i);
assert.match(plif, /design review/i);
assert.match(plif, /evaluator.*optimizer/is);
assert.match(research, /query matrix/i);
assert.match(research, /contradict/i);
assert.match(research, /opened source/i);
assert.match(primaryWithSubagent, /orchestrator.*worker/is);
assert.doesNotMatch(childWithoutSubagentTool, /delegate another agent/i);
```

- [x] **Step 2: Run the tests and confirm the missing contracts fail**

Run: `node --import tsx --test packages/core/test/prompt.test.ts`

- [x] **Step 3: Author `tool-mastery.md`**

Include the operational loop below with concrete branch behavior, not motivational prose:

```text
classify intent -> choose owning tool -> bind exact schema -> order dependencies
-> check authority and mutation risk -> execute -> interpret status and payload
-> update beliefs -> recover with a changed hypothesis -> verify the actual claim
```

Cover invalid arguments, permissions, unavailable tools, empty valid results, partial/truncated output, timeouts, cancellation, retries, idempotency, parallel-safe calls, quoting/path spaces, and output-to-claim matching.

- [x] **Step 4: Author `research.md`**

Define a repeatable research process:

```text
frame the decision and claims
-> build a query matrix (direct, official, current, disconfirming)
-> run batch discovery
-> select sources by authority, independence, recency, and directness
-> open and page/focus each source
-> maintain a claim/source ledger
-> resolve contradictions and negative claims
-> run a coverage audit
-> synthesize with citations and explicit uncertainty
```

- [x] **Step 5: Author the Plif and subagent workflows**

For every authorized build/change request in Plif mode, require one durable plan under `.plif/plans/`, an `update_plan` call, repository reconnaissance, design and risk review, independent subagent sectioning where useful, implementation against the plan, plan updates at checkpoints, focused and broad testing, changed-file review, adversarial audit, correction loop, and evidence-backed handoff. Keep read-only, explanation, and review requests non-mutating.

- [x] **Step 6: Strengthen compaction continuity**

Require the capsule to preserve the exact plan path, current phase, acceptance criteria, changed files, validation status, research source ledger, subagent ownership/results, rejected paths, failures, and precise next action.

- [x] **Step 7: Run prompt tests and the no-emoji invariant**

Run: `node --import tsx --test packages/core/test/prompt.test.ts`

---

### Task 3: Deep Research tool and navigable source reader

**Files:**
- Modify: `packages/core/src/web/tools.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/web.test.ts`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/format.ts`
- Modify: `packages/cli/test/format.test.ts`

**Interfaces:**
- Produces: exported `research: Tool`, included in `WEB_TOOLS`.
- Input: `{ objective: string, queries: Array<{ query: string; purpose: string }>, max_results_per_query?: number, region?: string }`.
- Produces: grouped, numbered, deduplicated discovery output with query purpose, source URL, snippet, blocked/empty distinction, and coverage summary.
- Extends: `web_fetch` with optional `focus`, `offset`, and `max_chars`, preserving the old `{ url }` behavior.

- [x] **Step 1: Write failing tests for validation and formatting**

```ts
assert.rejects(() => research.run({ objective: 'x', queries: [] }, context));
assert.match(batchOutput, /Objective:/);
assert.match(batchOutput, /Query 1.*purpose/is);
assert.match(batchOutput, /Coverage/);
```

- [x] **Step 2: Write failing source-navigation and safety tests**

```ts
assert.match(page.output, /Source: https:\/\/example\.test\/doc/);
assert.match(page.output, /Characters 1000-1999 of/);
assert.equal(await webFetch.run({ url: 'https://user:secret@example.test' }, context).then(r => r.ok), false);
```

- [x] **Step 3: Implement batch discovery**

Authorize search hosts once, normalize and deduplicate 1-6 query objects, execute independent searches with `Promise.all`, preserve query order in output, and propagate cancellation rather than converting it to an empty/blocked result.

- [x] **Step 4: Implement focused and paged fetch output**

Reject URL credentials, bound integer inputs, include the canonical source URL and character range, center a window around `focus` when found, and say explicitly when the focus term is absent. Bound response memory rather than downloading an unlimited body before clipping.

- [x] **Step 5: Keep Research results expressive in the CLI**

Recognize both `web_search` and `research` completion output and parse stable numbered hits without confusing query headings, related links, or summaries for ranked sources.

- [x] **Step 6: Run focused tests**

Run: `node --import tsx --test packages/core/test/web.test.ts packages/cli/test/format.test.ts packages/core/test/prompt.test.ts`

---

### Task 4: Theme-native Plif chromatic reactor

**Files:**
- Modify: `packages/cli/src/pulse.ts`
- Create: `packages/cli/src/components/PlifGlow.tsx`
- Modify: `packages/cli/src/components/FocusFrame.tsx`
- Modify: `packages/cli/src/components/Prompt.tsx`
- Modify: `packages/cli/src/components/PlifDock.tsx`
- Modify: `packages/cli/src/components/Meter.tsx`
- Modify: `packages/cli/src/components/Spinner.tsx`
- Modify: `packages/cli/src/theme.ts`
- Modify: `packages/cli/src/main.tsx`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/test/focus-frame.test.ts`
- Modify: `packages/cli/test/prompt.test.ts`
- Modify: `packages/cli/test/themes.test.ts`
- Modify: `packages/cli/dev/preview.mts`

**Interfaces:**
- Produces: pure multi-stop semantic colour wave helpers in `pulse.ts`.
- Produces: `PlifGlow` text renderer that preserves grapheme content and display width.
- Extends: `Prompt`, `FocusFrame`, `PlifDock`, and `Meter` with explicit Plif-active colour behavior.
- Preserves: `animationClockActive()` as the sole application clock gate.

- [x] **Step 1: Write failing invariants for colour-only motion**

```ts
assert.equal(plifGlowCells('typed command', 0).map(c => c.text).join(''), 'typed command');
assert.equal(plifGlowCells('typed command', 900).map(c => c.text).join(''), 'typed command');
assert.notDeepEqual(plifGlowCells('typed command', 0), plifGlowCells('typed command', 900));
```

Also assert unchanged display width, active-theme palette use, and no animation clock for idle Plif.

- [x] **Step 2: Implement the Chromatic Reactor visual direction**

Use counter-moving semantic colour waves across the top/bottom frame, breathing side walls, glowing prompt glyph and input/placeholder text, active status line, Infinity mark, context meter, and working marker. Keep glyph strings and layout constant between frames.

- [x] **Step 3: Preserve the selected theme**

Remove automatic Midnight selection in startup and `/effort plif`; remove the hard-coded Plif accent override. Continue to use `brand`, `accentDim`, `accent`, and `accentBright` from the current theme.

- [x] **Step 4: Keep ordinary efforts calm**

Pass an explicit `plif` variant. Non-Plif busy animation retains its current restrained behavior; idle Plif remains static.

- [x] **Step 5: Add visual preview scenarios**

Add `working-plif`, `thinking-plif`, and `compact-plif`, using fake bus events rather than network/model calls. Measure 40x12, 60x20, and 96x40.

- [x] **Step 6: Run focused tests and previews**

Run:

```powershell
node --import tsx --test packages/cli/test/animation-activity.test.ts packages/cli/test/focus-frame.test.ts packages/cli/test/prompt.test.ts packages/cli/test/themes.test.ts packages/cli/test/thinking.test.ts
node --import tsx packages/cli/dev/preview.mts 96 working-plif 40
node --import tsx packages/cli/dev/preview.mts 60 thinking-plif 20
node --import tsx packages/cli/dev/preview.mts 40 compact-plif 12
```

Every preview must report `0 full repaints` and `0 over-wide lines`.

---

### Task 5: User-facing documentation and integration audit

**Files:**
- Modify: `README.md`
- Inspect: every file changed by Tasks 1-4

**Interfaces:**
- Documents: Research versus `web_search` versus `web_fetch`.
- Documents: Plif effort workflow, persistent plan, subagents, auto-compaction continuity, and theme-native active animation.

- [x] **Step 1: Add concise README sections with real tool contracts**

```text
research = parallel discovery map
web_search = one narrow query
web_fetch = opened-source evidence with focus/pagination
```

- [x] **Step 2: Inspect the combined diff for prompt contradictions and accidental scope**

Check authority order, compaction isolation, tool availability filters, prompt size, no emoji, no hard-coded Plif colour, no per-component timers, and preserved dirty-worktree changes.

- [x] **Step 3: Run focused integration checks**

Run:

```powershell
node --import tsx --test packages/core/test/prompt.test.ts packages/core/test/web.test.ts packages/core/test/cycle.test.ts packages/cli/test/format.test.ts packages/cli/test/animation-activity.test.ts packages/cli/test/focus-frame.test.ts packages/cli/test/prompt.test.ts packages/cli/test/themes.test.ts
```

- [x] **Step 4: Run complete verification after the final edit**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

- [x] **Step 5: Perform final adversarial review**

Review correctness, security, reliability, Windows repaint behavior, prompt conflicts, tool-schema ambiguity, cancellation, context growth, and documentation accuracy. Any important finding returns to the owning task for correction and fresh verification.

## Final Verification Evidence

- Focused regression set: 125 tests passed.
- Complete workspace suite: 856 tests passed, 0 failed, 0 skipped.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `working-plif` at 96x40: 0 full repaints, 0 over-wide lines.
- `thinking-plif` at 60x20: 0 full repaints, 0 over-wide lines.
- `compact-plif` at 40x12: 0 full repaints, 0 over-wide lines.
- `git diff --check`: clean apart from Git's existing LF-to-CRLF notices.
