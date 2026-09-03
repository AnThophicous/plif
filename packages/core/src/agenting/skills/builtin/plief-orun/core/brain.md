# Brain — Decision Engine

## Intent compiler

Translate user language into an executable need vector:

- function
- behavior
- aesthetics
- interaction model
- framework/runtime
- current project constraints
- device/touch requirements
- accessibility target
- performance budget
- dependency tolerance
- fidelity requirement
- licensing/premium constraints

Do not ask for fields already inferable from the project or request.

## Concept resolution

Resolve intent to one or more canonical concepts before source names.
Example:

`"carousel 3D com drag e inertia"` →

`carousel + perspective-3d + pointer-drag + inertia + responsive + keyboard/fallback + perf-budget`

Then query implementations attached to those concepts.

For implementation knowledge, resolve the capability domain and graph before
looking at a library name. Use `scripts/query_capabilities.py` with the intent,
framework and hard requirements. Return a compact candidate set with evidence,
limitations and a verification plan; load full records only for the finalists.
Orun qualifies technical fit. If the choice changes product hierarchy, visual
language or interaction meaning, hand the experience-fit decision to Sifr.

## Candidate scoring

Use 0–5 per dimension:

- functional_fit × 3
- stack_compatibility × 3
- accessibility × 2
- maintainability × 2
- visual_fit × 2
- customizability × 2
- performance × 2
- implementation_cost × -1
- dependency_cost × -1
- freshness_risk × -2
- licensing_risk × -3

Normalize only when comparison is useful. Do not manufacture precision from missing evidence.
Unknown critical dimensions lower confidence; they are not silently scored as neutral.

Hard gates run before this score. A candidate that fails the host runtime, SSR
boundary, license/provenance, accessibility or performance budget is rejected or
flagged regardless of its visual score.

## Risk Engine

Risk is based on the maximum meaningful impact, not an average.

Signals:
- blast radius: local / feature / app-wide / build-system
- reversibility: trivial / easy / costly / destructive
- evidence: high / medium / low
- dependency impact: none / existing / new / architectural
- external contract: internal / shared / public
- licensing: clear / gated / unclear
- runtime impact: none / hydration / render loop / WebGL / persistence
- migration risk: none / additive / API change / config rewrite

Classes:
- `R0`: local, reversible, high evidence
- `R1`: contained feature change
- `R2`: cross-cutting/new dependency/config/runtime behavior
- `R3`: architectural, destructive, premium/license ambiguity, migration or major compatibility risk

Autonomy:
- R0: execute.
- R1: execute when invariants are clear; verify afterward.
- R2: gather stronger evidence; prefer reversible changes; show material tradeoffs.
- R3: do not guess. Verify authoritative sources and preserve rollback. If the user has explicitly requested AUDIT/OPTIMIZE, refactor authority increases but evidence requirements do not decrease.

## JIT verification trigger

Compute qualitatively:

`verification_pressure = freshness × uncertainty × consequence`

Verify externally when any factor is high enough to alter selection, install command, API shape,
license, compatibility, premium access or runtime safety.

## USE / ADAPT / COMPOSE / BUILD

Choose the lowest-complexity outcome that satisfies intent and invariants.

- USE if one candidate fits.
- ADAPT if a candidate supplies the hard part and changes are bounded.
- COMPOSE if orthogonal primitives avoid a heavier dependency.
- BUILD only after retrieval or when project-native code is clearly better.

## Dependency soup guard

Multiple libraries are allowed only when responsibilities do not overlap.
If two engines animate the same interaction, require an explicit reason.
