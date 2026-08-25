---
name: dme-visual-verification-spynx-edition
description: Adversarially verify a real rendered frontend across representative viewports, states, interactions, accessibility conditions, and runtime signals; classify defects by owner, fix root causes, and rerender until material issues stop appearing.
---

# DME Visual Verification | Spynx Edition — Rendered Evidence vNext

Source inspection, tests, and build success are evidence.

They are not substitutes for seeing the interface.

When available, load `../../shared/CORE_CONTRACT.md` once.

Do not call an interface polished, production-ready, visually correct, accessible, pixel-accurate, or regression-free if the evidence does not support that exact claim.

---

## 1. Entry gate

Use:
- after substantive UI implementation;
- for visual/frontend audits;
- after external component transplant;
- after systemic design-system changes;
- when a reference must be compared to implementation;
- when responsive/state defects are suspected.

Do not audit the whole product when the change is local unless evidence shows systemic impact.

---

## 2. Establish verification target

Identify:
- changed surface;
- expected product behavior;
- primary action;
- selected Design DNA/reference;
- affected states;
- supported themes;
- relevant viewports;
- critical invariants;
- known risks;
- downstream consumers if systemic tokens/primitives changed.

This defines the evidence matrix.

---

## 3. Run the real product

Prefer the repository's documented runtime/preview.

Do not create a fake standalone rendering that bypasses:
- app shell;
- theme;
- fonts;
- routing;
- data providers;
- global styles;
- responsive containers;
- actual component dependencies.

If the real environment cannot run:
- use the strongest available preview;
- state the limitation;
- lower visual confidence.

---

## 4. Evidence matrix

Use representative combinations, not Cartesian explosion.

### Viewports
Choose:
- narrowest supported/stress width;
- one intermediate width where composition might fail;
- representative desktop/wide.

Add another only when a component transforms there.

### States
Choose reachable high-value states:
- populated/primary;
- loading;
- empty;
- long content;
- partial;
- validation/system error;
- success;
- disabled/selected;
- open overlay;
- destructive confirmation;
- changed themes.

### Interaction conditions
Where relevant:
- keyboard only;
- pointer;
- touch emulation;
- reduced motion;
- zoom;
- localization/long labels;
- reduced transparency or opaque fallback for glass-heavy surfaces.

Choose cases that maximize expected defect discovery.

---

## 5. Inspect in perceptual order

Do not begin with 1px tuning while hierarchy is wrong.

### Pass A — Product clarity
Ask:
- Is the primary action obvious?
- Is current state obvious?
- Is the scan/reading path clear?
- Are comparison/grouping relationships visible?
- Does anything compete unnecessarily?
- Does the surface communicate the intended product thesis?

### Pass B — Macro composition
Check:
- balance;
- visual anchors;
- alignment;
- dead space;
- density;
- section rhythm;
- container behavior;
- width constraints;
- repeated rectangle monotony.

### Pass C — Typography/content
Check:
- hierarchy;
- line length;
- wrapping/truncation;
- awkward single-word lines where material;
- label/data contrast;
- numerical alignment;
- fallback/font-loading shifts;
- realistic content length.

### Pass D — Responsive mechanics
Check:
- reordering;
- collapse;
- overflow ownership;
- drawer/sheet behavior;
- sticky offsets;
- table adaptation;
- safe areas;
- keyboard overlap;
- horizontal overflow;
- focus order after reflow.

### Pass E — Interaction states
Check:
- hover where applicable;
- focus-visible;
- pressed/selected;
- disabled;
- loading;
- validation/error;
- success;
- overlays;
- retry/cancel;
- back behavior.

### Pass F — Accessibility signals
Check:
- semantic controls/labels;
- focus visibility;
- focus not hidden by sticky overlays;
- keyboard reach;
- target usability;
- contrast;
- non-color state communication;
- reduced motion;
- zoom/reflow;
- screen-reader announcements where relevant.

### Pass G — Runtime health
Check:
- console errors;
- hydration warnings;
- broken assets;
- layout shift;
- slow interaction;
- jank from filters/animations;
- network failures;
- obvious bundle/runtime regressions if tooling exposes them.

### Pass H — Identity
Check:
- Design DNA coherence;
- component-library/provider leakage;
- generic AI patterns;
- signature move restraint;
- product-specific character.

---

## 6. Perceptual stress tests

### Squint test
Blur mental detail. Major zones, primary action, and hierarchy should remain legible.

### Grayscale test
Hierarchy should survive through luminance, size, weight, placement, spacing, border, and depth.

### Silhouette test
Ignore text/color. Geometry should feel deliberate rather than like repeated identical rectangles.

