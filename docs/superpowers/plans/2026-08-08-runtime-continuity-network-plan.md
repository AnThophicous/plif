# Runtime Continuity and Network Implementation Plan

> **Local-only:** Do not commit or publish this file.

**Goal:** Preserve long-running agent continuity while adding safe native HTTP access, JSON diagnostics, stable terminal resizing, and correct MCP OAuth URLs.

**Architecture:** Each subsystem remains isolated behind its existing boundary: compaction in the harness, HTTP in web tools, languages in LSP server discovery, terminal sizing in the CLI hook/layout, and OAuth validation in the coordinator. Work proceeds inline with one verification checkpoint per subsystem.

**Tech Stack:** TypeScript, Node Fetch, Ink, MCP SDK, node:test.

## Checkpoints

- [x] Add failing compaction tests, then implement 90% hierarchical continuity capsules with safe fallback.
- [x] Add failing Curl tests, then implement and export the native network tool.
- [x] Add JSON/JSONC routing tests, then register and resolve the JSON language server.
- [x] Add resize regression tests, then cap/coalesce the live frame without duplicating static output.
- [x] Add OAuth parameter-integrity tests, implement validation, and run full typecheck/build/tests plus CLI smoke test.
