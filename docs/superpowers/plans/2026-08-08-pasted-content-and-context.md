# Pasted Content Attachments and DeepSeek Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Send every clipboard paste fully to the model while rendering only compact paste markers, support multiline input, and use the default model's 1,000,000-token context window.

**Architecture:** Core messages gain a text-or-image attachment union and the OpenAI provider serializes each complete payload as a content part. The CLI owns one ordered attachment tray for clipboard text and images, including messages queued while an agent is running. A pure prompt-row layout function replaces horizontal clipping.

**Tech Stack:** TypeScript, React, Ink, Node.js test runner, OpenAI-compatible Chat Completions SDK.

## Global Constraints

- Every paste displays as [Pasted Content #N - X Lines]; N is session-sequential and image-only content has 0 lines.
- The UI and transcript show markers only; the model receives every pasted byte or text character.
- Enter submits or queues; Shift+Enter alone inserts a newline.
- Soft wrapping reaches the usable cell boundary before wrapping and never splits a grapheme cluster.
- Image size validation and temporary-file storage remain unchanged. Pasted text remains in memory only.
- DEFAULT_CONTEXT_TOKENS is exactly 1_000_000 and is shared by loop and meter.

---

### Task 1: Add text attachments to the core model boundary

**Files:**

- Modify: packages/core/src/model/provider.ts:18-45
- Modify: packages/core/src/model/openai.ts:330-376
- Modify: packages/core/test/model.test.ts:220-348

**Interfaces:**

- Produces: type Attachment = ImageAttachment | TextAttachment.
- TextAttachment is { kind: 'text'; name: string; text: string }.
- ImageAttachment keeps kind: 'image', name, mediaType, and base64 data.
- Produces a user wire message containing the compact message text, then complete text parts and image URL parts in attachment order.

- [ ] **Step 1: Write the failing provider serialization test**

Capture the fake endpoint request body in model.test.ts, then add:

~~~ts
await collect(provider().stream({
  messages: [{
    role: 'user',
    content: 'Compare [Pasted Content #1 - 2 Lines]',
    attachments: [
      { kind: 'text', name: '[Pasted Content #1 - 2 Lines]', text: 'one\ntwo' },
      { kind: 'image', name: '[Pasted Content #2 - 0 Lines]', mediaType: 'image/png', data: 'AQI=' },
    ],
  }],
}));
assert.deepEqual(lastRequestBody['messages'], [{
  role: 'user',
  content: [
    { type: 'text', text: 'Compare [Pasted Content #1 - 2 Lines]' },
    { type: 'text', text: 'one\ntwo' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AQI=' } },
  ],
}]);
~~~

- [ ] **Step 2: Run the focused test to verify it fails**

Run: node --import tsx --test packages/core/test/model.test.ts

Expected: FAIL because Attachment currently accepts only images.

- [ ] **Step 3: Implement the union and content-part serializer**

Define exactly:

~~~ts
export interface TextAttachment {
  readonly kind: 'text';
  readonly name: string;
  readonly text: string;
}
export interface ImageAttachment {
  readonly kind: 'image';
  readonly name: string;
  readonly mediaType: string;
  readonly data: string;
}
export type Attachment = TextAttachment | ImageAttachment;
~~~

Keep a plain-string user message when attachments are absent. With attachments, emit the compact message as the first text part, map text attachments to text parts, and map images to their existing image_url data URLs.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: node --import tsx --test packages/core/test/model.test.ts

Expected: PASS, including text plus image ordering.

- [ ] **Step 5: Commit**

~~~bash
git add packages/core/src/model/provider.ts packages/core/src/model/openai.ts packages/core/test/model.test.ts
git commit -m "feat(core): support text message attachments"
~~~

### Task 2: Normalize every text paste into a generic marker

**Files:**

- Modify: packages/cli/src/clipboard.ts:1-178
- Modify: packages/cli/src/format.ts:85-108
- Modify: packages/cli/test/input.test.ts:1-75

**Interfaces:**

- Produces readClipboardText(): Promise<string | null>.
- Produces sanitizePastedText(chunk), pastedContentToken(index, text?), and isTerminalPaste(chunk).
- A multi-character terminal chunk or explicit Ctrl+V text is an attachment; ordinary one-character keyboard input is unchanged.

- [ ] **Step 1: Write failing pure-helper tests**

Replace the test that expects a pasted newline to submit, then add:

~~~ts
assert.equal(sanitizePastedText('first\r\nsecond\u001b[31m'), 'first\nsecond[31m');
assert.equal(pastedContentToken(1, 'one\ntwo'), '[Pasted Content #1 - 2 Lines]');
assert.equal(pastedContentToken(2), '[Pasted Content #2 - 0 Lines]');
assert.equal(isTerminalPaste('colado'), true);
assert.equal(isTerminalPaste('a'), false);
~~~

- [ ] **Step 2: Run the focused test to verify it fails**

Run: node --import tsx --test packages/cli/test/input.test.ts

Expected: FAIL because splitPaste removes newlines and the new helpers do not exist.

- [ ] **Step 3: Implement clipboard text reads and pure paste helpers**

Add readClipboardText beside readClipboardImage: PowerShell Get-Clipboard -Raw on Windows, pbpaste on macOS, and wl-paste --no-newline followed by xclip -selection clipboard -o on Linux. Return null for unavailable or empty text.

Replace splitPaste with:

~~~ts
export function sanitizePastedText(chunk: string): string {
  return chunk.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
}
export function pastedContentToken(index: number, text?: string): string {
  const lines = text === undefined ? 0 : text.split('\n').length;
  return '[Pasted Content #' + index + ' - ' + lines + ' Lines]';
}
export function isTerminalPaste(chunk: string): boolean {
  return chunk.length > 1 || /[\r\n]/.test(chunk);
}
~~~

- [ ] **Step 4: Run the focused test to verify it passes**

Run: node --import tsx --test packages/cli/test/input.test.ts

Expected: PASS with normalized line breaks, safe text, and generic markers.

- [ ] **Step 5: Commit**

~~~bash
git add packages/cli/src/clipboard.ts packages/cli/src/format.ts packages/cli/test/input.test.ts
git commit -m "feat(cli): normalize pasted text content"
~~~

### Task 3: Replace horizontal clipping with multiline prompt rows

**Files:**

- Modify: packages/cli/src/components/Prompt.tsx:1-185
- Modify: packages/cli/test/prompt.test.ts:1-77

**Interfaces:**

- Produces layoutPrompt(value, cursor, width): readonly PromptRow[] with source ranges and rendered text.
- Consumes clusterLength, displayWidth, and snap from packages/cli/src/text.ts.
- Produces one Ink text row per manual line or final-width soft wrap.

- [ ] **Step 1: Write failing row-layout tests**

Replace windowAround tests with:

~~~ts
assert.deepEqual(layoutPrompt('abcdefghij', 10, 5).map((row) => row.text), ['abcde', 'fghij']);
assert.deepEqual(layoutPrompt('first\nsecond', 12, 20).map((row) => row.text), ['first', 'second']);
assert.equal(layoutPrompt('ab🧑‍💻cd', 2, 4)[0]?.text, 'ab🧑‍💻');
assert.equal(layoutPrompt('line\n', 5, 10)[1]?.text, '');
~~~

- [ ] **Step 2: Run the focused test to verify it fails**

Run: node --import tsx --test packages/cli/test/prompt.test.ts

Expected: FAIL because the component exports horizontal windowing only.

- [ ] **Step 3: Implement the row layout and renderer**

Consume grapheme clusters left-to-right. Preserve literal newlines, retain a final empty row after a trailing newline, and begin a soft row only if adding the next cluster would exceed width. Render all rows inside the existing prompt border, retain the badge on the first row, and render the inverse cursor cluster on its containing row. Remove windowAround and one-line-only documentation.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: node --import tsx --test packages/cli/test/prompt.test.ts

Expected: PASS, proving final-boundary wrapping, manual newlines, grapheme safety, and trailing-newline cursor handling.

- [ ] **Step 5: Commit**

~~~bash
git add packages/cli/src/components/Prompt.tsx packages/cli/test/prompt.test.ts
git commit -m "feat(cli): render multiline prompt input"
~~~

### Task 4: Preserve complete attachments through immediate and queued messages

**Files:**

- Modify: packages/cli/src/app.tsx:151-244,1376-1510,1637-1649,1971-2170
- Modify: packages/cli/src/session.ts:108-118
- Modify: packages/core/src/harness/loop.ts:54-70,260-310
- Modify: packages/core/test/queue.test.ts
- Modify: packages/cli/test/input.test.ts

**Interfaces:**

- Produces PastedAttachment = PastedText | PastedImage; both variants carry token.
- Produces QueuedMessage.attachments: readonly PastedAttachment[].
- Changes LoopOptions.drainQueue from text strings to complete user Message objects so queued payloads cannot detach from their marker.

- [ ] **Step 1: Write failing attachment lifecycle tests**

Add a pure visible-token test and a core queue test whose callback returns:

~~~ts
[{
  role: 'user',
  content: '[Pasted Content #1 - 2 Lines]',
  attachments: [{ kind: 'text', name: '[Pasted Content #1 - 2 Lines]', text: 'one\ntwo' }],
}]
~~~

Assert the result preserves that exact attachment and has only one user message containing the marker. Assert that appending a token produces compare [Pasted Content #1 - 2 Lines], never the full pasted content.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: node --import tsx --test packages/cli/test/input.test.ts packages/core/test/queue.test.ts

Expected: FAIL because queued callback values are strings and pending state contains images only.

- [ ] **Step 3: Implement the unified tray, Shift+Enter, and queue transport**

Rename PastedImage to a text-or-image union; replace pasted and queuedImages with ordered attachment arrays. pasteClipboard tries readClipboardImage first, then readClipboardText; both paths allocate from the same pasteCount and insert only the generic token at the cursor.

In normal useInput, route isTerminalPaste(char) to the text-attachment path and retain shortcode expansion for one-character input. Handle key.return plus key.shift before normal Enter by inserting a newline at cursor. On normal Enter, move the full attachment array to the queued message or submission.

Make encodePasted return text attachments directly and preserve deferred image-file encoding and warnings. Update the core queue contract to append drained complete messages. When idle messages remain, submit them sequentially with their own attachments rather than concatenate marker strings.

- [ ] **Step 4: Run focused queue and input verification**

Run: node --import tsx --test packages/cli/test/input.test.ts packages/core/test/queue.test.ts

Expected: PASS, including attachment retention across a tool-call queue drain and no duplicate delivery.

- [ ] **Step 5: Commit**

~~~bash
git add packages/cli/src/app.tsx packages/cli/src/session.ts packages/cli/src/format.ts packages/cli/test/input.test.ts packages/core/src/harness/loop.ts packages/core/test/queue.test.ts
git commit -m "feat(cli): send pasted content attachments"
~~~

### Task 5: Change the shared context default to one million tokens

**Files:**

- Modify: packages/core/src/harness/loop.ts:84-91
- Create: packages/core/test/context.test.ts

**Interfaces:**

- Consumes the existing DEFAULT_CONTEXT_TOKENS import in CLI session state and interactive run-loop calls.
- Produces a one-million-token compaction budget and header meter without a second model-specific constant.

- [ ] **Step 1: Write the failing context-budget test**

~~~ts
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DEFAULT_CONTEXT_TOKENS } from '../src/harness/loop.js';

it('uses the DeepSeek V4 Flash Free one-million-token context window', () => {
  assert.equal(DEFAULT_CONTEXT_TOKENS, 1_000_000);
});
~~~

- [ ] **Step 2: Run it to verify it fails**

Run: node --import tsx --test packages/core/test/context.test.ts

Expected: FAIL because the constant is currently 120,000.

- [ ] **Step 3: Implement the shared budget**

Set the existing export in loop.ts:

~~~ts
export const DEFAULT_CONTEXT_TOKENS = 1_000_000;
~~~

Update the adjacent comment to describe a 1M context and existing 70% compaction target.

- [ ] **Step 4: Run it to verify it passes**

Run: node --import tsx --test packages/core/test/context.test.ts

Expected: PASS.

- [ ] **Step 5: Run complete verification and commit**

Run: npm test && npm run typecheck && npm run build

Expected: all tests pass, project references type-check, and build exits with code 0.

~~~bash
git add packages/core/src/harness/loop.ts packages/core/test/context.test.ts
git commit -m "fix(core): use million-token default context"
~~~

## Plan Self-Review

- Spec coverage: Tasks 1 and 4 deliver full text/images to the model while retaining compact UI markers; Task 2 makes the marker universal; Task 3 provides Shift+Enter-compatible multiline rendering; Task 5 raises the shared context limit.
- Placeholder scan: no unresolved requirements or generic test instructions remain.
- Interface consistency: CLI encoded attachments conform to the core union; core queue callbacks carry complete Message objects; the provider serializes the same attachments in request order.

### Task 6: Add reusable active-work animation and terminal-title primitives

**Files:**

- Create: packages/cli/src/terminal-title.ts
- Modify: packages/cli/src/components/Thinking.tsx
- Modify: packages/cli/src/app.tsx
- Modify: packages/cli/test/text.test.ts

**Interfaces:**

- Produces titleForWorking(frame: string): string and completedTitle(): string.
- Produces highlightedClusters(value, tick, bandWidth): readonly HighlightPart[], with every cluster emitted once and a wrapping bright band.
- App updates the terminal title only while state.busy is true and emits the completed title as busy changes to false.

- [ ] **Step 1: Write failing pure tests**

~~~ts
assert.equal(titleForWorking('⠙'), 'Plif — Working ⠙');
assert.equal(completedTitle(), 'Plif — Completed ✓');
assert.deepEqual(highlightedClusters('Parsing', 6, 2).map((part) => part.active), [true, true, false, false, false, false, false]);
~~~

- [ ] **Step 2: Run the focused test to verify it fails**

Run: node --import tsx --test packages/cli/test/text.test.ts

Expected: FAIL because title and highlight helpers do not exist.

- [ ] **Step 3: Implement title and highlight helpers**

Use OSC 0 title escape sequences through an injectable writer in terminal-title.ts. Export pure string builders separately. In Thinking, split active text with clusterLength and apply the accent-bright class only to the modulo-wrapping active band; all other clusters use the existing dim accent. In App, bind the writer to stdout, start the working title tick while busy, write completed title at each transition to idle, and clean up the interval/effect on unmount.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: node --import tsx --test packages/cli/test/text.test.ts

Expected: PASS with wrapping highlight and exact title strings.

- [ ] **Step 5: Commit**

~~~bash
git add packages/cli/src/terminal-title.ts packages/cli/src/components/Thinking.tsx packages/cli/src/app.tsx packages/cli/test/text.test.ts
git commit -m "feat(cli): animate active work status"
~~~

### Task 7: Simplify chrome and expose compact Context progress

**Files:**

- Modify: packages/cli/src/components/Header.tsx
- Modify: packages/cli/src/components/Prompt.tsx
- Modify: packages/cli/src/components/Meter.tsx
- Modify: packages/cli/src/app.tsx
- Modify: packages/cli/test/prompt.test.ts

**Interfaces:**

- Header no longer consumes or renders container and containerState.
- Prompt no longer receives a container badge.
- Meter accepts a Context label and renders a narrow filled/empty bar with only percentage text when room permits.

- [ ] **Step 1: Write failing compact-context tests**

~~~ts
assert.deepEqual(contextMeter(43_200, 1_000_000, 6), { filled: 0, empty: 6, label: 'Context 4%' });
assert.equal(contextMeter(900_000, 1_000_000, 6).tone, 'danger');
~~~

- [ ] **Step 2: Run the focused test to verify it fails**

Run: node --import tsx --test packages/cli/test/prompt.test.ts

Expected: FAIL because there is no context-meter projection and the prompt/header still own container presentation.

- [ ] **Step 3: Implement the minimal chrome**

Extract a pure meter projection from Meter for tests. Make Header render only path plus optional model/isolation and a Context label with the short bar; remove the random container name from both Header props and the Prompt badge call site. Preserve the bare bar on narrow terminals and remove optional metadata before hiding the context indicator.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: node --import tsx --test packages/cli/test/prompt.test.ts

Expected: PASS with compact Context values and no container-oriented prompt contract.

- [ ] **Step 5: Commit**

~~~bash
git add packages/cli/src/components/Header.tsx packages/cli/src/components/Prompt.tsx packages/cli/src/components/Meter.tsx packages/cli/src/app.tsx packages/cli/test/prompt.test.ts
git commit -m "feat(cli): streamline terminal chrome"
~~~

### Task 8: Render tasks and subagents as compact operation rows

**Files:**

- Modify: packages/cli/src/components/TaskIndicator.tsx
- Modify: packages/cli/src/components/TaskPanel.tsx
- Modify: packages/cli/src/components/Subagents.tsx
- Modify: packages/cli/src/app.tsx
- Create: packages/cli/test/activity.test.ts

**Interfaces:**

- Produces a shared compact activity-row projection: spinner/status mark, operation label, muted summary, and optional duration.
- Collapsed subagent state lists active rows rather than a count; expanded subagent detail retains selection without the rounded card.
- TaskPanel uses the same row projection for running, done, failed, and awaiting-approval snapshots.

- [ ] **Step 1: Write failing activity-row tests**

~~~ts
assert.deepEqual(projectActivity({ status: 'running', title: 'Explore checkout flow', elapsedMs: 1_700 }), {
  state: 'running', operation: 'Explore', summary: 'checkout flow', duration: '1.7s',
});
assert.equal(projectActivity({ status: 'done', title: 'Explore checkout flow', elapsedMs: 1_700 }).mark, glyph.done);
~~~

- [ ] **Step 2: Run the focused test to verify it fails**

Run: node --import tsx --test packages/cli/test/activity.test.ts

Expected: FAIL because task and subagent displays build incompatible card-specific strings inline.

- [ ] **Step 3: Implement compact shared projections and views**

Move status/label parsing into a pure helper near the components. Render one-line rows with a spinner or status glyph, a blue-violet operation word, a muted summary, and a dim duration/status. Remove rounded task and subagent cards; preserve keyboard actions (t, Ctrl+S, Tab) and existing expanded detail data. Recalculate TaskPanel and subagentsHeight conservatively for the shorter rows so the live frame never reaches terminal height.

- [ ] **Step 4: Run focused activity and frame tests**

Run: node --import tsx --test packages/cli/test/activity.test.ts packages/cli/test/frame.test.ts

Expected: PASS with all task/subagent status projections and no frame-budget regression.

- [ ] **Step 5: Commit**

~~~bash
git add packages/cli/src/components/TaskIndicator.tsx packages/cli/src/components/TaskPanel.tsx packages/cli/src/components/Subagents.tsx packages/cli/src/app.tsx packages/cli/test/activity.test.ts packages/cli/test/frame.test.ts
git commit -m "feat(cli): compact task activity views"
~~~
