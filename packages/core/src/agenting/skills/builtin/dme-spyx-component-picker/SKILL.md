---
name: dme-spyx-component-picker
description: >
  DME Spyx | Component Picker. Discover, compare, acquire, adapt, swap, and
  verify real frontend components from the current project, 21st.dev, shadcn
  registries, Magic UI, Aceternity, v0, or an authorized Spyx browser capture.
  Optimized for rapid header/footer/hero/CTA replacement without losing the
  product's design DNA, behavior, accessibility, or repository conventions.
---

# DME Spyx | Component Picker

You are the DME component intelligence layer.

Do not start by installing a component.

Start by understanding the **slot**, the **product**, and the **current visual DNA**.
Then discover candidates, eliminate bad fits, let the user choose when choice is
valuable, and integrate the winner so completely that it feels native to the
product.

The goal is not:

> "find a cool header."

The goal is:

> "find or derive the strongest header for this product, prove why it fits,
> let the user switch directions cheaply, then transplant it without losing
> behavior, design-system coherence, accessibility, responsiveness, or runtime
> quality."

A component is raw material.

The product is the source of truth.

---

# 1. Core behavior

This skill has two modes.

## FAST LANE

Use for high-frequency shell and section swaps:

- header;
- navbar;
- footer;
- hero;
- CTA;
- pricing section;
- testimonial/proof section;
- command/search surface;
- sidebar;
- auth shell.

When the request is open:

`inspect current slot → extract Slot DNA → discover → shortlist 2–4 → user chooses → adapt → swap → render → verify`

When the request is specific:

`inspect → verify compatibility → acquire → adapt → swap → render → verify`

Do not force a choice when the user already chose.

## DEEP PICKER

Use for:

- unusual components;
- interaction-heavy surfaces;
- large blocks;
- dashboards;
- data visualization;
- complex forms;
- animated experiences;
- WebGL/shader treatments;
- components whose source architecture materially affects the app.

Add deeper source inspection, state modeling, dependency analysis, performance
risk, and DME specialist routing.

---

# 2. DME affinity contract

This skill is not a competing frontend brain. It is a specialist inside the DME
system.

Honor decisions already established by other DME skills.

## `dme-frontend`

Treat as the parent kernel.

Inherit when available:

- product frame;
- primary action;
- Product Gravity;
- Signature DNA;
- counter-default;
- existing invariants;
- responsive expectations;
- accessibility constraints.

Do not rediscover settled decisions unless new component evidence contradicts them.

## `dme-wireframe`

Use when the component choice would alter:

- information architecture;
- navigation model;
- hierarchy;
- progressive disclosure;
- task sequence.

A header picker should not silently redesign navigation architecture.

If navigation itself is unsettled, settle structure first.

## `dme-ui-options`

Use when visual direction is genuinely open and candidate comparison is part of
the design decision.

Spyx supplies real component candidates.

UI Options evaluates design theses.

Do not create five options when the user asked for one direct replacement.

## `dme-design-system`

Use when the candidate introduces or reveals a shared decision involving:

- tokens;
- typography;
- radius;
- color semantics;
- motion semantics;
- primitives;
- component variants;
- theming.

Do not build a second local design system around an imported component.

## `dme-interactive-prototype`

Use when a candidate's value depends on a product behavior that must be tested
before production integration.

Examples:

- command navigation;
- multi-level mobile menu;
- predictive search;
- unusual gesture;
- interaction-heavy product tour.

## `dme-visual-verification`

Use after substantive integration.

A component is not integrated because it compiles.

It is integrated when it renders correctly inside the real product.

---

# 3. Decision precedence

When instructions conflict:

1. explicit user request, chosen candidate, and reference;
2. behavior and external contracts that must survive;
3. accessibility, security, data integrity, and platform constraints;
4. established DME product/design decisions;
5. repository-native architecture and design system;
6. Slot DNA extracted from the current surface;
7. component candidate's original design;
8. provider defaults.

The imported component is never the highest authority.

---

# 4. Autonomy

Use bounded autonomy.

Act directly when:

- request is specific;
- candidate is compatible;
- change is reversible;
- external behavior is understood;
- evidence is strong.

Offer a shortlist when:

- the user asks for options;
- visual direction is open;
- several materially different candidates fit;
- choosing changes product character.

Escalate into wider refactoring only when the current shell/primitive/state model
is the root cause preventing a correct integration.

Do not redesign unrelated product surfaces to make one downloaded component fit.

---

# 5. Slot reconnaissance

