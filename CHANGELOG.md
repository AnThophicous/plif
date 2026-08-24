# Changelog

All notable changes to plif. This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.8] — 2026-08-23

### Added

- **Isolated `/temp` workspace.** Every interactive and one-shot agent session
  now receives a dedicated scratch directory mounted at `/temp`, separate from
  the project mount at `/project`.
- **Visible temp policy.** `/temp` explains the intended split: transient
  artifacts stay disposable, while `/project` is reserved for requested
  deliverables. The command is keyboard-friendly and safe to run while the
  agent is working.
- **Default container coverage.** Containers created by the agent and by
  `/new` inherit the isolated scratch mount. An explicitly supplied `/temp`
  mount remains authoritative instead of being duplicated.

### Security

- Scratch directories are created with the operating system's unique temporary
  directory primitive, validated to remain under the system temp root, and
  cleaned idempotently at session shutdown.
- Cleanup refuses to follow a replaced symlink or remove a path outside the
  session's validated temp boundary.
- The physical host scratch path is not written to the transcript or exposed to
  the model; the model receives only the stable virtual path `/temp`.
- The system prompt now distinguishes `/project` from `/temp` and directs logs,
  screenshots, probes and intermediate output away from the user's repository.

### Validation

- Full Windows validation: **1,096 tests passed, 0 failed, 20 platform skips**.
- Typecheck and targeted `/temp` mount/cleanup tests pass.

## [0.3.6] — 2026-08-22

### Added

- **Provider-backed model discovery.** `/model` now preserves provider, product,
  tier, protocol and stream metadata instead of guessing from model names.
- **OpenCode Go models.** The paid Go catalog is explicit, including the
  Anthropic-compatible Qwen 3.8 Max route and DeepSeek V4 Flash.
- **Protocol-aware content handling.** OpenAI-compatible delta streams,
  snapshot responses and Anthropic message streams are normalized separately,
  with divergence checks for malformed repeated content.

### Changed

- Model configuration now carries the selected provider's protocol and stream
  semantics all the way to the adapter, so the UI selection cannot silently
  route through the wrong transport.
- Model discovery cache entries retain their source and raw provider metadata,
  while stale results remain available during a controlled refresh.
- The PLIF interface keeps its restrained neutral base and uses the pink accent
  only for meaningful active and branded states.

### Fixed

- Repeated assistant text caused by treating snapshots as deltas is no longer
  appended indefinitely.
- Provider-specific paid/free classification no longer relies on a `-free`
  suffix or accidentally requests a key for an unrelated model.
- The `PLIF` effort now requires the `galileu` skill before any answer, question,
  plan, command or other tool call; missing skill configuration fails closed
  instead of silently bypassing the review procedure.
- Subagents inherit the active skill catalogue and Galileu loader, so PLIF's
  mandatory review gate remains intact when work is delegated.
- Startup/version metadata and workspace package dependencies are aligned for
  the `0.3.6` release.

### Distribution

- Published as `@plif/cli@0.3.6`, with matching `@plif/core@0.3.6` and
  `@plif/sandbox@0.3.6` packages.
