# Conversation state

PLIF keeps the transcript as the canonical record of a session. Provider-native
continuation is an optimization layered beside that record: if it is missing,
invalid, expired, or incompatible, PLIF can always reconstruct the next request
from the local transcript.

## Policy

Set `conversationState` in `~/.plif/config.toml`, or use the temporary
`PLIF_CONVERSATION_STATE` environment variable:

- `auto` (default): use native continuation when the provider supports it and
  fall back to transcript replay when it does not;
- `native`: prefer native continuation, but still fall back safely when the
  provider rejects or loses its state;
- `replay`: disable native state and send the normal local replay path.

The setting is provider-agnostic. Providers without a native adapter continue
to use the existing local message replay path.

## Codex

For the Codex provider, the native pointer is the server-owned `threadId`. PLIF
uses `thread/start` for a new durable thread and `thread/resume` for a saved
thread, followed by `turn/start`. The app-server remains the owner of ChatGPT
authentication, permissions, tools, and the native conversation.

After a successful turn, PLIF writes a sidecar next to the session transcript:

```text
~/.plif/sessions/<workspace-key>/<session-id>.state.json
```

The sidecar contains only a provider/model/endpoint-scoped pointer and
non-sensitive telemetry. It never contains API keys, ChatGPT credentials,
cookies, or arbitrary provider responses. Writes use a unique temporary file
and an atomic rename. The JSONL transcript remains the recovery source of
truth; a sidecar is discarded by the reader if malformed.

When a saved thread cannot be resumed, PLIF starts a fresh non-ephemeral native
thread and replays the canonical local messages. When resume succeeds, only
the current user turn is sent; resending the entire local transcript would
duplicate context and can cause repeated answers.

Native state is rejected when provider, model, endpoint, protocol, or account
scope changes. Interrupted, cancelled, or failed turns do not replace the last
known-good pointer.

## Response IDs

Local session IDs, turn IDs, event IDs, and database IDs are never sent as
`previous_response_id`. The repository currently has no Responses API adapter;
if one is added later, it must persist and reuse only the actual server-issued
response `id`, scoped to the same provider/model/endpoint/account, and fall back
to replay for invalid, expired, or not-found IDs.

## Observability

The loop result exposes continuation metrics when a provider reports them:
state mode/kind, message count, payload size, token usage when available,
cache counters when available, latency, and fallback reason. Identifiers are
not printed as user-facing telemetry.

## Validation

The core tests cover atomic sidecar persistence, malformed-state recovery,
concurrent writes, Codex native start, successful resume with current-turn-only
input, and resume failure followed by full replay on a fresh native thread.