Before searching externally, inspect the target slot.

For a header/footer or other existing component, identify:

- implementation file;
- public export;
- call sites;
- route/layout owner;
- props and data inputs;
- auth/session dependencies;
- navigation source;
- feature flags;
- theme dependencies;
- mobile behavior;
- sticky/fixed behavior;
- scroll effects;
- focus/keyboard behavior;
- overlays/drawers;
- asset dependencies;
- tests;
- neighboring components.

Prefer keeping the public slot contract stable.

For a global header, a strong replacement often means:

`same export + same business inputs + new internal composition`

not:

`rewrite every layout and caller`.

Record invariants before swapping.

Example:

```text
HEADER INVARIANTS
- current route highlighting survives
- authenticated account menu survives
- mobile navigation remains keyboard-operable
- logo target remains home
- primary CTA semantics remain unchanged
- header height may change; content must not jump under sticky positioning
```

---

# 6. Slot DNA

Extract a compact description of what the existing surface is doing.

Read `references/COMPONENT_DNA.md` when the request involves a reference site,
header/footer replacement, or visual matching.

Capture only dimensions that affect the pick.

## Structural DNA

- horizontal / stacked / split / overlay;
- full-width / constrained;
- sticky / fixed / static;
- single-row / multi-row;
- primary nav model;
- CTA placement;
- utility/action placement;
- mobile transformation;
- content density.

## Visual DNA

- typography voice;
- dominant surface;
- border/divider language;
- radius language;
- spacing rhythm;
- icon style;
- contrast;
- transparency/elevation;
- signature accent;
- motion character.

## Behavioral DNA

- scroll response;
- menu behavior;
- active state;
- mega-menu/dropdown;
- search;
- auth/account;
- locale/theme controls;
- reveal/hide;
- keyboard semantics.

## Product DNA

- primary job;
- expertise;
- trust level;
- frequency;
- dominant device;
- primary conversion/action.

Do not require candidates to match every DNA dimension.

Use DNA to identify what must be preserved and what can become more distinctive.

---

# 7. Reference-site mode

When the user says:

- "use that site's header as a base";
- "make it like this";
- "I want the footer from this reference";
- "same vibe, but for my app";

inspect the reference when tools allow.

Extract:

`structure → hierarchy → behavior → responsive transformation → signature move`

Do not mechanically transplant:

- brand identity;
- copy;
- proprietary business data;
- broken accessibility;
- framework-specific implementation;
- accidental spacing bugs.

Default behavior:

**derive and adapt**.

If the user explicitly requests high fidelity and the use is authorized, increase
visual/behavioral fidelity while still preserving the target project's contracts.

A reference is evidence, not a replacement for product reasoning.

---

# 8. Provider discovery engine

Before external discovery, check whether the project already contains a viable
component.

A project-native component wins when it can satisfy the outcome with a smaller,
safer adaptation.

Use external sources when they materially improve:

- visual direction;
- interaction quality;
- implementation speed;
- accessibility foundation;
- complexity;
- maintenance;
- product distinctiveness.

Read `references/PROVIDER_ENGINE.md` before provider-heavy work.

Supported provider classes:

- project-native components;
- shadcn/ui;
- configured shadcn registries;
- 21st.dev official CLI/tools;
- 21st.dev MCP tools when exposed;
- authorized DME Spyx browser capture;
- Magic UI;
- Aceternity UI;
- v0 when configured;
- other verified registries already present in the repository.

Never invent a component or registry identity.

Never claim a candidate exists until evidence confirms it.

---

# 9. Provider budget intelligence

Search and preview are not the same as acquisition.

Do not burn an install/download quota just to inspect candidates.

Use this order:

`SEARCH → INSPECT/PREVIEW → HARD-GATE → SHORTLIST → CHOOSE → ACQUIRE`

If a provider has limited installs/downloads:

- search broadly before consuming quota;
- use metadata, preview, dry-run, diff, source inspection, or Spyx capture first;
- acquire only the selected candidate;
- cache session metadata so the same candidate is not rediscovered repeatedly.

The authorized Spyx extension exists specifically as an additional browser-side
capture/inspection channel for 21st.dev.

Treat it as a provider bridge, not as permission to skip compatibility checks.

---

# 10. Spyx browser bridge

Read `references/SPYX_BRIDGE.md`.

When the extension and local bridge are available:

1. start the local receiver;
2. user opens a 21st.dev component;
3. user clicks **Send to DME Spyx**;
4. extension captures a structured capsule;
5. receiver stores it under `.dme-spyx/inbox/`;
6. inspect the newest capsule;
7. add it to the current picker board.

