---
name: dme-design-system-spynx-edition
description: Extract, create, repair, or extend a frontend design system from real product evidence, producing semantic tokens, coherent visual grammar, component contracts, state behavior, governance, and rendered proof.
---

# DME Design System | Spynx Edition — Evidence to Visual Grammar

A design system is not a token dump and not a component catalog.

It is a **decision compression system**: repeated product decisions become named, reusable rules so new surfaces feel coherent without rediscovering design every time.

Use this for:

- design-system extraction;
- shared visual foundations;
- component libraries;
- theming;
- systemic visual inconsistency;
- token migration;
- brand-to-product translation;
- multi-surface convergence.

Do not load this for a one-off CSS fix with no reusable decision.

## 1. Establish authority

Before defining anything, locate the real sources of truth:

- token/theme files;
- CSS variables;
- utility config;
- component primitives;
- variant APIs;
- font files and loading rules;
- icon packages/assets;
- brand assets;
- rendered production surfaces;
- content voice;
- accessibility conventions;
- tests/stories/demos;
- design exports when available.

Evidence precedence:

`structured source → component behavior → rendered recurring pattern → isolated screenshot → assumption`

A screenshot can reveal hierarchy and rhythm. It cannot prove token values or component contracts.

Separate findings into:

- **observed**;
- **inferred**;
- **missing**;
- **contradictory**.

Do not silently invent missing brand assets.

## 2. Find the existing grammar

Do not start by generating standard tokens.

Identify repeated decisions already present:

- dominant spacing intervals;
- type roles;
- surface hierarchy;
- border/radius logic;
- elevation;
- control heights;
- content widths;
- layout grids;
- accent behavior;
- semantic colors;
- icon sizes;
- motion timing;
- state treatments.

Distinguish:

- intentional pattern;
- historical accident;
- one-off exception;
- duplication;
- contradiction.

Frequency alone does not prove correctness.

## 3. Model the system in layers

Prefer:

`primitive values → semantic tokens → component contracts → compositions`

### Primitive values
Raw colors, lengths, type metrics, durations.

### Semantic tokens
Meaning:

- `surface-canvas`;
- `surface-raised`;
- `text-primary`;
- `text-muted`;
- `border-subtle`;
- `action-primary`;
- `status-danger`;
- `space-control-inline`;
- `radius-control`.

Names should survive visual redesign better than raw-value names.

### Component contracts
Behavioral/visual APIs built from semantic decisions.

### Compositions
Representative screens proving the primitives work together.

Do not expose raw implementation details as public design semantics without reason.

## 4. Token architecture

Create only dimensions the product needs.

Potential domains:

- color;
- typography;
- spacing;
- sizing;
- radius;
- border;
- depth;
- layout;
- motion;
- z-order;
- breakpoints when the project uses them.

Avoid token theater:

- hundreds of aliases no component consumes;
- one token per arbitrary pixel value;
- semantic names that merely restate hex values;
- tokens created to make every exception look systematic.

A token earns existence when it represents a reusable decision.

## 5. Typography system

Define roles through product use, not size inventory.

For each role capture:

- family;
- weight;
- size;
- line height;
- tracking;
- casing if truly systemic;
- intended contexts;
- responsive behavior;
- content limits where relevant.

Check numeric/data use separately from prose.

Do not make every small label uppercase because one dashboard screen did.

## 6. Color and theme system

Separate:

- base palette;
- semantic application;
- component state.

Verify semantic colors in the contexts where they are consumed.

Themes are authored states, not inversion filters.

When multiple themes exist, preserve semantic intent across them rather than forcing identical raw contrast relationships.

Do not add dark mode solely because a design system seems incomplete without it.

## 7. Spacing and density

Model both rhythm and density.

A mature product may need density modes or component sizes because one spacing scale cannot satisfy both dashboard tables and marketing content.

Only add density variants when product contexts justify them.

Avoid arbitrary per-component padding drift.

## 8. Shape and surface language

Radius, border, divider, shadow, inset, translucency, and surface tone should express one coherent depth model.

Ask:

- what is actually elevated;
- what is merely grouped;
- what is selected;
- what is interactive;
- what is transient;
- what is destructive.

Do not use elevation as decoration.

## 9. Component inventory from evidence

Do not build the components a generic design system "should" have.

Inventory what the product actually uses and what upcoming work materially requires.

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

State should be first-class.

A button spec containing only default/hover is not a component contract.

## 10. Component API quality

Prefer APIs reflecting product meaning.

Avoid:

- prop explosion;
- raw color props;
- arbitrary padding props;
- parallel styling channels;
- wrappers that merely rename another library.

When adapting an external component library:

- preserve its behavior/accessibility;
- map it into product semantics;
- avoid exposing library implementation as product language when unnecessary.

## 11. Design-system extraction vs repair

### Extraction
When the product is coherent but undocumented, encode existing grammar faithfully.

### Repair
When evidence conflicts, do not preserve inconsistency as tokens.

Identify:

- dominant/intentional pattern;
- affected consumers;
- migration risk;
- compatibility constraints.

Normalize only when the gain in coherence exceeds regression cost.

Use aliases/deprecation paths when public usage makes hard replacement risky.

## 12. New design systems

If no system exists:

Start with the minimum coherent foundation needed by representative product surfaces.

Do not produce a 200-token theoretical architecture before one real screen exists.

Use:

`representative composition → extract reusable decisions → test on another composition → stabilize`

The product should pull the system into existence.

## 13. Accessibility contract

Accessibility belongs in primitives and component contracts.

Include where relevant:

- semantics;
- names/labels;
- focus behavior;
- keyboard operation;
- contrast;
- state communication;
- reduced motion;
- target size;
- error association;
- overlay focus management.

A design system that requires every consumer to reinvent these is incomplete.

## 14. Motion system

Create motion tokens only for meaningful recurring behaviors.

Classify:

- state feedback;
- spatial transition;
- entrance/exit;
- progress;
- attention.

Define reduced-motion behavior.

Do not centralize decorative animation merely to make it consistent.

## 15. Responsive system

Do not reduce responsiveness to breakpoint constants.

Document component transformation rules:

- collapse;
- reorder;
- wrap;
- overflow ownership;
- compact mode;
- changed control;
- persistent context.

A breakpoint token without behavioral contracts is insufficient.

## 16. Governance without bureaucracy

For mature/shared systems, define lightweight rules:

- how new tokens are justified;
- how variants are added;
- when a one-off is acceptable;
- how deprecations work;
- how visual drift is detected;
- how consumers discover correct usage.

Do not create committee process for a small codebase.

Governance scales with number of contributors and blast radius.

## 17. Drift detection

Look for:

- repeated raw values below token layer;
- near-duplicate colors;
- radius proliferation;
- divergent control heights;
- duplicated primitives;
- local overrides that fight shared components;
- inconsistent focus states;
- semantic tokens used for visual convenience;
- variants that encode one screen's special case.

Fix the owner layer, not every consumer individually.

## 18. Proof

A design system is unverified until rendered consumers prove it.

Render when possible:

1. foundations/specimens;
2. representative component states;
3. at least one dense composition;
4. at least one content-rich or spacious composition when the product has both;
5. narrow layout;
6. long/localized content;
7. focus/disabled/error states;
8. every existing theme affected.

Check that the same foundation can produce variety without losing identity.

## 19. Verification

Run relevant:

- static checks;
- component tests;
- accessibility tests;
- typecheck/lint;
- build;
- visual regression if available.

If changes are systemic, sample affected downstream consumers.

Do not claim "no visual regression" without rendered evidence.

## 20. Exit gate

Finish when:

- authority/source-of-truth is clear;
- semantic foundations represent real reusable decisions;
- component contracts include behavior and states;
- contradictory legacy patterns are intentionally handled;
- representative compositions prove coherence;
- accessibility is encoded at the appropriate layer;
- migration risk is known;
- consumers have a clear path to correct usage;
- another token or abstraction would add more vocabulary than capability.

The strongest design system is not the largest.

It is the one that makes the correct product decision easier than the inconsistent one.
