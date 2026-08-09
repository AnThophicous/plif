# Calm Agent, Vision, and Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make active Plif sessions calm and compact, expose live subagent sessions and usage, and safely delegate pasted images to an explicitly approved vision model.

**Architecture:** The core loop enforces a three-call parallel limit and produces private deferrals. Typed core events project child usage and vision approval state into the CLI without putting child activity in the parent transcript. Provider metadata is the source of truth for image eligibility and cost classification.

**Tech Stack:** TypeScript, React 18, Ink, Node.js test runner, OpenAI-compatible SDK, JSON Schema draft 2020-12.

## Global Constraints

- Preserve sequential execution for every tool not marked parallelSafe.
- Never execute or display more than three parallel-safe calls from one model response.
- Deferred calls receive valid private tool results, never visible error rows.
- Never infer image capability or price from an endpoint model ID.
- Cancel is the safe default for an unconfigured vision model. The user may explicitly save one exact vision provider/model for future delegation; global auto-approve bypasses the per-run confirmation.
- Parent context percentage remains separate from live delegated token usage.
- Custom providers use only the OpenAI-compatible adapter and never expose credentials.
- The public schema URL is https://raw.githubusercontent.com/AnThophicous/plif/main/packages/core/schema/config.schema.json.

---

## File Structure

| File | Responsibility |
| --- | --- |
| packages/core/src/harness/loop.ts | Tool batch cap, deferred call results, latest message attachments. |
| packages/core/src/harness/prompt.ts | Progressive, calm tool-use instruction. |
| packages/core/src/events/bus.ts | Subagent live-usage event. |
| packages/core/src/harness/{subagent,vision}.ts | Child usage relay and consent-bound image delegation. |
| packages/core/src/model/{config,catalog}.ts | Provider capabilities, cost, candidate discovery. |
| packages/core/schema/config.schema.json | Public config contract. |
| packages/cli/src/{session,app}.tsx | Timeline aggregation, event projection, fixed frame. |
| packages/cli/src/components/{Prompt,Header,Timeline,ToolCall,Thinking,Subagents,Question}.tsx | Compact terminal rendering. |

### Task 1: Cap parallel tool requests

**Files:**
- Modify: packages/core/src/harness/loop.ts:328-465
- Modify: packages/core/src/harness/prompt.ts:75-155
- Test: packages/core/test/parallel.test.ts

**Interfaces:**
- Produces MAX_PARALLEL_SAFE_CALLS = 3.
- scheduleBatches(calls, registry) returns safe batches of at most three calls.
- deferOverflowCalls(calls) returns one non-rendered tool message for every deferred call.

- [ ] **Step 1: Write the failing scheduler test**

    it('caps a long safe run at three calls per batch', () => {
      const batches = scheduleBatches(Array.from({ length: 7 }, () => call('read_file')), registry);
      assert.deepEqual(batches.map((batch) => batch.length), [3, 3, 1]);
    });

- [ ] **Step 2: Run the focused test**

Run: node --import tsx --test packages/core/test/parallel.test.ts

Expected: FAIL because the current scheduler creates one seven-call batch.

- [ ] **Step 3: Implement the cap and private deferral**

    export const MAX_PARALLEL_SAFE_CALLS = 3;
    if (safe && open && open.length < MAX_PARALLEL_SAFE_CALLS) open.push(call);

Run only the first safe batch in a provider turn. Append tool results for the rest stating that they were deferred to preserve terminal readability, but never emit agent.tool start/end for them. Add a system-prompt rule to inspect results progressively and avoid broad tool bursts because they pollute the user interface.

- [ ] **Step 4: Verify the scheduler**

Run: node --import tsx --test packages/core/test/parallel.test.ts

Expected: PASS; writes remain sequential and all visible safe batches contain at most three calls.

- [ ] **Step 5: Commit**

    git add packages/core/src/harness/loop.ts packages/core/src/harness/prompt.ts packages/core/test/parallel.test.ts
    git commit -m "feat(core): pace parallel tool calls"

### Task 2: Pin operational status in the prompt

