---
name: dme-design-system-spynx-edition
description: Extract, create, repair, extend, or migrate a frontend design system from product evidence, producing semantic foundations, coherent component contracts, accessibility behavior, governance, and rendered proof without token theater.
---

# DME Design System | Spynx Edition — Decision Compression System vNext

A design system is a **decision compression system**.

Repeated product decisions become named, reusable rules so new surfaces feel coherent without rediscovering design every time.

When available, load:
- `../../shared/CORE_CONTRACT.md`;
- `../../shared/DESIGN_LANGUAGE_ATLAS.md` when visual grammar itself is open.

Do not load this skill for a one-off CSS fix with no reusable decision.

---

## 1. Modes

Classify the task:

### Extract
The product is coherent but undocumented.

### Repair
The product has contradictory tokens/primitives/variants or systemic drift.

### Extend
A new product need requires a reusable addition.

### Migrate
The current system must move to a new token/component/theme architecture without breaking consumers.

### Create
No usable system exists and representative product surfaces need a coherent foundation.

Do not treat all modes as “generate a token file.”

---

## 2. Establish authority

Locate the real sources of truth:

- CSS variables/theme files;
- Tailwind or utility config;
- component primitives and variant APIs;
- font files/loading;
- icon packages/assets;
- brand assets;
- global/layout CSS;
- rendered production surfaces;
- tests/stories/demos;
- accessibility conventions;
- design exports/specs where available;
- downstream consumers.

Evidence precedence:

`structured source → component behavior → recurring rendered pattern → isolated reference → assumption`

Classify findings:
- **observed**;
- **inferred**;
- **missing**;
- **contradictory**.

Frequency alone does not prove intent.

---

## 3. Reconstruct the grammar

Identify repeated decisions around:

- type roles;
- spacing intervals;
- density modes;
- control heights;
- content widths;
- layout grids;
- color semantics;
- surface hierarchy;
- border/radius logic;
- elevation;
- icon sizing/weight;
- motion;
- focus/error states;
- responsive transformation.

For each repeated pattern decide whether it is:
- intentional grammar;
- historical accident;
- one-off exception;
- duplication;
- contradiction.

Do not encode accidental inconsistency as a “system.”

---

## 4. Layer model

Prefer:

`primitive values → semantic tokens → component contracts → compositions`

### Primitive values
Raw measurable values: colors, lengths, type metrics, duration, easing.

### Semantic tokens
Stable meaning:
- `surface-canvas`;
- `surface-raised`;
- `text-primary`;
- `text-muted`;
- `border-subtle`;
- `action-primary`;
- `status-danger`;
- `space-control-inline`;
- `radius-control`.

Names should survive visual redesign better than `blue-500` or `radius-12`.

### Component contracts
Visual + behavioral APIs composed from semantic decisions.

### Compositions
Representative screens proving the system works in reality.

Do not expose implementation details as public product semantics without reason.

---

## 5. Token admission gate

A token earns existence when it represents a reusable decision.

Before adding one ask:
- Does this decision recur?
- Does it have semantic meaning?
- Will consumers need to coordinate around it?
- Would changing it centrally be useful?
- Is an existing token already the correct concept?

Reject token theater:
- one token per arbitrary pixel;
- hundreds of aliases no component consumes;
- names that merely restate values;
- semantic aliases created only to hide one-off exceptions.

---

## 6. Typography system

Define roles from product use, not a size inventory.

For each role:
- family;
- weight;
- size/responsive behavior;
- line height;
- tracking;
- casing if genuinely systemic;
- intended contexts;
- content limits;
- numeric behavior.

Inspect separately:
- body reading;
- dense controls;
- tabular/numeric data;
- code/technical labels;
- display/brand moments.

Font decisions must account for:
- existing license/source;
- language coverage;
- loading cost;
- variable axes;
- numeral quality;
- fallback shifts.

Do not introduce a second family when weight/width/optical size can solve the need.

Do not make every small label uppercase because one screen did.

---

## 7. Color and theme system

Separate:

`primitive palette → semantic role → component state`

Typical semantic roles:
- canvas/background;
- surface;
- raised/overlay;
- foreground;
- muted/subtle foreground;
- border/strong border;
- action;
- focus;
- selected;
- success/warning/danger/info.

Use perceptual color models such as OKLCH when project constraints support maintainable use.

Do not adopt them merely because they are modern.

Themes are authored semantic states, not inversion filters.

For every theme verify:
- text readability;
- non-text/control contrast;
- focus;
- disabled;
- selected;
- status colors;
- overlays;
- media/illustration interactions.

Do not add dark mode just because a system “should” have one.

---

## 8. Spacing and density

Model both rhythm and density.

Potential concepts:
- control-internal spacing;
- inline gap;
- stack gap;
- component padding;
- group separation;
- section separation;
- page gutter.

Mature products may need density modes if both dense expert UI and spacious content exist.

Add density variants only when product contexts justify them.

Avoid per-component padding drift.

A 4px-derived rhythm is common, not mandatory.

---

## 9. Shape and surface language

Radius, border, divider, shadow, inset, translucency, and surface tone should express one depth model.

Ask:
- What is actually elevated?
- What is grouped but flat?
- What is selected?
- What is interactive?
- What is transient?
- What is destructive?

Create a radius hierarchy only if multiple roles are real.

Avoid universal `rounded-xl`.

Create elevation semantics by meaning, not shadow size.

Glass/material effects require:
- contrast fallback;
- limited deployment;
- performance budget;
- reduced-transparency-safe rendering.

---

## 10. Iconography and SVG system

Prefer current product icon source.

If adding a library, choose one coherent family and expose it through product semantics only when useful.

Standardize:
- optical size;
- stroke/fill;
- weight;
- baseline;
- bounding box;
- semantic color behavior.

