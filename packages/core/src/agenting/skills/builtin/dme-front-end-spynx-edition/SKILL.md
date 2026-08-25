---
name: dme-front-end-spynx-edition
description: Build, redesign, or refine production frontend experiences as repository-native products with deliberate hierarchy, design DNA, responsive behavior, accessible interaction, strong engineering, and rendered proof.
---

# DME Front End | Spynx Edition — Product Experience Kernel vNext

This is the parent implementation skill of the modular DME frontend suite.

When available, load `../../shared/CORE_CONTRACT.md` once. Load `../../shared/DESIGN_LANGUAGE_ATLAS.md` only when visual direction is materially open, a reference must be translated, or a new visual grammar is being established.

Do not decorate rectangles. Do not optimize for a screenshot. Build a product surface whose structure, visuals, interaction, content, and runtime behavior agree.

---

## 1. Role

Use this skill when the user wants to:

- build or redesign a page, screen, application surface, component, landing page, dashboard, email-like web layout, print surface, or slide-like web composition;
- refine an existing frontend where the primary uncertainty is implementation/product quality rather than unresolved information architecture;
- translate an approved design/reference into working frontend;
- improve visual quality without abandoning repository contracts.

Route elsewhere when the dominant uncertainty is:

- structure/navigation/task flow → `dme-wireframe-spynx-edition`;
- visual direction genuinely open → `dme-ui-options-spynx-edition`;
- shared tokens/primitives/systemic grammar → `dme-design-system-spynx-edition`;
- behavior must be tested before production commitment → `dme-interactive-prototype-spynx-edition`;
- external component discovery/transplant → `dme-spyx-component-picker`;
- implementation already exists and needs adversarial rendered QA → `dme-visual-verification-spynx-edition`.

Do not invoke specialists ceremonially.

---

## 2. Product frame before pixels

Resolve or infer:

- **user** — who operates this surface;
- **job** — what they came to accomplish;
- **primary action** — what matters now;
- **secondary actions** — necessary but non-competing;
- **expertise** — novice / occasional / expert / mixed;
- **frequency** — one-time / occasional / repetitive;
- **consequence** — low-stakes / trust-sensitive / destructive / financial / regulated;
- **density** — how much must be scanned or compared;
- **input mode** — keyboard, pointer, touch, mixed;
- **latency sensitivity** — expected feedback speed;
- **content reality** — likely lengths, missing data, localization, user content;
- **success state** — what “done” means and feels like.

Convert this into product pressure.

Examples:

`high-frequency + expert + dense`
→ stable placement, compact rhythm, keyboard continuity, short pointer travel, high information/chrome ratio.

`trust-sensitive + destructive`
→ consequence visibility, explicit state, reversible path where practical, proportional confirmation.

`exploratory + brand-led`
→ stronger composition, imagery/motion budget, but task clarity still wins.

---

## 3. Experience engine

A good interface reinforces confidence through six properties.

### Clarity
The user can tell:
- where they are;
- what matters;
- what changed;
- what happens next.

### Agency
Input gets immediate acknowledgement, state is visible, actions are predictable, and reversibility exists where practical.

### Fluency
Remove repeated decisions, duplicate entry, needless modal hops, excessive travel, and re-reading.

### Immediacy
Feedback arrives at the speed expected by the action. Do not make decorative motion increase perceived latency.

### Character
The interface has a recognizable product-specific voice derived from content, context, brand, and interaction.

### Reward
Important completion may receive a concise satisfying settlement. Reward must reinforce meaning, not delay frequent work.

For important controls reason in three beats:

`affordance → acknowledgement → settlement`

Do not fake completion. Acknowledge pending work honestly, then settle decisively.

---

## 4. Establish Design DNA

For non-trivial visual work, define a compact internal thesis before styling.

Capture:

- dominant design language;
- emotional tone;
- density;
- geometry;
- radius law;
- border law;
- elevation/material law;
- color/chroma budget;
- typography strategy;
- icon strategy;
- motion strategy;
- spacing rhythm;
- imagery strategy;
- one signature move;
- one counter-default.

When the repository already has coherent DNA, inherit it.

When it is weak or contradictory, preserve strong intentional signals and repair the smallest systemic layer that blocks coherence.

Do not choose a trendy style label before understanding product pressure.

---

## 5. Information hierarchy before components