**Files:**
- Modify: packages/cli/src/components/Prompt.tsx
- Modify: packages/cli/src/components/Header.tsx
- Modify: packages/cli/src/app.tsx:2638-2845
- Test: packages/cli/test/prompt.test.ts

**Interfaces:**
- PromptProps gains status?: React.ReactNode rendered inside its border before input rows.
- HeaderProps gains delegatedTokens: number and no longer renders the job/isolation badge.

- [ ] **Step 1: Write the failing render test**

    it('puts status above the cursor inside the prompt frame', () => {
      const view = render(<Prompt {...base} status={<Text>Context 8%</Text>} />);
      assert.match(lastFrame(view), /Context 8%[\s\S]*❯/);
    });

- [ ] **Step 2: Run the focused test**

Run: node --import tsx --test packages/cli/test/prompt.test.ts

Expected: FAIL because Prompt does not accept status.

- [ ] **Step 3: Implement the fixed status row**

Render status as the first child inside the existing rounded Prompt border. Remove the standalone Header in App, pass Header through Prompt.status, and render only path/model/context plus a muted Agents +tokens tally when needed. The line must remain in the dynamic footer, never in Static timeline output.

- [ ] **Step 4: Verify**

Run: node --import tsx --test packages/cli/test/prompt.test.ts; npm run typecheck

Expected: PASS with no visual job label.

- [ ] **Step 5: Commit**

    git add packages/cli/src/app.tsx packages/cli/src/components/Header.tsx packages/cli/src/components/Prompt.tsx packages/cli/test/prompt.test.ts
    git commit -m "feat(cli): pin operational status inside prompt"

### Task 3: Compact thinking, commands, and file edits

**Files:**
- Modify: packages/cli/src/session.ts
- Modify: packages/cli/src/app.tsx
- Modify: packages/cli/src/components/{Timeline,ToolCall,Thinking}.tsx
- Modify: packages/cli/src/theme.ts
- Test: packages/cli/test/input.test.ts

**Interfaces:**
- TimelineEntry gets optional transcriptLabel and editBatch: { files, additions, deletions }.
- aggregateEditDiffs(entries) returns one Edited N files (+A -D) row.

- [ ] **Step 1: Write failing aggregation tests**

    it('groups two diffs', () => {
      const entry = aggregateEditDiffs([edit('a.ts', 1, 0), edit('b.ts', 5, 2)]);
      assert.equal(entry.title, 'Edited 2 files (+6 -2)');
    });

    it('keeps completed thinking collapsed and gray', () => {
      assert.match(lastFrame(render(<TimelineRow entry={thought('done')} width={80} />)), /Ctrl\+R to expand/);
    });

- [ ] **Step 2: Run the focused test**

Run: node --import tsx --test packages/cli/test/input.test.ts

Expected: FAIL because edits are individual tool rows and completed thoughts are bright.

- [ ] **Step 3: Implement compact projections**

Keep one edit batch open for consecutive completed edit tools and flush it on a non-edit tool, answer, reset, or turn end. Render a command as Ran argv with a short first/last output preview and an expansion key. Render a completed thought as dim duration-only chrome; expanded content starts with Thinking: and uses a rail. Move the travelling light-blue highlight at 180ms, keeping a stable-width small band.

- [ ] **Step 4: Verify**

Run: node --import tsx --test packages/cli/test/input.test.ts packages/cli/test/prompt.test.ts

Expected: PASS; output elision and aggregate diff totals match tests.

- [ ] **Step 5: Commit**

    git add packages/cli/src/session.ts packages/cli/src/app.tsx packages/cli/src/components/Timeline.tsx packages/cli/src/components/ToolCall.tsx packages/cli/src/components/Thinking.tsx packages/cli/src/theme.ts packages/cli/test/input.test.ts
    git commit -m "feat(cli): compact active operation timeline"

### Task 4: Show subagents as live mini-sessions

**Files:**
- Modify: packages/core/src/events/bus.ts
- Modify: packages/core/src/harness/subagent.ts
- Modify: packages/cli/src/{session,app}.tsx
- Modify: packages/cli/src/components/Subagents.tsx
- Test: packages/core/test/subagent.test.ts
- Test: packages/cli/test/input.test.ts

