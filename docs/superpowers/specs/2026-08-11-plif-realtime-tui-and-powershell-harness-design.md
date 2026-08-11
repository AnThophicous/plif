# Plif Realtime TUI and PowerShell-First Harness Design

## Objective

Make Plif feel immediate and dependable on Windows while preserving its Ink
identity and current composer. The release must restore a compact startup
header, clear the terminal exactly once, make model reasoning and answers stream
without bursts or loss, reduce time to first model request, strengthen the
coding harness, prefer PowerShell for shell work, and add navigable
`/permissions` and `/feature` surfaces.

This is one product change delivered through three isolated implementation
slices:

1. realtime transport and TUI runtime;
2. coding harness and shell dialects;
3. permissions and experimental-feature control surfaces.

Each slice has its own tests and can be reviewed independently. The slices share
configuration and UI primitives, but they do not share mutable runtime state.

## Confirmed Current Problems

### Startup and header

Commit `05d66b8` removed the pre-Ink `renderBanner` call from `main.tsx` and
replaced it with `SessionHeader` inside an Ink `Static`. `banner.ts` consequently
has no caller. `Header.tsx` is also unreferenced. Interactive startup has no
terminal-clear operation.

The App now renders two sibling `Static` nodes: one for `SessionHeader` and one
for committed history. Ink 5 stores one static root reference, so the second
node replaces the first. The empty history static wins on a fresh session after
the header has already advanced its internal item index, losing the header
permanently. Starting from a terminal containing old rows then leaves only a
small live composer at the bottom of an uncleared viewport. The fix belongs at
the startup boundary, before Ink owns stdout, and the App must retain only one
`Static` for history.

### Bursty model streaming

The provider yields semantic text and reasoning deltas immediately, but the CLI
currently performs multiple React updates for one model delta:

- the timeline reducer receives the growing full string;
- the completion meter updates global App state;
- answer deltas also update the transcript reducer;
- active thinking runs a separate 16 ms highlight clock;
- the App runs another spinner clock for the terminal title.

Ink ultimately paints terminal output for these state changes. Under a fast
stream, queued rendering work can fall behind incoming deltas, producing the
visible pattern of a few characters, a pause, then a large block.

`ReasoningDeltaNormalizer` also starts cumulative-snapshot detection only after
four accumulated characters. A reproduced stream of `abc`, `abcdef`, and
`abcdefghi` reaches the semantic bus as all three complete strings instead of
the increments `abc`, `def`, and `ghi`. The growing duplicated text then makes
each full-string reducer copy and `thoughtLines` pass more expensive. Existing
tests cover long first snapshots but not this short-prefix case.

Malformed JSON after a partially delivered SSE currently escapes as a generic
model error rather than following the atomic reset/retry path. Separately, the
provider caps inter-chunk idle time at 30 seconds even when the configured
request timeout is 120 seconds. Both paths can visibly remove a partial thought.

### Time to first request

The first user turn currently serializes work before `runLoop` reaches the
provider: base-image resolution, container creation, LSP warmup, memory read,
agent-instruction read, and repeated configuration reads. LSP warmup is useful
for later tool calls but does not need to block the first model byte.

Plif effort negotiation may also issue several rejected requests while walking
`max`, `xhigh`, `high`, `medium`, and `low`. The accepted capability lives only
on one `OpenAIProvider` instance, so a new process repeats the negotiation.

The static prompt is large and contains repeated guidance across the default,
mode, Plif, environment, and tool modules. Adding more prose would increase
latency. Improving the harness therefore means reducing duplication and making
the remaining instructions more specific.

## 1. Realtime Transport and TUI Runtime

### Startup ownership

`runInteractive` will own a one-shot startup sequence:

1. verify stdout is a TTY;
2. finish the minimum configuration needed for the header;
3. emit ANSI reset for mouse modes, clear the visible screen, and move the
   cursor home;
4. print a compact plain-text session header;
5. mount Ink for the conversation and composer.

The header is ordinary terminal output outside Ink. An immediate identity line
appears before slow initialization; provider/model and truthful sandbox status
complete the compact opening before Ink mounts. The opening uses at most four
rows, has no large logo, and has no empty vertical padding. `SessionHeader` is
removed from `Static`, preventing duplicate ownership. Non-interactive commands
never clear the terminal.

The package version becomes the single source of truth for the displayed CLI
version so a preview cannot identify itself as `0.2.0` while publishing
`0.3.0-preview.0`.

### Semantic stream accumulator

