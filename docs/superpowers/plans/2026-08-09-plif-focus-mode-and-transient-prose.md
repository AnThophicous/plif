# Plif Focus Mode and Transient Prose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Plif effort mode a focused blue-violet terminal identity while removing clipped pre-tool prose from user-facing output without breaking tool-call protocol history.

**Architecture:** The core loop classifies model prose at the tool boundary and emits an explicit lifecycle event; it keeps the raw assistant message for the next model request but excludes all pre-tool prose from the visible aggregate. The CLI consumes that event to retire clipped provisional answer rows or fold complete prose into compact activity, then concentrates Plif visual motion in a gradient prompt frame, attached lower status dock, and task/subagent-only upper work dock.

**Tech Stack:** TypeScript, React, Ink, Node test runner, existing `@plif/core` event bus and CLI theme/pulse utilities.

## Global Constraints

- Keep raw SSE decoding owned by the OpenAI SDK; do not replace or fork it.
- Preserve assistant content and tool-call ordering in `LoopResult.messages` exactly as needed for the next provider request.
- Restrict moving blue-violet gradient treatment to Plif-focused live chrome; completed answers remain neutral and readable.
- Use terminal glyphs and coloured text only; add no bitmap renderer or dependency for the mascot.
- Respect narrow terminals and the existing frame-height guard so Ink never reprints scrollback.
- Do not commit, push, publish, or reset the dirty worktree without separate user authorization.
- Use PowerShell-compatible verification commands on Windows.

---

## File Structure

- `packages/core/src/events/bus.ts` — typed `agent.pre_tool_prose` lifecycle event shared by loop and CLI.
- `packages/core/src/harness/loop.ts` — classification of clipped and complete pre-tool prose; visible-result aggregation policy.
- `packages/core/test/queue.test.ts` — scripted model regression for tool-boundary prose and retained protocol history.
- `packages/cli/src/components/FocusFrame.tsx` — pure, terminal-safe blue-violet gradient rule and animated infinity glyph.
- `packages/cli/src/components/Prompt.tsx` — Plif input frame integration without changing keyboard editing semantics.
- `packages/cli/src/components/PlifDock.tsx` — compact lower dock for workspace, effort, context, and working infinity state.
- `packages/cli/src/components/WorkDock.tsx` — upper dock that appears only for active tasks or subagents.
- `packages/cli/src/app.tsx` — lifecycle event consumer, dock wiring, chrome height accounting, and removal of the broad header/task/subagent layout.
- `packages/cli/test/pre-tool-prose.test.ts` — reducer/lifecycle UI behavior for provisional answer retirement.
- `packages/cli/test/focus-frame.test.ts` — gradient segments, ASCII fallback, infinity frames, dock visibility, and narrow-width projections.

## Interfaces

```ts
// packages/core/src/events/bus.ts
'agent.pre_tool_prose': {
  iteration: number;
  text: string;
  visibility: 'transient' | 'activity';
};

// packages/core/src/harness/loop.ts
export function classifyPreToolProse(
  text: string,
  requestedTools: number,
): 'transient' | 'activity' | null;

// packages/cli/src/components/FocusFrame.tsx
export function focusRule(width: number, elapsedMs: number, active: boolean): readonly FocusCell[];
export function infinityFrame(elapsedMs: number, active: boolean): string;

// packages/cli/src/components/PlifDock.tsx
export function PlifDock(props: {
  cwd: string;
  effort?: string;
  contextUsed: number;
  contextMax: number;
  working: boolean;
  width: number;
}): React.ReactElement | null;

// packages/cli/src/components/WorkDock.tsx
export function WorkDock(props: {
  tasks: readonly TaskSnapshot[];
  subagents: readonly SubagentView[];
  subagentFocus: number;
  expanded: boolean;
  width: number;
  now: number;
}): React.ReactElement | null;
```

### Task 1: Classify and hide transient pre-tool prose in the core loop

**Files:**
- Modify: `packages/core/src/events/bus.ts`
- Modify: `packages/core/src/harness/loop.ts`
- Modify: `packages/core/test/queue.test.ts`

**Consumes:** `endsMidSentence(text)`, `EventBus`, the existing scripted provider helper, and `LoopResult.messages`.

**Produces:** `classifyPreToolProse`, `agent.pre_tool_prose`, and a visible aggregate that excludes pre-tool prose.