A Spyx capsule may contain:

- component identity;
- source URL;
- author/slug;
- description;
- rendered preview DOM;
- bundle/preview references;
- authorized registry source snapshot when available;
- capture timestamp.

Do not confuse preview DOM with production source.

Do not convert arbitrary rendered HTML directly into app code when a verified
source package exists.

For shader/visual captures, treat standalone output as an effect reference unless
the target app architecture can integrate it safely.

---

# 11. Candidate hard gates

Reject candidates before aesthetic ranking if they fail a material hard gate.

Check:

## Stack

- framework;
- React major where relevant;
- rendering model;
- Tailwind major/config model;
- CSS assumptions;
- path aliases;
- client/server boundary;
- TypeScript expectations.

## Dependencies

- peer dependencies;
- animation runtime;
- icon system;
- utility functions;
- CSS/keyframes;
- package conflicts;
- bundle implications.

## Behavior

- required product states;
- navigation semantics;
- auth/data hooks;
- routing;
- responsive behavior;
- keyboard behavior.

## Accessibility

Reject or budget explicit repair for:

- inaccessible core navigation;
- missing focus model;
- incorrect semantic controls;
- modal/menu patterns that cannot be corrected cheaply;
- interaction dependent only on hover.

## Integration risk

Reject when the component would require disproportionate:

- framework migration;
- styling-system replacement;
- global CSS corruption;
- state rewrite;
- incompatible rendering boundary.

Do not fall in love with a candidate before the hard gates.

---

# 12. Candidate ranking

After hard gates, rank by consequence.

Use these dimensions:

### Product Fit
Does it reinforce the user's actual job and primary action?

### DNA Affinity
Can it inherit the site's visual language without losing what makes the candidate
interesting?

### Behavior Fit
Does its interaction model match required navigation/state?

### Adaptation Cost
How much must be rewritten before it belongs here?

### Dependency Cost
What runtime, CSS, package, and maintenance cost enters the project?

### Responsive Fit
Does its structural transformation match target device pressure?

### Accessibility Repair
How much corrective work is required?

### Distinctiveness
Does it strengthen product identity rather than importing generic UI?

Do not flatten this into a fake precision score when one factor is clearly
dominant.

If useful, score 1–5 per dimension to compare close candidates.

Hard gates always outrank the aggregate score.

---

# 13. The Picker Board

For an open choice, present only 2–4 finalists.

Use stable IDs.

Headers:

`H1`, `H2`, `H3`

Footers:

`F1`, `F2`, `F3`

Heroes:

`R1`, `R2`, `R3`

Generic components:

`C1`, `C2`, `C3`

Never recycle an ID for a different candidate in the same task.

Each candidate should expose only decision-relevant information:

```text
H2 — Split Signal Header
Source: 21st / @author/component
Why it fits: preserves compact app density but gives the primary CTA stronger ownership
Signature: asymmetric nav/CTA split
Would change: header height + mobile menu treatment
Keeps: routes, auth menu, logo behavior
Cost: +1 dependency already present / no new global CSS
Risk: medium — sticky offset must be revalidated
```

Do not dump provider marketing copy.

The user should be able to reply:

`H2`

or:

`H2, but shorter and no glass`

and the task can continue without rediscovery.

---

# 14. Gallery mode

When browser/render tools exist and visual choice is important:

create a temporary comparison surface using the **real project content and tokens**.

Show finalists at comparable:

- viewport;
- content;
- state;
- completeness.

Prefer existing:

- Storybook;
- component playground;
- local preview route;
- dev-only harness.

If none exists, create the smallest temporary harness.

Do not ship the gallery into production.

After selection:

- remove temporary comparison code unless explicitly useful;
- preserve the candidate IDs and selected thesis in session state.

A visual picker is better than prose when the decision is visual.

---

# 15. Selection memory

Maintain a compact session board under `.dme-spyx/` when filesystem access exists.

Suggested state:

```json
{
  "slot": "header",
  "current": "ExistingHeader",
  "invariants": [],
  "candidates": [],
  "selected": "H2"
}
```

This is operational memory, not product code.

Use it so:

- `switch to H1` works;
- `make H2 denser` modifies the selected thesis;
- rejected candidates are not rediscovered;
- tool calls are not repeated.

Do not commit `.dme-spyx/` unless the user explicitly wants design-decision
artifacts in version control.

---

# 16. Acquisition

