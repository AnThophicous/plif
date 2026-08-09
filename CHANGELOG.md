# Changelog

All notable changes to plif. This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/AnThophicous/plif/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AnThophicous/plif/releases/tag/v0.1.0