- [ ] **Step 1: Write the failing loop regression**

```ts
it('keeps clipped pre-tool prose in protocol history but hides it from the visible answer', async () => {
  const bus = new EventBus();
  const events: PlifEvents['agent.pre_tool_prose'][] = [];
  bus.on('agent.pre_tool_prose', (event) => events.push(event));
  const result = await runLoop([{ role: 'user', content: 'go' }], {
    provider: scripted([
      [
        { kind: 'text', delta: 'Vou conferir o contrato antes de' },
        { kind: 'tool', call: { id: 'c1', name: 'ping', arguments: '{}' } },
        { kind: 'done', reason: 'tool_calls', usage: { promptTokens: 0, completionTokens: 0 } },
      ],
      finalTurn,
    ]),
    container,
    questions: new QuestionBroker(bus, 50),
    bus,
    tools: [noopTool],
  });

  assert.equal(result.text, 'done');
  assert.equal(result.messages.find((message) => message.role === 'assistant')?.content, 'Vou conferir o contrato antes de');
  assert.deepEqual(events, [{ iteration: 1, text: 'Vou conferir o contrato antes de', visibility: 'transient' }]);
});
```

- [ ] **Step 2: Run the focused test to verify the current failure**

Run:

```powershell
node --import tsx --test packages/core/test/queue.test.ts
```

Expected: the test fails because the clipped preamble is currently appended to `result.text` and no lifecycle event exists.

- [ ] **Step 3: Add the typed event and pure classifier**

```ts
export function classifyPreToolProse(text: string, requestedTools: number): 'transient' | 'activity' | null {
  const normalized = text.trim();
  if (!normalized || requestedTools === 0) return null;
  return endsMidSentence(normalized) ? 'transient' : 'activity';
}
```

Emit `agent.pre_tool_prose` immediately after the provider stream closes and before the assistant message is appended to `messages`. Keep the original `turnText` in that assistant message. Delete the old `warnedClippedProse` log path entirely.

- [ ] **Step 4: Change visible aggregation only**

```ts
const preToolVisibility = classifyPreToolProse(turnText, requested.length);
if (preToolVisibility) {
  options.bus.emit('agent.pre_tool_prose', { iteration: iterations, text: turnText, visibility: preToolVisibility });
}
if (preToolVisibility === null) keepTurnText();
```

Do not alter the assistant entry appended to `messages`, its `toolCalls`, or the next provider request.

- [ ] **Step 5: Run the focused regression and related core tests**

Run:

```powershell
node --import tsx --test packages/core/test/queue.test.ts packages/core/test/retry.test.ts packages/core/test/model.test.ts
```

Expected: the new regression passes; tool-call history and existing stream tests remain green.

### Task 2: Retire provisional pre-tool rows in the TUI

**Files:**
- Modify: `packages/cli/src/app.tsx`
- Create: `packages/cli/test/pre-tool-prose.test.ts`

**Consumes:** `agent.pre_tool_prose`, `agentRow`, `agentText`, `stream`, the existing session reducer, and `entry`.

**Produces:** a single app-local `settlePreToolProse` callback that drops clipped live prose or folds complete pre-tool text into an activity row.

- [ ] **Step 1: Write reducer-level tests for both visibility modes**

```ts
it('drops a transient provisional answer instead of committing it', () => {
  const provisional = entry('answer', 'Vou verificar o arquivo', { status: 'active' });
  const state = sessionReducer(initialSession, { type: 'append', entry: provisional });
  const next = sessionReducer(state, { type: 'drop', id: provisional.id });
  assert.equal(next.entries.length, 0);
});

it('folds complete pre-tool prose into a faint activity row', () => {
  const provisional = entry('answer', 'Vou verificar o arquivo.', { status: 'active' });
  const state = sessionReducer(initialSession, { type: 'append', entry: provisional });
  const next = sessionReducer(state, {
    type: 'update',
    id: provisional.id,
    patch: { kind: 'step', title: 'Preparing', detail: 'Vou verificar o arquivo.', tone: 'faint', status: 'done' },
  });
  assert.equal(next.entries[0]?.kind, 'step');
  assert.equal(next.entries[0]?.tone, 'faint');
});
```

- [ ] **Step 2: Run the new UI test to prove the expected state is absent**

Run:

```powershell
node --import tsx --test packages/cli/test/pre-tool-prose.test.ts
```