**Interfaces:**
- Add subagent.usage { taskId, promptTokens, completionTokens, budget }.
- SubagentView gains contextUsed, contextMax, and completionTokens.

- [ ] **Step 1: Write failing relay tests**

    it('relays child usage before the child completes', () => {
      relayUsage({ promptTokens: 4200, completionTokens: 300, budget: 1_000_000 });
      assert.deepEqual(parentEvents.at(-1), {
        taskId: 'subagent-call-1', promptTokens: 4200, completionTokens: 300, budget: 1_000_000,
      });
    });

- [ ] **Step 2: Run focused tests**

Run: node --import tsx --test packages/core/test/subagent.test.ts packages/cli/test/input.test.ts

Expected: FAIL because subagent usage is not emitted or stored.

- [ ] **Step 3: Implement child usage and expanded session**

Relay agent.usage from the child's private bus. Update only its own SubagentView, sum children for Header delegatedTokens, and give the selected child its own compact Context meter, thinking, tools, streamed lines, and summary. Preserve Ctrl+S for open/close and Tab for selection. Never append a child event to the parent TimelineEntry array.

- [ ] **Step 4: Verify**

Run: node --import tsx --test packages/core/test/subagent.test.ts packages/cli/test/input.test.ts; npm run typecheck

Expected: PASS; parent transcript never includes a child tool line.

- [ ] **Step 5: Commit**

    git add packages/core/src/events/bus.ts packages/core/src/harness/subagent.ts packages/cli/src/session.ts packages/cli/src/app.tsx packages/cli/src/components/Subagents.tsx packages/core/test/subagent.test.ts packages/cli/test/input.test.ts
    git commit -m "feat(cli): show live subagent sessions"

### Task 5: Add typed vision-capable custom providers and public schema

**Files:**
- Modify: packages/core/src/model/config.ts
- Modify: packages/core/src/model/catalog.ts
- Modify: packages/core/src/config/global.ts
- Modify: packages/core/schema/config.schema.json
- Test: packages/core/test/config.test.ts

**Interfaces:**
- ModelCapability = 'text' | 'image'; ModelCost = 'free' | 'paid' | 'unknown'.
- visionCandidates(config): readonly VisionCandidate[] returns only declared image models.
- A CustomProvider has sdk: 'openai', display name, base URL, and model metadata.

- [ ] **Step 1: Write failing capability tests**

    it('excludes models without declared image modality', () => {
      assert.deepEqual(visionCandidates(configWithPlainModel), []);
    });

    it('marks declared custom vision cost as unknown by default', () => {
      assert.equal(visionCandidates(configWithVision)[0]?.cost, 'unknown');
    });

- [ ] **Step 2: Run focused tests**

Run: node --import tsx --test packages/core/test/config.test.ts

Expected: FAIL because visionCandidates and capability metadata do not exist.

- [ ] **Step 3: Implement metadata and schema**

Normalize custom provider models; a model is eligible only when modalities contains image. Give custom models unknown cost unless explicitly declared. Permit sdk only as openai, set CONFIG_SCHEMA_URL and schema $id to the raw GitHub URL, and constrain options.baseURL, model modalities, contextWindow, and cost while retaining OpenCode-compatible extension fields.

- [ ] **Step 4: Verify config and schema**

Run: node --import tsx --test packages/core/test/config.test.ts; node -e "JSON.parse(require('node:fs').readFileSync('packages/core/schema/config.schema.json','utf8'))"

Expected: PASS and valid JSON.

- [ ] **Step 5: Commit**

    git add packages/core/src/model/config.ts packages/core/src/model/catalog.ts packages/core/src/config/global.ts packages/core/schema/config.schema.json packages/core/test/config.test.ts
    git commit -m "feat(core): declare vision provider capabilities"

### Task 6: Build consent-bound image delegation

