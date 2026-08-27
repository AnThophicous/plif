# Eyes — Inspection, Retrieval and Verification

## Capability detection

Detect available operations, not brand names:
- list/read/search files
- run shell
- inspect git
- run package manager
- query registry/package metadata
- browse web/docs
- render/preview browser
- capture visual evidence
- run tests/build/typecheck/lint
- delegate independent research

Missing capability → degrade to the next strongest evidence source and mark gaps.

## Project inspection

Before installation or integration, determine when relevant:
- framework + version
- React version
- language
- package manager + lockfile
- Tailwind version
- shadcn `components.json`
- aliases
- directory conventions
- UI/animation libraries already installed
- design tokens/theme
- build/test scripts
- SSR/RSC/client boundaries

Prefer one targeted project-info command/search over reading the repository indiscriminately.

## External source evidence ladder

1. official current docs
2. official repository
3. official registry
4. official package metadata
5. official examples
6. official source code
7. author-maintained docs
8. secondary discovery source

A secondary source can tell you where to look, not finalize a critical fact when official evidence exists.

## Anti-hallucination gate

Before emitting an external command/import/API:
- exists?
- current?
- correct source?
- correct slug/package?
- correct stack/version?
- dependency and peer dependency known?
- free/premium status known?
- license/use terms known when material?

If no: `STOP → VERIFY → CONTINUE`.

## Search economy

Search by intent and behavior, then inspect only top candidates.
Never read all source profiles “just in case”.