A pure `StreamFrameAccumulator` will sit between engine bus events and React.
It owns three independent lanes:

- final answer text;
- reasoning text;
- completion-token estimation.

Incoming deltas are appended immediately and never discarded. The first delta
of a lane schedules a frame; subsequent deltas coalesce until that frame. The
normal cadence is about 30 frames per second, scheduled only while a lane is
dirty. A terminal does not benefit from a permanent 60 FPS timer.

Every terminal transition has an explicit synchronous flush:

- answer or reasoning completion;
- tool-call boundary;
- retry/reset;
- cancellation;
- unmount.

The accumulator emits immutable snapshots. React never receives one update per
wire chunk and never reconstructs text from rendered fragments. Persistence
continues to consume canonical events independently of paint cadence.

The transcript controller will use the same frame snapshots for its live cells
instead of dispatching on every `agent.text` event while the transcript overlay
is closed. Reasoning gets an explicit live transcript cell and is projected from
the reasoning already present on durable assistant events; the overlay no longer
appears frozen until final-answer text starts. Canonical finalized events remain
written immediately.

### Reasoning normalization

Reasoning normalization becomes an explicit `unknown`, `delta`, or `snapshot`
state machine. It keeps the previous raw field separate from emitted aggregate
text and may hold at most one short ambiguous overlap while identifying the
shape. Source metadata from string reasoning fields and structured
`reasoning_details` remains available to the decision instead of being erased by
early extraction. It must satisfy these invariants for any chunking:

- concatenated output equals the provider's final reasoning exactly once;
- unchanged cumulative snapshots emit nothing;
- short initial snapshots are supported;
- ordinary token deltas, including repeated tokens, are preserved;
- a reset discards only the abandoned attempt and cannot contaminate the next.

Structured `reasoning_details` blocks and string reasoning fields pass through
the same normalization boundary. The content-channel `<think>` splitter remains
separate. Iterator/parser failures raised after a streamed response has opened
are translated into interrupted-stream failures and use the same visible,
atomic reset/retry behavior as an early EOF.

First-chunk and inter-chunk timeout policy is separated. The configured request
timeout governs time to first chunk; reasoning streams receive an
inter-chunk allowance that does not silently shrink a 120-second configuration
to 30 seconds. Every wait remains cancellable and visible in diagnostics.

### Animation clock

One shared active-only animation clock replaces the 16 ms highlight interval,
the 70/80 ms focus and infinity intervals, the thinking pulse interval, and the
App-level title spinner update. The Ink clock uses discrete, carefully designed
frames at an 80–100 ms terminal-appropriate cadence. It is active only during
real work, not merely because the composer has focus. Terminal-title animation
runs outside React and cannot trigger a TUI paint.

The active-thinking row keeps a bounded tail, but receives a composed motion
language: a stable Plif mark, a light sweep across the label, and a calm phase
change when reasoning becomes tool work or final output. Reduced-glyph terminals
retain ASCII frames. Motion changes glyph or weight as well as truecolor so it
remains visible on 16/256-color consoles. Idle sessions have no animation timer.

Terminal resize uses one owned policy: shrink events apply immediately and grow
events coalesce briefly. Reported dimensions never exceed the physical terminal
through an artificial minimum. The implementation stops depending on an Ink
listener's private function name; if a private compatibility seam remains
unavoidable, the exact Ink version is pinned and covered by an integration test.

### Request preparation and latency telemetry

Turn preparation will be split into required and deferrable work.

Required work starts concurrently where dependencies allow: container startup,
memory snapshot, agent instructions, and one configuration read. LSP warmup
starts after the container path exists but does not block the first provider
request. LSP tools remain capable of lazy initialization on first use.

Provider effort capability is cached by endpoint and model with a bounded
lifetime. A previously accepted effort is tried first; an explicit rejection
updates the cache. Authentication, model-not-found, and policy failures are
never cached as capability results.

A small timing record tracks preparation start, request dispatch, first provider
chunk, first semantic delta, first rendered frame, and completion. It contains
durations and provider/model identifiers but no prompt, response, credentials,
or user content. It is exposed only through the `stream-diagnostics`
experimental feature.

## 2. Coding Harness and Shell Dialects

### Prompt compiler

The existing default prompt is already strongly coding-oriented. The required
improvement is coherence with the runtime and less duplication, not another
layer of generic agent prose. The prompt compiler will retain the current
precedence and security contract, but its modules get narrower responsibilities:

