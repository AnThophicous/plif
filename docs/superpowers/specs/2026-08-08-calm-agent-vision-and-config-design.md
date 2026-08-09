# Calm Agent, Live Subagents, and Vision Provider Design

## Goal

Keep an active Plif session readable while preserving useful parallel work. Tool
bursts are bounded, operational state stays in the fixed prompt frame instead of
the transcript, and a delegated agent becomes a live, inspectable mini-session.
When the active model cannot inspect a pasted image, Plif can safely offer a
vision-capable subagent without silently spending a user's credits.

## Tool-call discipline

`runLoop` enforces a maximum of three parallel-safe tool calls per model turn.
Normal effectful tools remain sequential. If a provider response asks for more
than three calls, only the first three are executed and shown in the timeline.
The remaining calls receive private deferred tool results explaining that Plif
limited the batch to keep the developer's terminal readable. They do not create
visible error rows.

The system prompt reinforces this as an interface-quality rule: inspect results
progressively and avoid broad tool bursts because they pollute the user's
terminal. It is guidance, not a ban on work; the executor is the final bound.

## Fixed operational frame and compact timeline

The status line moves inside the bordered prompt frame, above the editable input.
It is therefore redrawn in the dynamic footer and never becomes scrollback. The
line contains the workspace, selected model when space permits, and a compact
context meter. The old `job`/isolation label is removed from this visual line.

Command output stays collapsed by default: a command has one compact `Ran`
summary and a short, representative output preview. The full transcript is
opened explicitly rather than emitted into the main timeline. Consecutive file
edits in one agent turn are represented as a single `Edited N files (+A -D)`
entry with per-file unified-diff sections when expanded. Completed thinking is a
quiet gray, collapsible timeline row; its expanded form shows a `Thinking:`
heading and a rail-prefixed reasoning transcript. The active travelling blue
highlight moves at a readable cadence rather than display-refresh speed.

## Live subagent sessions

The main timeline has only the parent `subagent` call. Every running child is
shown as a compact row and may be opened with the existing terminal selection
controls (`Ctrl+S`; `Tab` selects a child). The expanded panel resembles a small
Plif session: title/model/context line, active or completed thinking, compact
tool rows, streamed text, and completion summary. Child activity never joins the
parent transcript.

Each child relays `agent.usage` from its private bus. Its own context meter
updates during execution. The fixed parent status line also includes a separate
live delegated-token tally. This tally is deliberately separate from the parent
context percentage: adding independent child windows to the parent's window
would falsely imply that the parent is closer to compaction.

## Image-capability escalation

An image can be inspected only by a provider/model declared vision-capable.
Unknown models are never inferred to support images merely because an endpoint
lists their id.

When the active agent needs an image it cannot see, it can invoke a discovery
tool that returns configured vision candidates. It tells the user why the image
cannot be read and presents a dedicated selection dialog:

1. A declared vision candidate may be labelled **Recommended Provider**.
2. All configured vision-capable alternatives are listed below it.
3. `Cancel` is the safe default.
4. Choosing any candidate opens a second confirmation containing
   the exact model, provider, endpoint, and cost classification: free, paid, or
   unknown.
5. The confirmation offers `Use this model whenever vision is needed?` with a
   safe default of no. Explicitly choosing yes persists that exact provider/model
   as the user's vision preference; future image delegations use it without
   reopening the menu.
6. If global auto-approve is enabled, a configured or newly selected candidate
   starts without an additional permission question. If it is disabled and no
   saved vision preference exists, confirmation is required.
7. Only explicit confirmation starts a vision subagent. Declining or cancelling
   returns a clear result to the parent and does not call a model.

The source image attachment is transferred only after selection or a saved
preference is authorised; its result returns to the parent as the usual concise
subagent result. A custom provider follows the same preference and approval
rules.

## Custom OpenAI-compatible providers

Every custom provider uses the existing OpenAI-compatible adapter. Configuration
adds an explicit `sdk: "openai"` marker (the only allowed value) plus a display
name, `options.baseURL`, optional environment-resolved credential, and model
metadata. Model metadata supports `modalities`, `contextWindow`, and a cost
classification. A provider or model can be fully usable for text without being
eligible for the vision picker.

```jsonc
{
  "provider": {
    "my-provider": {
      "name": "My Provider",
      "sdk": "openai",
      "options": { "baseURL": "https://api.example.com/v1" },
      "models": {
        "vision-model": {
          "name": "Vision Model",
          "modalities": ["text", "image"],
          "contextWindow": 128000,
          "cost": "unknown"
        }
      }
    }
  }
}
```

The model-list discovery tool may query an endpoint for IDs, but it cannot grant
vision eligibility. Endpoint-discovered IDs are merged only with locally
declared metadata. Secrets are not printed in either the picker or confirmation.

## Public JSON Schema

The schema currently declares `https://plif.dev/config.json`, which is not
hosted. Its `$id` and the generated config `$schema` are changed to the public
raw GitHub location:

`https://raw.githubusercontent.com/AnThophicous/plif/main/packages/core/schema/config.schema.json`

The schema is expanded to validate `agent`, `provider`/`providers`, the OpenAI
adapter marker, endpoint, model modalities, context window, and cost metadata.
The committed schema is consequently reachable as soon as the branch is pushed
to GitHub.

## Safety and tests

- Scheduler tests cover a ten-call response: three visible/executed calls and
  deferred private results for the rest, preserving tool-message protocol.
- Render/reducer tests cover the fixed prompt header, compact transcript states,
  edit aggregation, and readable highlight cadence.
- Subagent tests cover live usage relaying and ensure child activity remains out
  of the parent transcript.
- Vision tests cover no candidate, cancel, paid/unknown confirmation, decline,
  and image transfer only after confirmation.
- Config/schema tests validate custom providers, non-vision exclusion, the raw
  GitHub `$schema` URL, and redaction of credentials.