**Files:**
- Create: packages/core/src/harness/vision.ts
- Modify: packages/core/src/harness/{tools,loop,subagent}.ts
- Modify: packages/cli/src/{session,app}.tsx
- Modify: packages/cli/src/components/Question.tsx
- Test: packages/core/test/vision.test.ts
- Test: packages/cli/test/input.test.ts

**Interfaces:**
- visionTool(options): Tool exposes list_vision_models and inspect_image.
- ToolContext gains attachments?: readonly Attachment[] for the current user message.
- inspect_image accepts { image, model, task } and does not create a child before selection and confirmation.

- [ ] **Step 1: Write failing safety tests**

    it('does not start a child after cancellation', async () => {
      broker.answer('cancel');
      await inspect.run({ image: 1, model: 'vision', task: 'describe' }, context);
      assert.equal(spawned, 0);
    });

    it('passes an image only after exact confirmation', async () => {
      broker.answers(['vision', 'confirm']);
      await inspect.run({ image: 1, model: 'vision', task: 'describe' }, context);
      assert.equal(receivedAttachments[0]?.kind, 'image');
    });

- [ ] **Step 2: Run focused tests**

Run: node --import tsx --test packages/core/test/vision.test.ts

Expected: FAIL because no vision tool or attachment context exists.

- [ ] **Step 3: Implement list, selection, confirmation, and child transfer**

The listing returns only visionCandidates. The selection question puts Recommended Provider first when metadata declares one, includes other candidates, and defaults to Cancel. A second question shows exact model, provider, endpoint, free/paid/unknown cost, and asks whether to save that exact choice as the default vision model. Persist only an explicit yes. If global auto-approve is on, use the saved or newly selected model without another confirmation. Locate the chosen image in ToolContext.attachments and pass it as the sole attachment to the child's new user message.

- [ ] **Step 4: Render safe menu copy**

Add question kinds vision-select and vision-confirm to session state. Render provider/cost details and explicit Cancel in Question while preserving normal keyboard navigation. Never put API keys in a question field.

- [ ] **Step 5: Verify**

Run: node --import tsx --test packages/core/test/vision.test.ts packages/cli/test/input.test.ts; npm run typecheck

Expected: PASS; cancel, decline, no candidate, and unknown-capability paths start zero children.

- [ ] **Step 6: Commit**

    git add packages/core/src/harness/vision.ts packages/core/src/harness/tools.ts packages/core/src/harness/loop.ts packages/core/src/harness/subagent.ts packages/cli/src/session.ts packages/cli/src/app.tsx packages/cli/src/components/Question.tsx packages/core/test/vision.test.ts packages/cli/test/input.test.ts
    git commit -m "feat: safely delegate pasted images to vision agents"

### Task 7: Document and verify the integrated CLI

**Files:**
- Modify: README.md
- Modify: packages/cli/README.md
- Test: all existing test packages

- [ ] **Step 1: Document exact provider and consent behavior**

Add the approved custom OpenAI-compatible provider example. Explain that image models must declare modalities: ['text', 'image'], cost is displayed per vision run, and every non-free or unknown choice requires fresh confirmation.

- [ ] **Step 2: Run full verification**

Run: npm test; npm run typecheck; npm run build

Expected: every test passes and all packages build.

- [ ] **Step 3: Check the package and the terminal frame**

Run: git diff --check; npm run link

Expected: no whitespace errors and linked plif is rebuilt. In a fresh terminal, verify the status remains inside the prompt border, at most three read calls are visible at once, and cancelling the vision menu starts no subagent.

- [ ] **Step 4: Commit**

    git add README.md packages/cli/README.md
    git commit -m "docs: explain vision providers and safe delegation"

## Plan Self-Review

- **Coverage:** Tasks 1-3 deliver the calm bounded loop and compact fixed timeline. Task 4 delivers live child sessions and token updates. Tasks 5-6 deliver typed providers, public schema, safe vision selection, and consent. Task 7 verifies and documents the whole behavior.
- **Placeholder scan:** Every task names files, types, tests, commands, expected outcomes, and commit scope.
- **Type consistency:** The plan introduces ModelCapability, ModelCost, VisionCandidate, ToolContext.attachments, and subagent.usage before any consumer.