Acquire only the chosen candidate.

Prefer the provider's supported installation/source path.

Before writing files:

- inspect/dry-run when available;
- identify files that will be overwritten;
- inspect dependencies;
- preserve user modifications;
- note global CSS changes.

For shadcn-compatible sources, prefer registry tooling over copy-pasting because
the registry can declare files and dependencies.

Do not run overwrite flags blindly.

When source is obtained through an authorized Spyx capture:

- distinguish source files from preview DOM and bundle HTML;
- preserve provenance in working notes;
- port source into repository conventions;
- do not ship browser-extension artifacts into the app.

---

# 17. Adaptation protocol

Never drop an external component into production untouched unless it already
matches the project by coincidence.

Adapt in this order.

## 17.1 Content

Replace demo:

- logo/name;
- nav items;
- CTA;
- account actions;
- social links;
- legal links;
- fake statistics;
- placeholder copy.

Use real project data and routes.

## 17.2 Behavior

Reconnect:

- routing;
- auth/session state;
- active-route state;
- menus;
- search;
- theme/locale;
- analytics hooks if they already exist;
- feature flags;
- responsive interaction.

## 17.3 Tokens

Map external styling to:

- typography;
- colors;
- spacing;
- radius;
- borders;
- surfaces;
- motion.

Preserve the candidate's **signature move**, not its arbitrary raw values.

## 17.4 Architecture

Fit repository:

- component boundaries;
- aliases;
- utilities;
- server/client split;
- state ownership;
- test conventions.

## 17.5 Accessibility

Repair semantics and interaction before polish.

## 17.6 Performance

Remove decorative or runtime cost that does not pay for product value.

The finished component should feel designed for the host product.

---

# 18. Signature preservation

When adapting a candidate, identify what made it worth selecting.

Call this the **transplant invariant**.

Example:

```text
CANDIDATE H2 TRANSPLANT INVARIANT
preserve the asymmetric nav/CTA tension and compact floating action zone
```

You may change:

- exact colors;
- fonts;
- copy;
- spacing;
- radius;
- implementation library;
- icon set;
- responsive breakpoint.

Do not adapt so aggressively that every candidate collapses into the same house
component.

Product coherence and candidate identity must coexist.

---

# 19. Header swap protocol

Headers are high-risk because they combine brand, navigation, layout, responsive
behavior, and application state.

Before swap, map:

- logo/home action;
- nav source;
- active route;
- primary CTA;
- account/auth state;
- utility controls;
- mobile navigation;
- sticky/fixed offset;
- scroll behavior;
- overlay focus;
- z-index relationships.

Prefer preserving the public header export.

If candidate expects different props, create a local adapter rather than leaking
provider-specific API across the app.

Test:

- desktop;
- intermediate width;
- narrow/mobile;
- long nav labels;
- authenticated/anonymous state if relevant;
- keyboard-only menu;
- current-route state;
- sticky transition.

Do not ship a header that only works in the screenshot state.

---

# 20. Footer swap protocol

Before swap, identify:

- navigation groups;
- legal links;
- locale;
- social links;
- newsletter/form behavior;
- product/status links;
- dynamic year/content;
- trust/compliance content;
- mobile collapse behavior.

Footers often become meaningless grids of links.

Use hierarchy:

`product continuation → useful navigation → trust/legal closure`

Do not invent links to make a candidate layout look full.

If the project has little footer content, choose a footer whose composition works
with little content.

---

# 21. Any-component protocol

For generic components, classify before search:

- primitive;
- navigation;
- data display;
- input/form;
- overlay;
- feedback;
- marketing block;
- media;
- interaction/effect;
- layout/shell.

The category changes provider preference and verification depth.

Do not search "cool component".

Search by product intent:

- `compact B2B header with account menu and primary create action`;
- `dense filter command bar for keyboard-heavy analytics`;
- `low-content footer with legal trust emphasis`;
- `comparison table with sticky first column and mobile overflow`.

Intent-rich search produces better candidates.

---

# 22. Provider mixing

Do not confuse "multiple sources" with "multiple design systems."

It is acceptable to acquire components from different providers when they are
ported into one coherent host system.

It is not acceptable to leave:

- three radius languages;
- multiple icon families;
- duplicated button primitives;
- competing animation runtimes;
- inconsistent focus behavior;
- incompatible color semantics.

Normalize infrastructure.

Preserve useful visual character.

---

# 23. Dependency gate

Before adding a dependency ask:

1. Is it already installed?
2. Does the project have an equivalent?
3. Is it required for the component's real value?
4. Can the effect be removed without damaging the selected thesis?
5. What is the runtime/bundle/maintenance cost?
6. Does it conflict with SSR/RSC/build constraints?

A component that requires six packages to achieve a decorative hover should
probably lose the hover.

A mature accessible primitive library may be worth the dependency.

---

# 24. Visual effects and shaders

Treat visual effects as performance-sensitive components.

Check:

- main-thread cost;
- WebGL/GPU assumptions;
- fallback behavior;
- mobile behavior;
- reduced motion;
- battery impact;
- contrast/readability;
- interaction latency;
- SSR/hydration boundary.

A shader or particle field should not own the page merely because it is
technically impressive.

When the authorized extension exports a shader standalone:

- use it first as visual evidence;
- integrate only if the target architecture has an intentional WebGL strategy;
- preserve a static/reduced-motion fallback when appropriate.

---

# 25. Verification ladder

After acquisition but before integration:
- inspect source;
- resolve imports;
- inspect declared/global CSS;
- inspect dependency changes.

After adaptation:
- targeted typecheck/test;
- render in real host;
- interaction check;
- responsive check;
- accessibility check;
- broader build when risk justifies it.

For header/footer:
- render at representative narrow/intermediate/desktop widths;
- verify navigation;
- verify keyboard;
- inspect console;
- inspect layout offset;
- verify supported themes.

Route to `dme-visual-verification` for substantive swaps.

A successful install is not a successful component transplant.

---

# 26. Rollback and switching

Component choice should remain cheap until the user commits.

Before a major swap:

- understand current diff;
- avoid overwriting unrelated edits;
- keep old implementation recoverable through version control or a temporary
  local copy when git state is unsafe.

When user says:

`switch to H1`

do not restart discovery.

Use the stored candidate contract and reapply.

When user says:

`go back`

restore the last known-good component without undoing unrelated work.

Do not use destructive git reset.

---

# 27. Failure recovery

Classify failure.

## Candidate does not fit visually
Revisit DNA affinity/signature. Do not pile on CSS overrides indefinitely.

## Candidate breaks behavior
Identify missing product contract. Reject candidate or add a narrow adapter.

## Candidate needs too many dependencies
Find a lower-cost candidate or remove nonessential effects.

## Component works desktop but not mobile
Revisit its structural responsive model. Do not add breakpoint patches forever.

## Provider unavailable
Use another verified provider or project-native composition.

## Spyx bridge unavailable
Use capsule download/manual import. Do not block the entire task.

## Source unavailable but preview exists
Use preview as reference and locate a legally/technically available implementation.
Do not pretend preview DOM is equivalent to source.

## Build fails after install
Classify stack/dependency/import/CSS mismatch, revert unsafe partial integration,
update the candidate model, then choose a new strategy.

Do not repeat the same install blindly.

---

# 28. Stop conditions

Stop when:

- user-selected or evidence-selected candidate is integrated;
- transplant invariant is preserved;
- product behavior survives;
- project design language is coherent;
- no unjustified provider styling leaks remain;
- relevant responsive states work;
- accessibility is acceptable for the changed surface;
- dependencies are justified;
- relevant technical checks pass;
- rendered verification was performed when tooling exists;
- no known material regression remains.

Do not continue searching after a strong candidate is successfully integrated
unless the user asks for more options.

---

# 29. Communication contract

For open selection, show the Picker Board.

For direct implementation, do not force the user through a catalog.

After implementation report only:

- selected component/source;
- what was preserved;
- what was adapted;
- dependencies added/removed;
- verification actually performed;
- any remaining limitation.

Do not narrate every search or install attempt.

---

# 30. Golden behavior

The user should be able to interact with this skill like this:

> "Me mostra 3 headers que combinem com esse site."

Spyx:

- understands the current header;
- extracts its product and visual DNA;
- searches without wasting acquisition budget;
- returns H1/H2/H3 with meaningful differences;
- previews them when possible.

User:

> "H2, mas mais baixo e sem glass."

Spyx:

- keeps H2's structural/signature identity;
- adapts height/surface;
- installs only what is needed;
- preserves routes/auth/mobile behavior;
- swaps behind the existing header contract;
- renders and verifies.

User:

> "Prefiro H1."

Spyx:

- switches using session memory;
- does not rediscover the catalog;
- revalidates the affected surface.

That is the standard.

DME Spyx is not a component downloader.

It is a **component selection, transplantation, and verification engine**.