Expected: FAIL because the test file and lifecycle callback do not exist yet.

- [ ] **Step 3: Implement `settlePreToolProse` in `App`**

```ts
const settlePreToolProse = useCallback((visibility: 'transient' | 'activity') => {
  const id = agentRow.current;
  const text = agentText.current.trim();
  agentRow.current = null;
  agentText.current = '';
  stream.current = { rowId: null, text: '', dirty: false };
  if (!id) return;
  if (visibility === 'transient') {
    dispatch({ type: 'drop', id });
    return;
  }
  dispatch({ type: 'update', id, patch: { kind: 'step', title: 'Preparing', detail: text, tone: 'faint', status: 'done' } });
}, []);
```

Subscribe to `agent.pre_tool_prose` before the `agent.tool` listener. It must settle the live row before tool rows open, and the normal end-of-turn `closeAnswer` must then become a no-op.

- [ ] **Step 4: Ensure transient prose is never recorded as an assistant transcript entry**

Keep the existing `if (result.text) record(...)` guard. Because Task 1 removes transient text from `result.text`, no special transcript mutation is needed. Confirm no fallback answer is pushed when the live row was dropped.

- [ ] **Step 5: Run focused CLI tests**

Run:

```powershell
node --import tsx --test packages/cli/test/pre-tool-prose.test.ts packages/cli/test/frame.test.ts packages/cli/test/thinking.test.ts
```

Expected: activity and transient paths pass without changing frame-height behaviour.

### Task 3: Build the focused Plif prompt frame and lower status dock

**Files:**
- Create: `packages/cli/src/components/FocusFrame.tsx`
- Modify: `packages/cli/src/components/Prompt.tsx`
- Create: `packages/cli/src/components/PlifDock.tsx`
- Modify: `packages/cli/src/app.tsx`
- Create: `packages/cli/test/focus-frame.test.ts`

**Consumes:** `palette`, `toneBetween`, `useHighlightClock`, `shortenPath`, `Meter`, current prompt state, and effort state.

**Produces:** terminal-safe moving gradient rules, a stable infinity mark, a Plif-only prompt frame, and one compact lower dock.

- [ ] **Step 1: Write pure visual utility tests**

```ts
it('fills a focused rule to the requested terminal width', () => {
  const rule = focusRule(42, 480, true);
  assert.equal(rule.map((cell) => cell.text).join('').length, 42);
  assert.ok(new Set(rule.map((cell) => cell.color)).size > 1);
});

it('keeps idle infinity stable and working infinity animated', () => {
  assert.equal(infinityFrame(0, false), infinityFrame(1_000, false));
  assert.notEqual(infinityFrame(0, true), infinityFrame(400, true));
});
```

- [ ] **Step 2: Run the focus-frame test to verify it fails**

Run:

```powershell
node --import tsx --test packages/cli/test/focus-frame.test.ts
```

Expected: FAIL because `FocusFrame` utilities and dock projections do not exist.

- [ ] **Step 3: Implement gradient and infinity primitives**

```tsx
export function FocusRule({ width, active }: { width: number; active: boolean }): React.ReactElement {
  const elapsed = useHighlightClock(active, 64);
  return <Text>{focusRule(width, elapsed, active).map((cell, index) => <Text key={index} color={cell.color}>{cell.text}</Text>)}</Text>;
}
```

Generate colour progression from the active Midnight palette through `toneBetween('brand', 'accentBright', ratio)`. Use `∞` when rich glyphs are available and an ASCII fallback such as `oo` otherwise. The frame must have fixed character width on every animation tick.

- [ ] **Step 4: Integrate the focused frame into `Prompt`**

Add `plif?: boolean` and `working?: boolean` to `PromptProps`. In Plif mode, replace the uniform `Box` border with `FocusRule` top/bottom rows and narrow side rails; retain the existing non-Plif `borderStyle="round"` path byte-for-byte. Place the infinity mark in the right edge without reducing editable text below the existing minimum width.

- [ ] **Step 5: Add the lower dock and wire it from `App`**

`PlifDock` renders only when `effort === 'plif'`. At normal widths it emits one row equivalent to:

```text
∞ working  ·  ~/project  ·  Plif  ·  Context [####··]
```

At narrow widths it keeps the infinity and context meter, then drops project detail before effort. Render it directly under `Prompt`; pass `state.busy`, `cwd`, `state.contextUsed`, and `state.contextMax` from `App`.