Before styling, identify:

- entry/orientation point;
- scan/reading path;
- primary action;
- persistent context;
- comparison relationships;
- semantic groups;
- transient feedback;
- information that can disclose later;
- information that must remain simultaneously visible.

Everything cannot be emphasized.

Use:
- placement;
- scale;
- typography;
- density;
- luminance;
- color scarcity;
- whitespace;
- borders/depth

as one hierarchy system, not independent decoration knobs.

### Macro tests
Use during design and QA:

**Squint test** — hierarchy and major zones survive blur.  
**Grayscale test** — hierarchy survives hue removal.  
**Silhouette test** — geometry/composition remain intentional without text/color.  
**Density test** — if ~20% of containers can disappear without losing grouping, simplify.  
**Logo-off test** — if removing logo/accent makes the product generic, strengthen product-specific composition, typography, behavior, or rhythm.

---

## 6. Typography architecture

Typography should carry hierarchy before decoration does.

### Source precedence
1. existing licensed/project fonts;
2. system stack if it fits;
3. existing dependency/font package;
4. new external/self-hosted family only when it materially improves the product and licensing/performance are acceptable.

### Selection criteria
Evaluate:
- personality;
- x-height/readability;
- width and density;
- weight/variable axes;
- numeral quality;
- punctuation/symbols;
- language coverage;
- code readability when relevant;
- rendering;
- file payload.

### Roles
Create only roles the product needs:

`display | page-title | section-title | body | compact-body | label | metadata | data | code | annotation`

For each decide:
- family;
- size behavior;
- line height;
- weight;
- tracking;
- measure;
- wrapping/truncation;
- responsive compression;
- numeral features where relevant.

Do not use:
- giant headings to compensate for weak hierarchy;
- 12px application copy by reflex;
- low-contrast gray-on-gray prose;
- many font weights without role;
- random letter spacing;
- display fonts in dense body copy.

Pair families only when contrast buys identity or function. Before adding a second family, try weight, width, optical size, case, and spacing.

---

## 7. Color, surfaces, shape, and depth

### Color
Think in semantic roles:

`canvas → surface → raised/overlay → text primary/muted/subtle → borders → action → focus → status`

Accent color gains meaning through scarcity.

Do not generate isolated shades without a role.

Use perceptual color models such as OKLCH when project/browser/tooling constraints make them maintainable; do not adopt new CSS syntax for novelty.

Themes preserve semantic intent rather than blindly inverting raw colors.

### Shape
Radius is a grammar.

Choose a deliberate hierarchy or near-zero system based on Design DNA. Do not apply `rounded-xl` to every container.

Pills belong where the semantic shape makes sense, not as a default button style.

### Depth
Elevation must indicate grouping, transience, priority, or interaction.

Possible depth channels:
- luminance;
- border;
- shadow;
- inset;
- translucency;
- scale;
- spatial separation.

Do not stack blur + glow + gradient + large shadow to prove effort.

### Material effects
Glass, clay, neumorphism, glow, texture, 3D, and shaders are budgeted effects. Each must pay for hierarchy, identity, affordance, or experience.

When translucency is used:
- preserve readable foreground contrast;
- provide opaque/contrast-safe fallback;
- limit expensive filter area;
- treat reduced-transparency media queries as progressive enhancement, not the only fallback.

---

## 8. Spacing and composition

Use a coherent spacing rhythm.

Spacing communicates ownership:
- inside a control;
- between paired elements;
- inside a component;
- between groups;
- between sections;
- page gutter;
- intentional major void.

A 4px-derived scale is common, not mandatory.

Do not mechanically apply the same vertical gap to every section.

Use optical corrections sparingly and intentionally.

Whitespace is not automatically premium. Density is not automatically clutter.

Choose density from task frequency, expertise, device, and content volume.

---

## 9. Layout intelligence

Prefer robust layout systems:
- CSS Grid;
- Flexbox;
- intrinsic sizing;
- min/max/clamp;
- logical properties;
- subgrid when it solves a real relationship;
- container queries when component behavior depends on available container space.

Avoid structural absolute positioning unless the composition truly requires overlay/spatial behavior.

Reason about:
- content hierarchy;
- scan pattern;
- comparison needs;
- ownership of overflow;
- persistent context;
- container width;
- wide-screen restructuring.

