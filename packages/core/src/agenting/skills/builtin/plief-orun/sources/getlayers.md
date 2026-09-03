# GetLayers

**Type:** AI design layer library, prompt library, source-file library, 3D scene source, MCP/skill ecosystem\
**Verification:** `VERIFIED_CURRENT` / `HIGH`\
**Last verified:** 2026-08-26

## Canonical profile

- Official source: `https://www.getlayers.ai/`
- Documentation: `https://www.getlayers.ai/docs`
- Repository: `None`
- Package: `None`
- Registry: `None`
- CLI: `None`
- Current version: `None`
- Installation model: `copy prompt, download category-specific source, or MCP/skill`
- Free/paid: `mixed free/premium`
- License: `plan/category specific; premium commercial license stated on premium layer pages`
- Framework support: `stack-agnostic prompt output, Next.js source for some categories, standalone HTML for 3D scenes`
- Styling: `UNVERIFIED`

## Operational notes

- Prompts and source files are distinct deliverables.
- Official docs say templates/sections source is Next.js, 3D scene source is standalone HTML, video backgrounds are files; do not model everything as React components.
- MCP requires eligible subscription.


## Artifact distinction
Prompt output, source implementation, 3D scene and video background are different artifact
classes. The official docs explicitly state category-specific source formats; never force
all layers into a React-component model.


## JIT triggers

Re-verify before:
- installation commands or exact slugs;
- imports/APIs/props not present in the local verified item;
- version-specific behavior;
- commercial/premium use when terms matter;
- claims that conflict with the current official source.

## Evidence

- `official docs` — Defines layer model, prompt vs source, category-specific formats and stack portability. — https://www.getlayers.ai/docs
- `official docs` — MCP/skill integration and subscription requirement. — https://www.getlayers.ai/mcp