- [ ] **Step 6: Run focused prompt and frame tests**

Run:

```powershell
node --import tsx --test packages/cli/test/focus-frame.test.ts packages/cli/test/input.test.ts packages/cli/test/thinking.test.ts
```

Expected: gradient, infinity, narrow fallback, editing layout, and existing thinking behaviours pass.

### Task 4: Consolidate active work into the upper dock and finish integration

**Files:**
- Create: `packages/cli/src/components/WorkDock.tsx`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/components/Subagents.tsx`
- Modify: `packages/cli/src/components/TaskPanel.tsx`
- Modify: `packages/cli/test/frame.test.ts`
- Modify: `packages/cli/test/focus-frame.test.ts`

**Consumes:** `TaskSnapshot`, `SubagentView`, current expansion/focus state, `TaskPanel`, and `Subagents` detail rows.

**Produces:** an upper dock absent at rest, automatically expanded on active task or subagent work, with embedded detail views that do not duplicate headings.

- [ ] **Step 1: Write visibility and chrome-height regressions**

```ts
it('renders no work dock when neither tasks nor subagents are active', () => {
  assert.equal(workDockHeight([], [], false), 0);
});

it('reserves compact and expanded rows for active work', () => {
  assert.ok(workDockHeight([runningTask], [], true) > workDockHeight([runningTask], [], false));
});
```

Add a frame-budget assertion that includes `workDockHeight` and `plifDockHeight`, preserving the spare-line invariant used by `terminalFrameRows`.

- [ ] **Step 2: Run the visibility test to verify it fails**

Run:

```powershell
node --import tsx --test packages/cli/test/focus-frame.test.ts packages/cli/test/frame.test.ts
```

Expected: FAIL because `WorkDock` and its height projection are absent.

- [ ] **Step 3: Implement `WorkDock` and embedded detail modes**

```tsx
export function WorkDock({ tasks, subagents, expanded, width, now }: WorkDockProps): React.ReactElement | null {
  if (tasks.length === 0 && subagents.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1}>
      <WorkDockSummary tasks={tasks} subagents={subagents} />
      {expanded && <WorkDockDetails tasks={tasks} subagents={subagents} width={width} now={now} />}
    </Box>
  );
}
```

Add `embedded?: boolean` to `Subagents` and `TaskPanel` so the dock can reuse their operational rows without a second header or close instruction. Open the dock automatically whenever there is active work; preserve existing keyboard shortcuts for manually collapsing or expanding details.

- [ ] **Step 4: Replace broad chrome in `App`**

Remove the general `Header`, standalone `TaskIndicator`, standalone `TaskPanel`, and standalone `Subagents` placements from the normal screen route. Render `WorkDock` at the upper edge only when there is active work. Keep browser mode isolated as it is today.

Update chrome budgeting with `workDockHeight` and `plifDockHeight`; ensure the live frame retains its three spare lines.

- [ ] **Step 5: Run the complete verification set**

Run:

```powershell
cmd /c npm run typecheck
node --import tsx --test --test-concurrency=8 packages/core/test/*.test.ts packages/sandbox/test/*.test.ts packages/cli/test/*.test.ts
git diff --check
```

Expected: typecheck exits `0`; all tests pass; diff check reports no whitespace errors. If the Windows sandbox cannot resolve `os.userInfo`, use the existing test-runner compatibility shim only for the test invocation and document that environmental constraint.

## Plan Self-Review

### Spec coverage

- Focused Plif gradient, infinity, mascot-derived terminal mark, lower dock, narrow-terminal behavior: Task 3.
- Task/subagent-only upper dock with auto-open detail: Task 4.
- Removal of warning and clipped pre-tool text while preserving protocol history: Tasks 1 and 2.
- SSE parser remains untouched and existing stream tests remain covered: Tasks 1 and 4.
- Full validation: Task 4.

### Placeholder scan

No `TODO`, `TBD`, unspecified test, undefined interface, or implicit commit step remains. Exact files, interfaces, test cases, commands, and expected outcomes are included.

### Type consistency

`agent.pre_tool_prose.visibility`, `classifyPreToolProse`, `FocusCell`, `focusRule`, `infinityFrame`, `PlifDock`, and `WorkDock` are declared before tasks consume them. Core stays independent of CLI components.