- the default module is a concise authority, safety, scope, and completion
  contract;
- the primary coding module owns repository inspection, diagnosis, precise
  editing, tests, builds, and evidence-based completion;
- the environment module owns paths, capabilities, operating system, and shell;
- the tool module explains selection between dedicated tools, direct execution,
  and shell execution;
- skills and MCP modules contain only their catalogues and loading rules.

Platform instructions leave `default.md` and are generated by the selected
shell dialect. Repeated advice is removed rather than restated. The compiled
static coding prompt, excluding project memory, skills, MCP catalogues, and tool
JSON schemas, must stay below an estimated 6,000 tokens.

Prompt module id uniqueness is checked before enablement filtering, so two
mutually disabled modules cannot conceal a duplicate id. The resolved feature
snapshot is injected by callers; the compiler never reads configuration from
disk. Interactive, one-shot, and subagent prompts all receive the same effective
snapshot.

The coding mode explicitly tells the agent to understand the repository before
editing, reproduce bugs, preserve unrelated user changes, use the smallest
coherent patch, and verify behavior proportionally to risk. It remains capable
of answering and diagnosing without editing when that is the requested scope.

### Shell layer

Core receives a `ShellDialect` interface with isolated implementations:

- `PowerShellDialect`, active on Windows now;
- `BashDialect`, implemented as a contract-compatible adapter for future Linux
  activation.

A dialect reports its executable, invocation argv, display name, capabilities,
and prompt guidance. On Windows, resolution prefers `pwsh.exe` and falls back to
`powershell.exe`. Invocation uses `-NoLogo`, `-NoProfile`, `-NonInteractive`, and
`-Command`; it never uses execution-policy bypass or elevation.

The new `shell_command` tool accepts a script and a reason. The script is passed
as one argv element directly to the interpreter, never interpolated by another
host shell. The existing `run_command` remains the preferred path for a single
executable such as `npm test`, because direct argv is faster and easier to
authorize. PowerShell becomes the preferred path for pipelines, cmdlets,
structured filtering, Windows diagnostics, and multi-step shell expressions.

The typed `!` path remains literal direct-exec and is not silently converted to
PowerShell. Its help text is corrected to match the real UI: plain input goes to
the agent, `/` invokes a command, and `!` invokes a process directly.

Dedicated Plif file and edit tools remain preferred when they provide stronger
path validation, transactional behavior, or smaller model output. This keeps
PowerShell primary for shell semantics without weakening container or policy
boundaries.

The policy engine evaluates both interpreter argv and script text through one
shared `ShellInvocationAnalyzer`. It recognizes PowerShell, Bash/sh, and cmd
envelopes, extracts their script argument, and applies the hard denylist to the
commands named inside the envelope. `TaskManager`, foreground execution, and
the new shell tool all use the same analyzer. This closes the existing gap where
`powershell -Command "vssadmin ..."` is seen only as `powershell` by the
command-name denylist and can reach an auto-approved fallback.

The layer does not wrap every direct command in PowerShell. Direct argv remains
direct argv; only `shell_command` creates an interpreter envelope. The shell
tool rejects oversized scripts, NUL bytes, unavailable interpreters, ambiguous
or malformed envelopes that cannot be analyzed safely, and any attempt to
request another dialect implicitly. Tool output preserves exit code, stdout,
stderr, truncation, and cancellation exactly as `run_command` does.

## 3. Permissions and Feature Control Surfaces

### `/permissions`

`/permissions` becomes the canonical command; `/permission` remains a backward-
compatible alias. It opens a navigable Ink control center rather than printing
one timeline row.

The view has two tabs:

- **Mode**: Ask, Auto approve, and Deny, with the active choice and consequences
  shown before selection;
- **Effective policy**: trust tier, fallback, matched rule summaries, network
  allowlist, sandbox enforcement gaps, and the config source.

Arrow keys move, Tab changes tabs, Enter applies a mode, and Esc returns to the
conversation. Applying a mode updates global configuration and the live
approval broker atomically. Arbitrary policy-rule editing is out of scope; the
view explains the effective rules without creating a second policy authoring
language.

### `/feature`

Core receives a typed, compile-time `FeatureRegistry`. A definition has a stable
id, title, description, stage, default state, restart requirement, and optional
support check. Configuration stores global choices and project overrides;
project overrides win. A feature not compiled into the running version cannot
be activated by configuration.

