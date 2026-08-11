# DME Skill Package and Tool Discovery Design

**Date:** 2026-08-11
**Status:** approved for implementation
**Publication:** local internal design; do not commit or publish without separate authorization.

## Goal

Make Plif discover relevant skills and MCP tools without requiring the user to name them, while turning the monolithic DME design skill into one visible package whose focused child skills can be routed and loaded independently.

## Architecture

The skill registry gains optional package metadata. Flat user and project skills remain compatible, while bundled DME skills render under one active `DME Skill` catalogue group. The `skill` tool continues to load a child by its exact name, so package grouping changes routing context without adding another tool round trip.

The built-in DME body moves into a dedicated source package with focused skills for frontend implementation, design systems, wireframes and options, interactive prototypes, and visual verification. Each body is original Plif guidance derived from general design principles in the supplied references; no source prompt is copied wholesale.

The prompt modules for skills and MCPs add a quiet capability preflight. For each request, the model briefly checks the already-present catalogue and tool schemas, uses a capability when it clearly improves the result, and does not announce an empty scan. A missing, irrelevant, unhealthy, or repeatedly failing integration is skipped in favor of the normal local workflow. Explicit user requests still override opportunistic routing, subject to permissions and safety.

## Data model

`Skill` receives an optional package descriptor containing a stable package id and display name. Package metadata participates in registry precedence with the skill it belongs to and never changes the exact child skill name used by `skill`.

The catalogue format remains plain text but becomes hierarchical for packaged entries:

```text
Package: DME Skill [active]
  - dme-frontend: ...
  - dme-design-system: ...
```

Unpackaged skills retain the existing `- name: description` format.

## Behavior

- Every task receives a silent relevance scan over capabilities already exposed in context.
- Matching is driven by catalogue descriptions and tool schemas, not by the user having to say “skill” or “MCP”.
- Only the smallest sufficient set is loaded or called.
- Read-only discovery may happen proactively when useful; external mutation still requires request scope and runtime authority.
- A capability that is absent, irrelevant, malformed, unavailable, or producing bad results is ignored after a bounded attempt. It must not block the task or create repeated retries.
- The user sees skill or MCP activity only when it causes meaningful work, an external effect, a material process change, or a blocker.

## Compatibility

- Existing user/project skill directories and `create_skill` remain flat and unchanged.
- Existing callers of `SkillRegistry`, `BUILTIN_SKILLS`, and `skill` remain valid.
- The old monolithic `dme-eclipse-design` entry is replaced by focused DME children; no runtime migration or dependency is added.
- MCP transport and failure isolation stay unchanged; this feature adjusts selection policy, not connectivity.

## Verification

Unit tests cover package grouping, child loading, DME inventory, flat-skill compatibility, proactive skill routing language, quiet MCP inspection, and graceful fallback wording. Then run the focused core tests, workspace typecheck, and build.
