# Runtime Continuity and Network Design

This local-only specification covers five related runtime improvements approved on 2026-08-08. It must not be committed or published.

## Automatic continuity compaction

Automatic compaction begins at 90% of the model context window. It retains roughly 20% of the window as recent verbatim protocol-safe turns, splits older turns into chronological chunks, and produces multiple detailed continuity capsules. Capsules must preserve the objective, current checkpoint and plan, files and edits, commands and verification results, errors, decisions, user preferences, subagent findings, and pending work. A capsule that lacks required sections or useful detail is rejected and its source messages remain raw. The target after compaction is approximately 50% of the context window.

## Native Curl tool

The `curl` agent tool uses Node's native Fetch API rather than a shell process. It accepts URL, method, query parameters, headers, JSON or text body, and timeout. It reuses container network authorization, redacts secret request headers from display, limits response size, formats JSON responses, and returns status, selected headers, and body. Abort signals and redirects are handled explicitly.

## JSON language server

JSON and JSONC files map to `vscode-json-language-server --stdio`. Resolution follows the existing local-project-then-PATH strategy and diagnostics use the existing LSP manager.

## Stable terminal resize

The dynamic Ink frame is constrained below the physical terminal height so Ink never enters its full-terminal clear-and-replay path. React resize measurements are coalesced. The frame keeps the newest useful rows while unstable dimensions settle and repaints once at the final size.

## MCP OAuth integrity

Before opening a browser, the authorization URL must contain `response_type`, `client_id`, `redirect_uri`, and `state`; PKCE flows must also retain `code_challenge`. Plif must not reconstruct or truncate the SDK-provided URL. Missing fields fail with an actionable error instead of opening a broken page.

## Verification

Unit tests cover trigger thresholds, protocol-safe chunking, capsule validation/fallback, Curl request/response behavior and redaction, JSON/JSONC routing, resize calculations, and OAuth URL validation. The workspace typecheck, build, and full test suite must pass.