- The GitHub release is [v0.3.6](https://github.com/AnThophicous/plif/releases/tag/v0.3.6).
- The package README now documents both reproducible version-pinned installs
  and the `@latest` upgrade path.

## [0.3.5] — 2026-08-21

### Added

- **`/status`.** A read-only full-screen snapshot of the current session,
  provider, model, effort, context, configuration source and integrations,
  with credentials redacted.
- **`/config`.** A keyboard-first settings browser with search, categories,
  inline editors and atomic TOML persistence, reusing the existing provider,
  model, effort, MCP and skills flows.
- **Adaptive task waiting.** Long-running work now waits on task lifecycle
  events with a slow, cleaned-up fallback check instead of polling the model
  or transcript on every UI tick.

### Changed

- The startup surface is now a compact PLIF identity panel: the wordmark sits
  above the outline, the mascot anchors the left side, and readiness stays
  quiet on the right. Runtime diagnostics no longer crowd the home screen.
- `/model` is provider-aware: it shows usable models, keeps the active model
  explicit, reveals details by default, qualifies duplicate names only when
  needed, and uses `/providers` as the deliberate unlock path for paid models.
- Clean installs use the explicitly free OpenCode route when available, so a
  DeepSeek free model does not trigger an unrelated API-key prompt.
- Full-screen utility views own their keyboard and animation lifecycle, while
  terminal resize and narrow-layout behavior have additional coverage.

### Fixed

- Configuration edits no longer need to duplicate provider/model state or expose
  credentials in the screen, transcript or persisted plaintext config.
- A stale or unreadable credential record no longer blocks anonymous/local
  model routes; paid providers remain locked until their credential is fixed.
- Task completion no longer disappears from the active timeline when the final
  answer is committed; monitor cancellation, timeout and cleanup are explicit.

## [0.3.0] — 2026-08-13

### Added

- **Anthropic provider.** Claude runs through the official `@anthropic-ai/sdk`
  rather than an OpenAI-compatible shim, with streaming, tool use and verbatim
  thinking replay. The adapter is chosen from the endpoint, so nothing else in
  the harness needs to know which provider is in play.
- **Eleven more providers.** Anthropic, Google Gemini, xAI, Mistral, Cerebras,
  Fireworks, Z.AI, Moonshot (Kimi), Perplexity, Hyperbolic and SambaNova join
  the built-in list; OpenAI is labelled ChatGPT so it can be found by the name
  people use for it.
- **Live model discovery.** `/model` asks each provider what it actually serves
  instead of showing a list frozen at release time, ranked so the models people
  reach for come first. Providers with no credential are skipped instantly, and
  the answer is cached for the process.
- **Paged provider lists.** A provider with more than ten models shows its top
  ten and a "show N more" row, so one crowded gateway cannot push every other
  provider off the screen.
- **PowerShell installer.** The GitHub installer now has a compact ASCII
  banner, clear preflight checks, safer failure messages, uninstall support and
  a welcoming post-install guide.

### Changed

- **plif ships with no model.** There is no default provider and no default
  model; the first run opens the picker instead of quietly pointing the agent
  at an endpoint nobody chose.
- **The model picker separates yours from ours.** Providers declared in your own
  config appear first, under their own heading, above the ones plif ships.
- The credential popup names the provider and the environment variable it would
  accept instead, and entering a key immediately re-runs discovery for that
  provider.

### Fixed

- Picking a model discovered from a live endpoint works. It previously did
  nothing at all — the selection was validated against the hardcoded catalogue,
  so any id the endpoint had added since release was silently unselectable.

### Earlier 0.3.0 release notes — 2026-08-12

Official release for the new conversation harness, navigable Ink interface, MCP reliability work, NVIDIA NIM support, and Markdown-native skills.

### Added

- **Canonical conversation history.** Versioned session events now preserve user messages, assistant commentary/final responses, tool calls and results, approvals, questions, compaction, failures, and interrupted turns without flattening provider roles.
- **Navigable transcript.** `Ctrl+T` opens the complete transcript; arrows, Page Up/Page Down, Home/End, and Esc provide line, page, boundary, and close navigation while native terminal scrollback remains available.
- **DME skill package and discovery tools.** Skills can be grouped, inspected, loaded on demand, and routed proactively without flooding the conversation. The DME package ships with focused design capabilities while flat legacy skills remain compatible.
- **Work dock and Plif focus frame.** Background tasks and subagents share a compact surface, with responsive context/workspace information attached to the existing Ink composer identity.
- **Durable memory ranking.** Reusable facts are ranked by confirmation, contradiction, recency, and prompt budget instead of being selected only by arrival order.
- **NVIDIA NIM provider.** The model picker includes curated NVIDIA models and can expand the NVIDIA account catalogue when a stored credential is available.
- **Markdown-native builtin skills.** Context ingestion, slide decks, deep engineering audits, Galileu, and Office rendering are loaded from the agenting skill tree.

### Changed

- The normal TUI is content-sized instead of reserving the entire terminal. The compact session header remains visible, while only the transcript and extension browser use full-screen layouts.
- Model text and reasoning update the timeline directly from SSE deltas; the active answer is also visible in the `Ctrl+T` transcript before it is persisted.
- Completion tokens are estimated independently of SSE chunk boundaries and reconciled with cumulative provider usage. Slash and shell commands no longer increment agent turns or start the agent timer.
- Routine tool activity is compacted, while diffs, failures, approvals, and questions retain dedicated rows. Running state, spacing, narrow-terminal collapse order, and Windows resize handling were simplified.
- Prompt compilation now gives MCP and skills clearer discovery, fallback, and error-isolation instructions.

### Fixed

- Resumed sessions reconstruct protocol-correct assistant tool calls and `tool` results instead of fabricating assistant prose.
- Truncated or mixed legacy JSONL sessions recover prior valid events and mark unfinished work as interrupted rather than leaving a permanent running row.
- MCP connection and tool failures remain bounded to the affected server/tool instead of destabilizing the whole harness.
- OpenAI-compatible streaming handles interrupted/idle SSE responses, visible retry/reset behavior, reasoning-field variants, and reasoning-effort capability fallback more consistently.
- The opening header is no longer pushed out of view by a terminal-height dynamic frame, and `Plif Thinking` is no longer duplicated inside the input.

### Install

```powershell
npm install -g @plif/cli@latest
```

## [0.2.0] — 2026-08-09

<img src="assets/changelog-0.2.0.svg" alt="plif 0.1.0 to 0.2.0" width="860">

91 files across `packages/`, +5 805 / -1 454, 490 tests passing.

### Added

- **Modular prompt compiler.** The single instruction blob became `packages/core/src/harness/prompts/`: a compiler plus per-mode instructions for the primary agent, subagents, explore, review and compaction, with separate modules for environment, project, tools, skills and MCP context.
- **`curl` tool.** HTTP requests without going through the shell — methods, query parameters, headers, JSON or text bodies, manual redirect handling with a fresh host approval per hop, and a byte ceiling on the response. Credentials are stripped when a redirect crosses origins, and secret headers are never echoed back.
- **`update_plan` tool.** A short execution plan for genuinely multi-step work, rendered as a live checklist rather than repeated in prose.
- **`get_config` and `update_config`.** The agent can read its own configuration with credentials redacted, and change the active model, vision model, theme, auto-approve, or add an OpenAI-compatible provider — behind a confirmation panel unless Auto Approve is on.
- **Vision tools.** `inspect_image` and `list_vision_models` delegate an image to a vision-capable model without changing the main model.
- **`create_skill`, and three built-in skills.** Skills can now be written from inside a session and loaded without a restart. Ships with `skill-creator`, `anti-ai-slop` and `dme-eclipse-design`.
- **User themes.** Theme documents in `~/.plif/*.theme` with a published JSON schema at `packages/cli/schema/theme.schema.json`.
- **Discovery panel.** Batched reads and directory listings collapse into one row instead of flooding the timeline.
- **Shell highlighting** for commands in the timeline, and a terminal title that tracks the session.
- **More language servers.** Shell (shellcheck) and PowerShell Editor Services, with resolution that survives npm `.cmd` shims.

### Fixed

- **Typing is no longer mistaken for a paste.** Ink hands over whatever `stdin.read()` had buffered, so an auto-repeated space or two keystrokes landing in the same frame arrived as one chunk — and any chunk longer than one grapheme was being turned into a `[Pasted Content]` attachment mid-sentence. plif now enables bracketed paste and reads the terminal's own markers; the fallback for terminals that ignore it requires more than one line of content.
- **Each turn keeps its own paragraph.** Assistant text from consecutive turns was concatenated with no separator, so the last word of one turn ran into the first word of the next in the recorded session and on resume.
- **Resizing the window no longer duplicates the session.** Ink handles `SIGWINCH` before React can render at the new size, and its intermediate frame can be taller than the restored window — which triggers `clearTerminal` plus a full static replay, and on Windows that puts a second copy of the whole session on screen. plif owns resize itself and now detaches only the listener Ink registered, leaving application listeners alone.

### Security

- **`get_config` redacts by location, not by key name.** The previous denylist matched `apiKey`, `token`, `secret` and `password`, which misses the two places a credential actually lives: an HTTP MCP server keeps its bearer token in `headers.Authorization`, and a stdio server keeps it in `env` under whatever the vendor named the variable. Both were returned verbatim to the model and therefore to the model's endpoint. Everything inside `headers` and `env` is now redacted wherever it appears, while the model keeps what it needs to manage configuration.

### Changed

- The startup mark is redrawn.
- `@plif/cli`, `@plif/core` and `@plif/sandbox` are published as compiled output only. Source stays in this repository.

## [0.1.0]

First release.

[0.3.8]: https://github.com/AnThophicous/plif/compare/v0.3.7...v0.3.8
[0.3.6]: https://github.com/AnThophicous/plif/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/AnThophicous/plif/compare/v0.3.0...v0.3.5
[0.3.0]: https://github.com/AnThophicous/plif/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/AnThophicous/plif/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AnThophicous/plif/releases/tag/v0.1.0