Large displays should not stretch reading content indefinitely.

---

## 10. Responsive design is behavioral adaptation

Never implement mobile as “desktop stacked vertically.”

For each region decide whether it:
- remains;
- compresses;
- wraps;
- reorders;
- collapses;
- becomes a drawer/sheet;
- becomes horizontal overflow within its own boundary;
- changes control type;
- moves closer to active task;
- hides because it is genuinely secondary.

Add breakpoints where composition or interaction fails, not because a popular device width exists.

Validate at minimum for substantive work:
- narrowest supported/stress width;
- intermediate awkward width;
- representative desktop/wide;
- long/localized content;
- relevant zoom;
- touch/pointer differences.

Page-level horizontal overflow is normally a defect. Data regions may own intentional overflow when it preserves comparison better than destructive stacking.

On mobile also inspect:
- safe areas;
- keyboard overlap;
- bottom/sticky actions;
- thumb reach;
- table adaptation;
- modal/sheet sizing;
- touch targets;
- long labels.

---

## 11. Component architecture

Create a component because it buys:
- reusable behavior;
- domain semantics;
- state ownership;
- visual identity;
- testability;
- cognitive simplification.

Avoid both:
- monoliths whose behavior cannot be reasoned about independently;
- microscopic wrappers that only rename markup.

Prefer semantic variants:

`intent="danger" density="compact" state="selected"`

over style-prop explosions when those semantic dimensions actually exist.

Reuse repository primitives before creating a parallel system.

Do not wrap a library component unless the wrapper adds product semantics, policy, or integration value.

---

## 12. State architecture

Use the smallest correct state model.

Distinguish:
- local transient UI;
- form state;
- URL/navigation state;
- server state;
- shared app state;
- persisted state;
- derived state.

Rules:
- keep state near the behavior that owns it;
- do not duplicate safely derivable state;
- make navigable/shareable state URL-driven when appropriate;
- do not copy server state into a global client store without reason;
- model async ordering explicitly when it matters;
- protect against stale closures, duplicate submission, race conditions, stale responses, and state resurrection.

For complex defects or flows reconstruct:

`input → event → state owner → transition → side effect → persistence → render`

before editing.

---

## 13. Interaction state machine

Every reachable state is part of the product.

Consider only relevant states, but do not omit real ones:

- idle/default;
- hover on pointer devices;
- focus-visible;
- active/pressed;
- selected;
- disabled;
- loading;
- background refresh/stale;
- empty;
- partial;
- validation error;
- system error;
- success;
- optimistic pending;
- retry;
- offline/interrupted;
- permission denied;
- destructive confirmation;
- overflow/long content.

State should not be communicated through color alone.

Microinteractions should make cause and consequence easier to understand:
- activation;
- toggle;
- copy;
- save;
- validation;
- selection;
- drag/drop;
- progress.

Do not animate every element.

---

## 14. Forms

Forms are recovery systems, not collections of inputs.

Design:
- visible/persistent labels where appropriate;
- field grouping;
- input purpose;
- correct input type;
- autocomplete;
- instructions before errors occur;
- validation timing;
- error association;
- recovery without losing unrelated state;
- disabled/loading semantics;
- keyboard flow;
- submit/retry behavior;
- destructive confirmation when relevant.

Avoid placeholder-only labels.

Do not validate so aggressively that typing becomes punishment.

---

## 15. Data and asynchronous UX

A data interface is temporal.

Model when relevant:
- first load;
- background refresh;
- stale data;
- sorting/filtering;
- pagination/infinite loading;
- optimistic mutation;
- partial failure;
- retry;
- cancellation;
- empty results;
- permission limits;
- latency;
- racing requests.

Skeletons, spinners, and optimism are choices, not defaults.

Choose the representation that gives the clearest mental model of what is happening.

Never fabricate successful server behavior in production code to make the UI look complete.

---

## 16. Data visualization

Choose chart type from the question.

- comparison → bars/position;
- trend → line/area when justified;
- composition → stacked forms;
- distribution → histogram/box/violin as audience permits;
- relationship → scatter;
- single metric → direct number/context.

Do not use pie/donut by reflex.

Avoid gradients, 3D, or animation that slows interpretation.

Make labels, units, zero baselines, uncertainty, and missing data explicit when material.

A chart is successful when interpretation is fast and accurate, not when it looks impressive.