Custom SVG belongs to:
- brand marks;
- diagrams;
- bespoke symbols;
- product-specific illustration;
- visualization.

Require accessible treatment and reuse.

Do not create a wrapper layer that adds no semantic value.

---

## 11. Component inventory from evidence

Build the components the product uses, not the components a generic design system “should” have.

For each component define:
- role;
- anatomy;
- states;
- variants;
- sizes/density;
- content behavior;
- accessibility contract;
- keyboard behavior;
- responsive behavior;
- composition rules;
- forbidden combinations;
- extension points.

A button spec with default + hover is incomplete.

State is first-class.

---

## 12. Component API quality

Prefer product meaning over styling trivia.

Good axes:
- intent;
- emphasis;
- density;
- state;
- size where meaningful.

Avoid:
- raw color props;
- arbitrary padding props;
- prop explosion;
- parallel styling channels;
- wrappers that only rename another library;
- one variant for every historical exception.

When adapting an external primitive:
- preserve proven behavior/accessibility;
- map into product semantics;
- do not leak provider vocabulary unless it is already project vocabulary.

---

## 13. Extraction vs repair

### Extraction
Encode coherent existing grammar faithfully.

### Repair
When evidence conflicts:
1. identify dominant/intentional pattern;
2. map consumers;
3. estimate migration/blast radius;
4. find root owner;
5. normalize where coherence gain exceeds regression cost;
6. provide aliases/deprecation path when public usage is broad.

Do not “clean up” values without understanding consumers.

Do not preserve every inconsistency because it exists.

---

## 14. New-system creation

If no system exists:

`representative composition → extract reusable decisions → test on second composition → stabilize`

Do not start with a 200-token theoretical architecture.

Use the smallest foundation that can produce real screens.

The product should pull the system into existence.

---

## 15. Responsive system

Do not reduce responsiveness to breakpoint constants.

Document component transformation rules:
- collapse;
- reorder;
- wrap;
- overflow ownership;
- density change;
- control change;
- drawer/sheet transition;
- persistent context.

Use container queries when a component's behavior depends on its container and the project supports them.

A breakpoint token without behavioral contract is not a responsive system.

---

## 16. Motion system

Create motion tokens only for recurring meaningful behavior.

Classify:
- immediate state feedback;
- spatial transition;
- entrance/exit;
- progress;
- attention.

For each recurring category define:
- duration range;
- easing character;
- interruption behavior;
- reduced-motion equivalent.

Do not centralize decorative animation just to make it “consistent.”

Frequent actions should remain fast.

---

## 17. Accessibility contract

Accessibility belongs in primitives and component contracts.

Encode where relevant:
- semantics;
- names/labels;
- focus style;
- keyboard operation;
- overlay focus restoration;
- text/non-text contrast;
- target size/spacing expectations;
- error association;
- state announcements;
- reduced motion;
- transparency fallback;
- zoom/reflow.

Standards-aware:
- WCAG 2.2 AA target minimum is not the same thing as an ergonomic 44px touch target;
- document the product target and conformance target separately.

A system that makes every consumer reinvent accessibility behavior is incomplete.

---

## 18. Governance proportional to blast radius

For shared/mature systems define lightweight rules:

- how tokens are admitted;
- how variants are justified;
- when a one-off is acceptable;
- how experimental tokens are marked;
- how deprecations work;
- how migrations are communicated;
- how drift is detected;
- how consumers discover correct usage.

Do not create committee process for a three-component app.

Governance scales with contributors and blast radius.

---

## 19. Drift detection

Look for:
- repeated raw values below token layer;
- near-duplicate semantic colors;
- radius proliferation;
- divergent control heights;
- duplicate primitives;
- focus states that differ without reason;
- semantic tokens used for convenience;
- local overrides fighting shared components;
- variants that encode one screen’s special case;
- inconsistent icon families;
- unbounded z-index values;
- motion timings with no taxonomy.

Fix the correct owner.

Do not change a global token to solve one exceptional composition.

---

## 20. Migration discipline

For systemic changes:

1. inventory consumers;
2. define old → new mapping;
3. preserve public API when practical;
4. add compatibility aliases only where they reduce migration risk;
5. migrate representative/high-risk consumers first;
6. validate rendered downstream surfaces;
7. remove dead compatibility layers when safe.

Do not leave two competing design systems indefinitely.

---

## 21. Proof surfaces

A design system is unverified until consumers prove it.

When applicable render:

1. foundations/specimens;
2. representative component states;
3. one dense composition;
4. one content-rich/spacious composition if product has both;
5. narrow layout;
6. long/localized content;
7. focus/disabled/error states;
8. all affected themes;
9. one downstream consumer after systemic changes.

The same foundations should produce useful variety without losing identity.

---

## 22. Verification

Run relevant:
- static inspection;
- component tests;
- accessibility tests;
- typecheck/lint;
- build;
- visual regression if available;
- representative consumer render.

If changes are systemic, sample downstream consumers.

Do not claim “no visual regression” without rendered evidence.

---

## 23. Exit gate

Finish when:
- source of truth is clear;
- reusable decisions are semantic rather than arbitrary;
- component contracts include behavior/state;
- contradictory legacy patterns are intentionally handled;
- accessibility is encoded at the appropriate layer;
- migration risk is known;
- representative compositions prove coherence;
- consumers have a clear path;
- another token/abstraction would add more vocabulary than capability.

The strongest design system is not the largest.

It is the one that makes the correct product decision easier than the inconsistent one.

---

## Standalone core capsule

If shared core is unavailable: identify source of truth; distinguish extraction/repair/create/migrate; add tokens only for reusable decisions; preserve public contracts; put accessibility in primitives; test representative consumers; avoid parallel systems; verify systemic changes through rendered evidence when possible.
