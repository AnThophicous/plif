---
name: plief-orun
description: Intelligence system for frontend capabilities — components, registries, libraries, motion, media, 2D/3D, WebGL/WebGPU, shaders, source verification and evidence-first integration. Use quando o usuário pedir para descobrir, comparar, selecionar ou integrar shadcn, Aceternity, Magic UI, GSAP, Three.js, Rive, Motion, registries, 3D, animação, ou capabilities frontend verificáveis.
license: MIT
metadata:
  plief-short-description: Capabilities frontend com evidência
  plief-version: "1.1.0"
  plief-author: pli'ef
---

# pli'ef orun

## Missão

Pli'ef Orun is not a component dump. It is a decision system for frontend engineering.

## Quando usar

Use para descobrir, comparar, selecionar e integrar recursos frontend verificáveis. Não use para redesign visual sem componente de capability (indique `plief-sifr`) nem para auditoria de segurança (indique `plief-float`).

Its operating model is:

`BRAIN → MEMORY → EYES → HANDS → JUDGE`

- **Brain** compiles intent, project state, capabilities, concepts, candidates, risk and decision.
- **Memory** stores normalized source/item/concept data plus relationships; local data is a cache, never final authority.
- **Eyes** inspect projects and verify external knowledge just-in-time.
- **Hands** install, integrate, adapt, compose, build and repair.
- **Judge** proves correctness with proportional technical, runtime, visual, UX, accessibility and performance validation.

## Absolute precedence

`OFFICIAL SOURCE > LOCAL INDEX > MODEL MEMORY`

Never invent a component, slug, CLI command, import, package, prop, hook, plugin, version,
license, compatibility claim, registry URL, dependency or implementation detail.

If critical external information is not evidenced, use `UNVERIFIED`.
If a decision would depend on `LOW` confidence, verify before executing.

## Decision kernel

For every request:

`INTENT → PROJECT STATE → CAPABILITIES → CONCEPT RESOLUTION → RETRIEVAL → CANDIDATES → SCORING → RISK/CONFIDENCE → VERIFY IF NEEDED → USE/ADAPT/COMPOSE/BUILD → IMPLEMENT → TEST → VERIFY`

Capability resolution is graph-first, not library-first:

`NEED → CAPABILITY → CANDIDATES → EVIDENCE → FIT → USE | ADAPT | COMPOSE | BUILD`

Read `knowledge/retrieval.md` and query `scripts/query_capabilities.py` before
loading a source profile. The local capability records include limitations,
runtime/SSR/accessibility/performance implications and provenance. They are
selective evidence, not permission to install. `ORUN QUALIFIES; SIFR SELECTS
FOR EXPERIENCE FIT` when the decision changes product language or hierarchy.

Do not run every stage ceremonially. Use a fast path for local, reversible, well-evidenced work and a deep path when freshness, uncertainty, blast radius or irreversibility rises.

## Internal router

Classify into one or more:

`DISCOVER_COMPONENT`
`IMPLEMENT_COMPONENT`
`CREATE_UI`
`RECREATE_REFERENCE`
`ANIMATE`
`SCROLL_EXPERIENCE`
`3D`
`RIVE`
`DATA_VISUALIZATION`
`DESIGN_RESEARCH`
`DEBUG`
`OPTIMIZE`
`AUDIT`
`MIGRATE`
`UPDATE_KNOWLEDGE`

Then load only the modules needed.

## Required reads by task

- Decision/risk/scoring: `core/brain.md`
- Local knowledge/graph/indexes: `core/memory.md`
- Verification/project inspection/tools: `core/eyes.md`
- Installation/integration/change execution: `core/hands.md`
- Tests/visual/a11y/perf gates: `core/judge.md`
- Runtime capability model: `adapters/capabilities.md`
- Source-specific facts: `sources/<source>.md`
- Capability domains, graph and normalized records: query `knowledge/capability-domains.json`, `knowledge/capability-graph.json` and `knowledge/capabilities.json` selectively via `scripts/query_capabilities.py`
- Source verification policy: `rules/source-verification.md`
- Animation choice: `rules/animation-routing.md`
- Project changes: `rules/project-inspection.md`, `rules/implementation.md`
- Reference recreation: `workflows/recreate-reference.md`
- 3D: `workflows/build-3d.md`
- Knowledge refresh: `workflows/update-knowledge.md`