---

## 17. Icons and SVG

Source precedence:
1. current project icon set;
2. platform-native system for strongly platform-specific products;
3. one coherent library;
4. custom SVG for brand/product-specific needs.

Do not casually mix icon families.

Maintain consistent:
- optical size;
- stroke/fill;
- weight;
- corner language;
- baseline;
- bounding box.

For unfamiliar actions, `icon + label` usually beats icon-only.

Use custom SVG for:
- brand marks;
- diagrams;
- bespoke symbols;
- visualization;
- product-specific illustration.

Require correct `viewBox`, scalable geometry, accessible treatment, and reuse for repeated assets.

Do not redraw a common icon from scratch if a coherent library already supplies it.

---

## 18. Assets, imagery, and content

Before adding imagery, identify its function:
- product explanation;
- evidence;
- identity;
- storytelling;
- atmosphere;
- navigation;
- data.

Do not add decorative stock imagery with no semantic contribution.

Prefer real project assets.

Never invent a real company's logo or factual testimonial/metric.

Maintain:
- consistent art direction;
- crop/aspect logic;
- responsive sources;
- dimensions to reduce layout shift;
- appropriate loading priority;
- alt text where informative.

Content is architecture.

Prefer specific, realistic UI copy over generic AI marketing language.

Avoid:
- “Unlock your potential”;
- “Revolutionize your workflow”;
- “Seamless experience”;
- fake “Welcome back” filler.

Use domain-specific labels that explain what the software actually does.

---

## 19. Motion

Motion communicates:
- causality;
- continuity;
- hierarchy;
- feedback;
- spatial relationship.

Prefer fast, restrained state transitions for frequent actions. Larger spatial transitions may take longer only when distance/meaning justifies it.

Use transform/opacity for common animation where practical.

Respect `prefers-reduced-motion`.

Never use animation to conceal slow work.

If motion is decorative, it receives budget only after interaction responsiveness is protected.

---

## 20. Performance

Do not cargo-cult optimize.

Identify the likely contributor:
- render frequency;
- reconciliation;
- list size;
- layout thrash;
- images;
- fonts;
- network waterfalls;
- JS bundle;
- hydration;
- expensive blur/filter;
- animation;
- canvas/WebGL;
- repeated event work.

Measure when tools exist.

High-value protections often include:
- correct media sizing;
- lazy loading where useful;
- minimal client JS;
- stable layout dimensions;
- avoiding unnecessary client boundaries;
- avoiding huge filtered regions;
- virtualization only for genuinely large data;
- memoization only for observed/reasoned cost.

For 3D/WebGL/shaders:
- justify product value;
- set performance/fallback budget;
- test mobile/GPU constraints when possible;
- protect text readability;
- respect reduced motion;
- preserve useful non-spatial fallback.

---

## 21. Accessibility construction rules

Follow the shared core accessibility baseline.

Additionally:
- heading levels belong to page hierarchy, not reusable components by default;
- native controls beat custom controls when behavior is equivalent;
- overlays require deliberate focus entry, containment where appropriate, escape/close behavior, and focus restoration;
- sticky content must not obscure focused controls;
- hover-only interaction is not sufficient for essential actions;
- touch ergonomics may target larger hit areas than WCAG minimums when product context warrants it.

Do not add ARIA that duplicates or conflicts with native semantics.

Accessibility that needs dozens of local patches usually signals a primitive or interaction architecture problem.

---

## 22. Existing design-system policy

If a design system exists:

1. identify actual source of truth;
2. understand tokens/primitives/variants;
3. reuse it;
4. extend semantically;
5. repair only when evidence shows systemic inconsistency or it blocks the requested outcome;
6. avoid a parallel local visual language.

If repair is systemic, route to `dme-design-system-spynx-edition`.

Do not preserve inconsistency merely because it is old.

Do preserve public contracts or provide migration paths when consumers depend on them.

---

## 23. External component policy

Do not install a component because the preview looks good.

Use `dme-spyx-component-picker` when external discovery is material.

Before importing any external component:
- inspect repository-native alternatives;
- inspect files/dependencies/global changes;
- verify framework/rendering compatibility;
- assess accessibility and behavior;
- preserve product state/routes/content;
- map styling into host tokens;
- preserve the candidate's valuable signature, not provider boilerplate;
- render and verify.

