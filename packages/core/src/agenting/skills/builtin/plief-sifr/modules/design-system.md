# Design System — decision compression

Extract / Repair / Extend / Migrate / Create modes. Never generate a token file reflexively; skip entirely for one-off fixes with no reusable decision.

## Establish authority & grammar

Locate true sources (CSS vars/theme files, utility config, primitives APIs, fonts, icons, brand assets, global CSS, rendered surfaces, tests/stories) with evidence precedence `structured source > component behavior > recurring rendered pattern > isolated reference > assumption`; classify observed/inferred/missing/contradictory. Frequency alone does not prove intent — decide per repeated pattern whether it's intentional grammar | accident | exception | duplication | contradiction; never encode accidental inconsistency as system.

## Layer model & token admission

`primitive values → semantic tokens → component contracts → compositions`. A token exists only if the decision recurs, has semantic meaning, consumers must coordinate, or central change is useful. Reject token theater (per-pixel tokens, hundreds of unconsumed aliases, names restating values, semantic aliases hiding exceptions). Names should survive redesign better than raw implementations do.

## Subsystems

- Typography roles defined from product use (display|page-title|section-title|body|compact-body|label|metadata|data|code|annotation), each with family/size-behavior/lh/tracking/measure/truncation/numeral behavior; inspect body vs dense-control vs tabular vs code separately; no second family while weight/width/optical-size can carry hierarchy.
- Color as `primitive palette → semantic role → component state`; themes are authored semantic mappings, not inversions; verify contrast/disabled/selected/status/overlay interactions per theme. Perceptual spaces only when maintainable here.
- Spacing models rhythm AND density modes when justified; shape/radius hierarchy deliberate or near-zero; elevation semantics by meaning not shadow size; glass/material effects need fallback+deployment limits+budget (fallbacks live in accessibility module rules, referenced once).
- Motion tokens only for recurring meaningful categories (state feedback, spatial transition, entrance/exit, progress, attention) with duration range/easing/interruption/reduced-motion equivalents. Engine routing choice belongs to Orun knowledge, not here.
- Icons: existing family first, single coherent library second, custom SVG for brand/diagrams/bespoke needs; normalize optical weight; no mixed families casually.

## Component inventory & API quality

Build components the PRODUCT uses with full contracts (role/anatomy/states/variants/density/content/a11y contract/keyboard/responsive/composition rules/forbidden combos/extension points). Semantic variant axes over styling-trivia props; adapters for external primitives preserve proven behavior/accessibility while mapping into product semantics without leaking provider vocabulary.

## Repair/migration discipline

Dominant pattern identification → consumer mapping → blast radius estimate → root owner normalization with aliases/deprecation paths when usage is broad; migrate high-risk consumers first, validate rendered downstream surfaces, remove dead layers safely. Drift detection list: raw values below token layer, near-duplicate semantic colors, radius proliferation, divergent control heights, duplicate primitives, inconsistent icon families, unbounded z-index, motion timings without taxonomy.

Governance proportional to contributors/blast-radius (no committee for 3-component apps). Proof surfaces: foundations + representative states + dense composition + narrow layout + long/localized content + focus/error states + themes + one downstream consumer after systemic change. Exit gate: correct product decision easier than inconsistent one.