### Density test
Ask whether ~20% of visible containers could disappear with grouping still understandable.

### Logo-off test
Remove logo/name/accent mentally. Does the interface still feel product-specific?

### Decoration budget
Count strong effects:
- blur;
- glow;
- gradient;
- heavy shadow;
- texture;
- 3D;
- shader/video;
- animated background.

If several compete, identify which one actually earns its cost.

---

## 7. Defect record

Record defects as:

`viewport/state → observable symptom → user impact → likely owner → severity → evidence`

Example:

`768px + filters open → table columns compress below useful comparison width → comparison task degrades → layout/filter container → high → reproduced twice`

Avoid:
- “spacing feels off”;
- “not premium enough”;
- “looks weird.”

Make defects falsifiable.

---

## 8. Severity

### Critical
Blocks task, corrupts behavior/data, creates inaccessible core interaction, or causes major runtime failure.

### High
Strongly harms hierarchy, comprehension, responsive usability, navigation, or key interaction.

### Medium
Noticeable coherence/accessibility/interaction defect with viable task path remaining.

### Low
Optical/polish issue with little user impact.

Fix critical/high before low.

Do not tune shadows while the mobile action is unreachable.

---

## 9. Root-owner classification

Classify the highest correct owner:

- token;
- primitive;
- component;
- composition/layout;
- state model;
- content;
- asset;
- runtime/data behavior.

Examples:

Seven controls share wrong focus → primitive/token.  
One marketing hero needs unique asymmetric spacing → local composition.  
Mobile modal repeatedly overflows → interaction/layout architecture, not six media-query patches.

Fix the owner, not every symptom.

---

## 10. Reference-fidelity mode

When an approved reference exists, compare:
- geometry;
- alignment;
- proportions;
- typography;
- spacing;
- crop;
- color relationships;
- hierarchy;
- interaction;
- responsive transformation.

If exact fidelity is required and pixel-diff tooling exists, use it only for stable comparable states.

Do not copy:
- inaccessible behavior;
- proprietary branding/copy;
- accidental defects;
- reference-specific implementation that violates host architecture.

Visual similarity never overrides product semantics.

---

## 11. Iteration loop

Use:

`OBSERVE → CLASSIFY → FIX ROOT → RENDER SAME CASE → CHECK ADJACENT CASES`

After systemic changes, inspect representative downstream consumers.

Avoid making five unrelated tweaks between renders when causality matters.

A first render is a draft.

A final render with no material findings is evidence.

---

## 12. Accessibility/runtime escalation

If review reveals a repeated deeper pattern:

- repeated focus failure → inspect primitive/interaction model;
- contrast failures across components → semantic color system;
- layout shift → media/font dimensions/render path;
- slow overlay → render/effect/state cost;
- mobile collapse → structural responsive model;
- inconsistent loading/error → component/state contract;
- glass unreadability → material/token fallback strategy.

Escalate to the correct specialist/owner rather than patching indefinitely.

---

## 13. Technical verification after visual edits

After the last meaningful edit, run appropriate:
- affected tests;
- typecheck;
- lint;
- component/integration checks;
- build;
- smoke/e2e where justified.

A visual-only edit can still break runtime behavior.

For performance-related changes, measure or use explicit proxies.

---

## 14. Confidence statement

At handoff distinguish:

- **verified** — directly rendered/operated/tested;
- **inferred** — supported by code/evidence but not directly observed;
- **unverified** — not available or not checked.

Examples:

`verified: desktop + 390px mobile, keyboard nav, build`  
`inferred: 1280–1600 width should remain stable from fluid grid`  
`unverified: iOS Safari safe-area behavior; no device/browser capability`

Never convert absence of evidence into confidence.

---

## 15. Stop condition

Stop when:
- critical/high defects are resolved;
- changed states render coherently;
- representative widths work;
- primary interaction is operable;
- relevant accessibility checks pass;
- runtime is clean enough for the changed surface;
- technical validation is appropriate to risk;
- a new visual pass reveals no material correction.

Do not chase invisible polish after the expected value becomes low.

---

## 16. Handoff

Report:
- surfaces/states/viewports actually verified;
- material defects fixed;
- technical checks passed/failed;
- remaining medium/low issues if material;
- inferred/unverified areas.

Do not say “pixel-perfect” unless exact comparison evidence exists.

---

## Standalone core capsule

If shared core is unavailable: verify the real surface; choose representative states/viewports; inspect hierarchy before polish; record observable defects; classify owner/severity; fix root; rerender same case; run relevant technical checks; distinguish verified/inferred/unverified; stop when another pass reveals no material issue.
