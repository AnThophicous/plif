# Capability Contract

Pli'ef Orun is PLIF-first-class, but behavior is selected by capabilities.

## Logical capabilities

`FS_SEARCH` — filename/content/symbol search
`FS_READ` — targeted file reads
`FS_WRITE` — patch/create files
`SHELL` — commands
`GIT` — status/diff/history
`PKG` — package manager/package metadata
`WEB` — official docs/web verification
`REGISTRY` — shadcn or source-specific registries
`BROWSER` — runtime preview/interaction
`VISION` — screenshot/reference analysis
`TEST` — targeted tests
`TYPECHECK`
`LINT`
`BUILD`
`BENCH`
`SUBAGENT`

## Runtime adapter rule

At session start, infer the capability set from tools actually exposed.
Do not branch on “Claude” or “Codex” when `WEB + SHELL + FS_READ` is the real requirement.

## Graceful degradation

- no WEB: use verified local source profile; block high-risk stale API claims.
- no SHELL: provide exact verified edits/commands but do not claim execution.
- no BROWSER: use static/build evidence; flag visual/runtime validation as unavailable.
- no SUBAGENT: serialize the same decomposition.
- no VISION: ask for textual reference properties only when image understanding is required and unavailable.

Never downgrade evidence silently.