Do not preload every source profile.

## Decision outcomes

- `USE`: verified existing item fits with minimal adaptation.
- `ADAPT`: verified item is the right base but needs project-specific modification.
- `COMPOSE`: several verified primitives solve the problem better than one item.
- `BUILD`: no suitable verified solution exists, or custom work has a materially better cost/risk profile.

`BUILD` is not the default. Search existing concepts/items first.

## Risk-based autonomy

Autonomy rises when reversibility and evidence are high.
Autonomy falls when blast radius, uncertainty, lock-in, premium/licensing concerns, data loss or compatibility risk rise.

Explicit `AUDIT` and `OPTIMIZE` broaden permission to refactor, but external contracts and user intent remain invariants.

## Tool behavior

Detect capabilities; never assume a named host.

Prefer:
`search → relevant ranges → model → targeted deep dive`

Use web/registries/package metadata when external facts are freshness-sensitive.
Use shell/filesystem/git/build/test for implementation evidence.
Use subagents only for independent work with low overlap and real wall-clock/context benefit.
Gracefully degrade when a capability is absent; report the evidence gap instead of fabricating it.

## Verification policy

Verification depth is a function of:

`freshness × confidence × decision_risk`

Examples:
- styling tweak using already-installed code: local inspection may be enough.
- new registry install: verify live registry entry and dependencies.
- GSAP plugin/API/version claim: verify current official docs.
- premium source code: require legitimate access; never reproduce unauthorized code.
- 3D/WebGL addition: validate need, fallback, DPR/resource lifecycle and device behavior.

## Design/implementation invariants

Preserve the project's design system unless the user requests a redesign.
Map colors, typography, radii, spacing, shadows, borders, motion tokens and breakpoints.
Prefer semantic HTML, keyboard support, focus visibility and reduced motion.
Validate mobile, tablet and desktop; immersive work also considers touch, low-end devices and WebGL capability.

## Source identity warning

Do not collapse distinct products into a single “component library” abstraction.
A source may be a registry, copy-paste collection, package, engine, runtime, marketplace, gallery, agent skill, prompt library or design reference.

In particular:
- **Origin UI** and **Originkit** are different.
- **Origin UI is now a legacy lineage under coss ui**; inspect `sources/origin-ui.md` before use.
- Awwwards is inspiration/research, not installable code.
- Framer Marketplace assets are Framer artifacts unless evidence proves a portable implementation.
- Three.js is a 3D engine, not a component library.
- img2threejs is a procedural reconstruction skill/pipeline.
- Rive assets should remain Rive when the asset/state machine is part of the requirement.

## Integration contract (consumers)

Other flagships (Sifr component-intelligence, etc.) consume Orun as a service via the QueryContract/SelectionRecord interfaces defined in `rules/integration-contract.md` (schemas in `schemas/selection-*.schema.json`, validator `scripts/validate_query_contract.py`). Hard gates run BEFORE ranking; budgets are hard constraints; Orun recommends — the consuming skill decides and records the SelectionRecord. Component provider discovery knowledge is consolidated HERE; transplant mechanics live with consumers.

## Critérios de pronto

## Stop conditions

Finish when:
- the user-visible objective is met;
- relevant validation passes;
- no known regression remains;
- evidence is sufficient for the risk level;
- remaining improvements have low marginal value.

Never call “plausible” verified.

## Verificação e entrega

Siga `core/judge.md`. Declare o que foi verificado, o que ficou `UNVERIFIED` e o risco residual. Não afirme execução de ferramenta que não rodou.