Global choices live under `features` in the normal global configuration.
Project overrides live in `<workspace>/.plif/features.jsonc`, are written
atomically only when the user chooses project scope, and contain feature states
only. The resolver applies project override, then global choice, then compiled
default.

`/feature` opens a navigable list showing stage, effective state, scope, support,
and restart requirements. Arrow keys move, Space toggles, `g` selects global
scope, `p` selects the current project, and Esc returns. The first registered
experimental feature is `stream-diagnostics`, disabled by default.

The feature system never downloads or evaluates code. It only gates code already
shipped in Plif, so enabling a preview cannot bypass policy, sandboxing,
approvals, or secret redaction.

## State and Data Flow

```text
provider/SDK delta
  -> provider normalization
  -> harness semantic event bus
  -> canonical session persistence (immediate)
  -> StreamFrameAccumulator (lossless, bounded paint cadence)
  -> timeline + token meter + transcript live cell (one frame snapshot)
  -> Ink terminal patch

global config + optional project feature override
  -> effective settings resolver
  -> /permissions or /feature view model
  -> atomic save
  -> live runtime update
```

Transport, persistence, and paint are separate consumers. A slow paint cannot
delay the provider iterator, and a failed transcript write cannot stop the
visible conversation.

## Error Handling

- A malformed SSE or interrupted stream follows the existing visible retry
  contract; partial abandoned output is reset before another attempt.
- A final flush runs before reset or completion, so accepted output cannot be
  stranded in a buffer.
- If the timing cache is corrupt or stale, Plif ignores it and negotiates
  normally.
- If PowerShell is unavailable, `shell_command` returns a specific unsupported
  error and the direct tools continue working.
- Failed permission or feature saves leave live state unchanged and show one
  actionable error.
- Unsupported experimental features remain visible but disabled with a reason.
- Terminal clearing is best-effort and TTY-only; failure to emit ANSI does not
  prevent the session from mounting.

## Testing and Acceptance Criteria

### Streaming

- randomized chunk-boundary tests prove no text/reasoning loss or duplication;
- cumulative reasoning beginning with one, two, or three characters streams
  correctly;
- malformed JSON after partial SSE output resets and retries atomically;
- first-chunk and reasoning inter-chunk waits honor the configured timeout and
  remain cancellable;
- a synthetic 200-delta burst produces bounded render snapshots rather than 200
  App updates;
- first accepted semantic data is scheduled for paint within 50 ms;
- completion, tool boundaries, reset, cancel, retry, and unmount flush exactly
  once;
- transcript reconstruction remains byte-equivalent to finalized live output.

### Startup and TUI

- interactive startup emits clear/home once before the header and Ink mount;
- non-interactive commands emit no clear sequence;
- the compact header appears once and stays within four rows at supported
  widths;
- no header is rendered through Ink `Static`;
- an integration render with header and history proves that only the history
  owns Ink's single static root;
- idle mode owns no animation timer, and active mode owns one shared Ink clock;
- render/write budgets cover idle, active thinking, and no-truecolor fallback;
- resize bursts cannot duplicate scrollback or force dimensions larger than the
  real terminal;
- snapshots cover narrow, normal, and tall Windows terminal sizes.

### Latency

- a controlled test proves memory/config/instruction reads overlap container
  preparation;
- LSP warmup does not delay provider dispatch;
- effort negotiation reuses a valid cached capability and invalidates a rejected
  one;
- stream diagnostics redact content and credentials.

### Harness and shell

- prompt-module tests enforce ordering, uniqueness, required coding behavior,
  PowerShell guidance, and the static token budget;
- PowerShell and Bash dialect tests cover executable selection and exact argv;
- `shell_command` tests cover success, stderr, non-zero exit, cancellation,
  missing interpreter, unsafe elevation/bypass, and output truncation;
- policy tests prove nested PowerShell, Bash, and cmd scripts cannot route around
  existing denials in foreground commands, background tasks, or auto-approve.

### Control centers

- keyboard reducer tests cover movement, tabs, scope, apply, and Esc;
- `/permission` and `/permissions` reach the same view;
- permission writes update the live broker only after persistence succeeds;
- feature precedence is project override, then global choice, then compiled
  default;
- unknown feature ids and unsupported flags never activate code.

The existing full suite, typecheck, and build must remain green.

## Non-Goals

- replacing Ink or adopting Rust;
- alternate-screen mode or a permanently pinned header;
- automatic model routing;
- Linux activation in this release;
- arbitrary policy-rule editing;
- remote feature-code delivery;
- changing the current composer layout or Plif input identity.
