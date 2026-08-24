---
name: dme-visual-verification-spynx-edition
description: Adversarially audit a rendered frontend across representative viewports, states, interactions, accessibility conditions, and runtime signals; classify defects, fix the correct owner, and rerender until material issues stop appearing.
---

# DME Visual Verification | Spynx Edition — Rendered Evidence or It Did Not Happen

Use this after implementation or when the user asks for a visual/frontend quality audit.

Source inspection, tests, and build success are evidence.

They are not substitutes for seeing the interface.

Do not call an interface polished, production-ready, visually correct, or pixel-accurate if you did not render the relevant surface.

## 1. Establish the verification target

Identify:

- changed surface;
- expected product behavior;
- primary action;
- design direction or reference;
- affected states;
- supported themes;
- relevant viewports;
- critical invariants;
- known risks.

Do not audit the entire product when the change is local unless evidence shows systemic impact.

## 2. Start the real product

Prefer the repository's documented runtime and existing preview flow.

Do not create a fake standalone rendering that bypasses:

- app shell;
- theme;
- fonts;
- routing;
- data providers;
- global styles;
- responsive container;
- actual component dependencies.

If the real environment cannot run, state the limitation.

## 3. Build the evidence matrix

Use representative combinations, not a Cartesian explosion.

Choose states/viewports that maximize defect discovery.

### Viewports
Prefer project breakpoints and stress points:

- narrowest supported;
- intermediate width where layouts often become awkward;
- representative desktop/wide.

Add other widths only when the component has a known transformation there.

### States
Use those reachable by the changed surface:

- initial;
- loading;
- populated;
- empty;
- long content;
- partial data;
- validation error;
- system error;
- success;
- disabled;
- selected;
- open overlay;
- destructive confirmation;
- supported themes.

### Interaction conditions
Where relevant:

- keyboard only;
- pointer;
- touch emulation;
- reduced motion;
- zoom;
- localization/long labels.

## 4. Inspect in perceptual order

Do not begin with 1px details while hierarchy is wrong.

### Pass A — Product clarity

Ask:

- is the primary action obvious;
- is current state obvious;
- is the reading/scan path clear;
- are important relationships visible;
- does anything compete unnecessarily;
- does the screen communicate the intended product thesis.

### Pass B — Composition

Check:

- balance;
- alignment;
- visual anchors;
- spacing rhythm;
- group separation;
- accidental dead space;
- density;
- section transitions;
- container behavior.

### Pass C — Typography

Check:

- hierarchy;
- line length;
- wrapping;
- truncation;
- orphan/widow-like visual awkwardness where meaningful;
- label/data contrast;
- numerical alignment;
- font loading;
- fallback shifts.

### Pass D — Responsive mechanics

Check:

- reordering;
- collapse behavior;
- control transformation;
- overflow ownership;
- sticky elements;
- table behavior;
- touch reach;
- clipping;
- accidental horizontal page scroll.

### Pass E — Interaction states

Check:

- hover;
- focus-visible;
- pressed;
- selected;
- disabled;
- validation;
- loading;
- optimistic/pending;
- overlays;
- feedback after action.

### Pass F — Accessibility signals

Check:

- semantic control choice;
- accessible names;
- focus order;
- visible focus;
- overlay focus behavior;
- contrast;
- non-color state communication;
- reduced motion;
- usable target sizes.

### Pass G — Runtime health

Inspect:

- console errors;
- hydration warnings;
- failed assets;
- missing fonts;
- layout shifts;
- repeated network failures;
- visibly slow interactions;
- expensive decorative effects.

### Pass H — Identity

Run the logo-off test:

- does the product still feel specific;
- is the signature move visible but not overused;
- did framework defaults leak through;
- are generic AI patterns reappearing.

## 5. Defect record

Record defects as:

`viewport/state → symptom → user impact → likely owner → severity`

Example:

`768px + filter open → primary table compressed to unreadable columns → blocks comparison → layout/filter container → high`

Avoid:

`spacing feels off`

Prefer observable descriptions.

## 6. Severity

### Critical
Blocks task, breaks data/behavior, creates inaccessible core interaction, or causes major runtime failure.

### High
Strongly harms hierarchy, comprehension, responsive usability, or key interaction.

### Medium
Noticeable coherence, accessibility, or interaction defect with a viable path remaining.

### Low
Optical/polish issue that does not materially impede use.

Fix critical/high first.

Do not spend time tuning shadows while the mobile action disappears.

## 7. Find the correct owner

Classify the root layer:

- token;
- primitive;
- component;
- layout;
- state model;
- content;
- asset;
- runtime/data behavior.

Fix the highest correct owner.

If seven cards have wrong padding because one token is wrong, change the token.

If one exceptional composition requires different spacing, do not corrupt the global token to avoid a local rule.

## 8. Reference-fidelity mode

When an approved reference exists, compare principles and measurable relationships:

- geometry;
- alignment;
- proportions;
- typography;
- spacing;
- crop;
- color relationships;
- hierarchy;
- interaction state.

Do not copy accidental artifacts or inaccessible behavior from the reference.

If exact pixel-diff tooling exists, use it only when exact fidelity is actually required.

Visual similarity is not permission to break product semantics.

## 9. Iteration loop

Use:

`OBSERVE → CLASSIFY → FIX ROOT → RENDER SAME CASE → CHECK ADJACENT CASES`

After fixing a systemic owner, inspect representative consumers that could regress.

Do not make multiple unrelated visual tweaks between renders when you need to know which change helped.

## 10. Accessibility/runtime escalation

If visual review reveals a deeper problem:

- repeated focus failure → inspect primitive/interaction architecture;
- layout shift → inspect media/font dimensions and rendering path;
- slow modal → inspect render/effect cost;
- mobile collapse → revisit responsive structure;
- repeated contrast failures → revisit semantic colors;
- inconsistent states → revisit component contract.

Escalate to architecture rather than patching symptoms indefinitely.

## 11. Technical verification after visual edits

After the last meaningful edit, run the appropriate repository checks:

- affected tests;
- typecheck;
- lint;
- component/integration checks;
- build;
- smoke/e2e where justified.

Do not assume a visual-only edit cannot break runtime behavior.

## 12. Confidence statement

At handoff, distinguish:

- **verified** — directly observed/tested;
- **inferred** — supported by code but not rendered/tested;
- **unverified** — could not be checked.

If no browser/rendering capability exists, state exactly what was not visually verified.

Never convert absence of evidence into confidence.

## 13. Stop condition

Stop when:

- critical and high defects are resolved;
- changed states render coherently;
- representative widths work;
- primary interaction is operable;
- relevant accessibility checks pass;
- runtime is clean enough for the changed surface;
- technical validation passes at the appropriate level;
- a new visual pass reveals no material correction.

A first render is a draft.

A final render with no material findings is evidence.