Third-party component code is code, not decoration.

---

## 24. Surface-specific pressure

### Marketing / landing
Identity, narrative, and conversion hierarchy matter.
Avoid repeated feature-card grids and invented proof.
Vary rhythm only when content hierarchy warrants it.

### Product application
Persistent context, state visibility, scan speed, density, and interaction fluency dominate decoration.

### Dashboard / analytics
Start with questions the data must answer.
Do not tile every metric.
Protect comparison, trend, filtering, and empty/error semantics.

### Tables / enterprise
Prioritize alignment, sorting/filtering, selection, bulk actions, keyboard use, sticky context, and overflow ownership.

### Forms / onboarding
Prioritize sequence, dependencies, recovery, completion clarity, and mobile keyboard behavior.

### Media / immersive
Protect content readability, controls, reduced motion, and runtime budget.

### Print / paged output
Use print-aware composition, pagination, repeating headers where needed, and output verification.

### Email-like HTML
Respect target-client constraints; do not assume modern CSS or JavaScript support.

### Slide-like web composition
Treat each viewport as fixed composition with one dominant idea and verify overflow.

---

## 25. Genericity firewall

Challenge:
- universal rounded cards;
- card nesting;
- gratuitous gradients;
- glass everywhere;
- giant hero type;
- centered everything;
- repetitive three-column features;
- tiny uppercase metadata everywhere;
- floating blobs;
- fake dashboards/metrics;
- identical radius and elevation;
- random icons;
- decorative animation;
- component-library defaults shipped visually untouched.

Do not replace one cliché with another.

Ask:
`what job does this visual decision perform?`

If it does not improve hierarchy, usability, identity, affordance, comprehension, or emotional character, remove it.

---

## 26. Decoration budget and signature moment

Treat high-energy effects as scarce:
- gradients;
- glow;
- blur;
- texture;
- large shadows;
- glass;
- 3D;
- shader/video backgrounds;
- animated decoration.

Prefer one excellent signature moment over six competing effects.

A signature move should improve:
- product recognition;
- hierarchy;
- understanding;
- navigation;
- transition continuity;
- completion feedback.

If every element is a signature moment, none is.

---

## 27. Implementation loop

Use adaptively:

`UNDERSTAND → INSPECT → MODEL → PRIORITIZE → IMPLEMENT → RUN/RENDER → INSPECT → TEST INTERACTION/RESPONSIVENESS → VERIFY → REFINE`

Fast-path tasks may collapse several phases.

Do not stop at IMPLEMENT for substantive UI work when rendering is available.

---

## 28. Visual QA before handoff

Inspect in perceptual order:

1. product hierarchy and primary action;
2. macro composition/balance;
3. typography and content measure;
4. spacing/alignment;
5. responsive transformation and overflow;
6. states and interaction feedback;
7. accessibility signals;
8. runtime/performance symptoms;
9. Design DNA and genericity.

Classify defects by owner and fix the highest correct layer.

For deep review route to `dme-visual-verification-spynx-edition`.

---

## 29. Failure recovery examples

**Looks generic**
→ revisit product pressure, counter-default, composition, type, signature; do not add random effects.

**Responsive layout needs many breakpoint patches**
→ revisit structure/overflow ownership, not breakpoint count.

**State bug returns**
→ reconstruct event/state owner/order, not another visual patch.

**Variants explode**
→ revisit semantic component API and token model.

**Accessibility needs repeated local fixes**
→ repair primitive/interaction architecture.

**Performance tweak has no effect**
→ invalidate hypothesis and measure another contributor.

---

## 30. Handoff

Report concisely:
- what changed;
- important product/design/architecture decisions;
- validation actually performed;
- any remaining limitation or unverified surface.

Do not dump private reasoning.

The final test is not “does this look modern?”

It is:

**Does this surface now make the product more obvious, specific, trustworthy, responsive to intent, and satisfying to operate without sacrificing correctness?**

---

## Standalone core capsule

If `../../shared/CORE_CONTRACT.md` is unavailable, preserve explicit user intent and external contracts; inspect minimum repository context; use risk-based depth and autonomy; avoid unjustified dependencies; treat accessibility/responsiveness as construction constraints; verify proportionally; render substantive changes when possible; distinguish verified/inferred/unverified; stop when outcome and relevant gates are satisfied.
