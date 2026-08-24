---
name: dme-front-end-spynx-edition
description: Build or redesign production frontend experiences — web pages, applications, dashboards, landing pages, components, emails, printable layouts, and slide-like web surfaces — as coherent products with intentional identity, responsive architecture, accessible states, repository-native implementation, and visual proof.
---

# DME Front End | Spynx Edition — Product Experience Kernel

Build interfaces that people understand quickly, control confidently, enjoy operating, and remember afterward.

Do not decorate rectangles. Do not optimize for a screenshot. Do not mistake "clean" for designed.

A successful interface makes product intent visible through structure, interaction, typography, density, motion, content, and technical behavior. It should feel specific to the product even with the logo removed.

Failure modes this skill exists to prevent:

- technically valid but generic UI;
- visually impressive but confusing UI;
- beautiful happy-path screenshots with broken real states;
- responsive layouts that merely shrink desktop;
- component-library defaults presented as product identity;
- decorative motion that increases latency or uncertainty;
- local redesigns that destroy established behavior;
- accessibility added after the visual system;
- architecture rewritten for aesthetic convenience;
- "production-ready" claims without rendered evidence.

## 1. Decision precedence

When rules compete, use this order:

1. explicit user outcome, references, scope, and prohibitions;
2. external behavior and product contracts that must remain correct;
3. accessibility, security, data integrity, and platform constraints;
4. deliberate repository conventions and existing design-system contracts;
5. product evidence discovered from code, content, assets, neighboring screens, and runtime behavior;
6. this skill's decision systems;
7. aesthetic defaults and examples.

Lower-precedence rules never override stronger evidence.

Preserve existing behavior the user did not ask to change unless:

- it is defective;
- it blocks the requested outcome;
- it is the root cause of a systemic problem;
- the benefit of changing it clearly exceeds regression risk.

Do not preserve a bad abstraction merely because it exists. Do preserve external contracts while improving internals whenever possible.

## 2. Autonomy model

Default to **bounded autonomy**.

Act without asking when the decision is reversible, well-supported, low-risk, and inside the requested outcome.

Escalate from local improvement to wider reconstruction only when evidence shows that local work would be fragile, contradictory, or materially inferior.

Before widening scope, identify the invariant being protected.

Examples:

- `checkout behavior unchanged`;
- `existing routes remain valid`;
- `keyboard path remains operable`;
- `public component API preserved`;
- `design tokens remain source of truth`;
- `server/client rendering assumptions preserved`.

A wider refactor must buy a concrete capability: coherence, correctness, accessibility, performance, maintainability, or a substantially better product experience.

## 3. Route the problem before solving it

This is the frontend kernel. Route to specialist skills when the actual uncertainty belongs there.

| Signal | Specialist |
|---|---|
| Information architecture, navigation, hierarchy, or task flow is unsettled | `dme-wireframe-spynx-edition` |
| Structure is stable but visual direction is genuinely open | `dme-ui-options-spynx-edition` |
| A clickable flow is needed to answer a product/interaction question | `dme-interactive-prototype-spynx-edition` |
| Shared tokens, component families, theming, or visual foundations are the task | `dme-design-system-spynx-edition` |
| An implementation exists and must be judged from rendered evidence | `dme-visual-verification-spynx-edition` |

A substantial project may flow through several specialists:

`frame → wireframe → visual direction → implementation → visual verification`

Do not invoke every skill by ritual. Route only when it can change a decision.

Inherit settled decisions from earlier phases. Do not reopen them without new evidence.

## 4. Adaptive depth

Choose the cheapest depth that can produce reliable work.

### Fast path

Use when:

- scope is local;
- intended behavior is already clear;
- regression surface is small;
- nearby code provides strong precedent;
- no unresolved product, state, responsive, accessibility, or architecture question exists.

Flow:

`inspect local context → state invariant → edit → targeted verification → stop`

Do not manufacture strategy documents for a localized fix.

### Standard path

Use for:

- a meaningful component;
- a page or screen;
- forms;
- async states;
- substantial visual refinement;
- multi-file responsive work.

Flow:

`understand → inspect → model → decide → implement → render → verify → refine`

### Deep path

Use for:

- greenfield experiences;
- design-system work;
- multi-screen redesign;
- ambiguous information architecture;
- shared state or data architecture;
- accessibility-sensitive workflows;
- large data surfaces;
- performance regressions;
- high-fidelity reference reconstruction;
- systemic visual incoherence;
- defects whose cause is not local.

Add:

- explicit invariant ledger;
- broader repository reconstruction;
- hypothesis management;
- specialist routing;
- state/viewport matrices;
- runtime and performance evidence;
- orthogonal subagents when available.

Start small. Escalate when uncertainty, risk, or evidence grows.

## 5. Repository reconnaissance

Before substantive implementation, discover the minimum context that changes decisions.

Search before opening large files. Prefer symbols, configs, relevant ranges, and neighboring examples.

Inspect when relevant:

- package manifest and framework versions;
- route and rendering model;
- styling system and token sources;
- component library and primitives;
- existing page shell and navigation;
- local fonts and font loading;
- icon source;
- image/asset pipeline;
- form and validation conventions;
- state/data libraries;
- server-state patterns;
- localization;
- themes;
- tests, typecheck, lint, build, story/demo tooling;
- browser/preview commands;
- accessibility or visual-regression tooling;
- adjacent screens that reveal the product language.

Do not introduce a dependency until you verify the repository cannot already solve the problem adequately.

Do not replace a stack because another stack is easier for you to generate.

## 6. Product frame before pixels

Resolve, infer, or discover:

- **user** — who operates this surface;
- **job** — what they came to accomplish;
- **primary action** — what matters most now;
- **secondary actions** — what must remain available but not compete;
- **expertise** — novice, occasional, expert, mixed;
- **frequency** — one-time, occasional, repetitive;
- **consequence** — low-stakes, trust-sensitive, destructive, financial, regulated;
- **density** — how much information must be scanned or compared;
- **device** — likely widths and input modes;
- **latency sensitivity** — how quickly feedback must arrive;
- **content reality** — likely lengths, missing data, localization, user-generated content;
- **success state** — what "done" feels like to the user.

Ask only when an unknown would materially change architecture or behavior.

## 7. Product Gravity

Visual form follows product pressure.

Use:

`signal → decision → consequence`

Examples:

**High-frequency expert workflow**
→ prioritize scanability, short travel, keyboard continuity, stable placement, and dense alignment
→ reduce ornamental separation and repeated explanations.

**Trust-sensitive action**
→ prioritize consequence visibility, explicit state, reversibility, confirmation proportional to risk
→ do not hide critical meaning behind clever interaction.

**Editorial reading**
→ typography, measure, cadence, section hierarchy, and reading continuity dominate
→ controls should stay quiet.

**Exploratory consumer surface**
→ richer imagery, atmosphere, and discovery can be justified
→ the next action and current state must still remain obvious.

**Large repeated dataset**
→ alignment, comparison, sorting, filtering, grouping, sticky context, and progressive disclosure dominate
→ do not wrap every record in a large card.

**Mobile repetitive task**
→ thumb reach, persistent task context, focused actions, compact controls, and interruption recovery dominate
→ do not preserve desktop composition mechanically.

Every major visual pattern should have a product reason.

## 8. Experience Engine

"Pleasure to use" is not a gradient. It is a chain of reinforced confidence.

Optimize these six properties:

### Clarity
At any moment, the user can answer:

- where am I;
- what matters now;
- what changed;
- what can I do next.

### Agency
Actions acknowledge input immediately, expose state, remain predictable, and are reversible when practical.

### Fluency
Remove repeated decisions, unnecessary pointer travel, duplicate entry, needless modal hops, and re-reading.

### Immediacy
Feedback arrives at the speed the user expects. Visual effects never make input feel slower.

### Character
The interface has a recognizable visual and behavioral voice derived from the product.

### Reward
Important completions may receive a satisfying response: motion, visual resolution, progressive reveal, subtle sound when the product supports it, or a concise success state.

Reward must reinforce meaning. Never delay frequent work just to perform delight.

### Interaction physics
Important controls should have a coherent three-beat response:

`affordance → acknowledgement → settlement`

- **affordance**: the control looks operable before interaction;
- **acknowledgement**: input receives immediate perceptible response;
- **settlement**: the resulting state becomes stable and understandable.

Do not fake completion to create speed. Acknowledge immediately, represent real pending work honestly, then settle decisively.

### Desire without manipulation
Make people want to return because the interface respects their attention and rewards mastery.

Increase desire through:

- speed;
- fluency;
- beautiful proportional relationships;
- predictable control;
- useful shortcuts;
- crisp feedback;
- meaningful progressive reveal;
- small moments of craft discovered through use.

Do not use dark patterns, false urgency, obstructive cancellation, deceptive defaults, or attention traps as "engagement."

## 9. Signature DNA

Before meaningful visual implementation, establish a compact internal design thesis.

### Product voice

Place the product on the dimensions that matter:

- restrained ↔ expressive;
- editorial ↔ application-like;
- dense ↔ spacious;
- technical ↔ human;
- precise ↔ playful;
- geometric ↔ organic;
- quiet ↔ theatrical;
- monochromatic ↔ chromatic;
- conventional ↔ experimental.

Do not randomly choose an aesthetic label. Derive the coordinates from product context.

### Signature move

Choose one memorable move that improves hierarchy, comprehension, interaction, or identity.

Examples:

- a distinctive type relationship;
- a deliberate navigation rhythm;
- a recognizable data composition;
- a rare accent behavior;
- a useful spatial interruption;
- a transition that explains continuity;
- a signature framing or divider system.

If the only memorable move is "gradient background", there is no design thesis.

### Counter-default

Name the nearest generic pattern being deliberately refused:

- card grid;
- giant centered hero;
- repeated metric tiles;
- universal pills;
- all-muted-gray dashboard;
- card-inside-card hierarchy;
- identical feature rows;
- decorative gradient field.

### Coherence laws

Choose a small number of repeated rules for:

- typography;
- spacing rhythm;
- surface hierarchy;
- corner/border logic;
- accent use;
- image treatment;
- iconography;
- motion.

Identity comes from a few laws repeated with conviction, not from novelty everywhere.

## 10. Genericity Firewall

When a surface begins to look AI-generated, do not add decoration. Diagnose the pattern.

Warning signals:

- everything is a rounded card;
- every value is a tile;
- every label is tiny uppercase gray;
- every action is a pill;
- content is centered by reflex;
- sections repeat the same rhythm;
- gradients have no semantic/compositional role;
- shadows are the only grouping device;
- hero text is huge for no product reason;
- icon + title + gray sentence repeats in a grid;
- fake testimonials, fake metrics, or impossible data fill empty space;
- all sections receive equal emphasis;
- the component library is more recognizable than the product;
- swapping logo and accent would make the UI belong to any company.

For each suspicious pattern ask:

1. What job does this pattern perform?
2. Is it required by hierarchy?
3. Is it required by interaction?
4. Is it required by content structure?
5. Is it part of existing product identity?
6. Is there a simpler or more distinctive relationship that communicates the same thing?

If no strong answer exists, remove or replace it.

### Logo-off test

Mentally remove logo, company name, and hero artwork.

If the remaining interface has no recognizable identity, strengthen composition, typography, density, interaction language, or spatial rhythm.

## 11. Information hierarchy before components

Before styling, identify:

- entry point;
- reading/scan path;
- dominant action;
- secondary action zones;
- persistent context;
- transient feedback;
- tightly related groups;
- information that must compare;
- information that can disclose progressively.

Everything cannot be emphasized.

Use contrast, placement, scale, density, color, and space as a hierarchy system rather than independent decoration.

## 12. Typography is architecture

Define roles instead of arbitrary sizes.

Possible roles:

- display;
- page title;
- section title;
- body;
- compact body;
- label;
- metadata;
- numerical/data;
- control;
- annotation.

Only create roles the product needs.

For each role decide:

- family;
- size behavior;
- line height;
- weight;
- tracking;
- measure;
- wrapping;
- responsive compression.

Prefer fonts already licensed and loaded.

Common fonts are not forbidden. Reflexive font choice is.

Dense product UI may benefit from quiet, highly legible typography. Expressive surfaces may let display type carry much of the identity.

Never trade legibility for novelty.

## 13. Space expresses ownership

Spacing should answer "what belongs together?"

Use a coherent rhythm for:

- control internals;
- related elements;
- component padding;
- group separation;
- section separation;
- page gutters;
- major structural voids.

A scale is a grammar, not a prison.

One optical correction can be design. Repeated unexplained exceptions are drift.

Whitespace is not automatically premium.

Density is not automatically clutter.

Choose from task frequency, expertise, device, and information volume.

## 14. Color, surface, shape, and depth

Build a hierarchy of surfaces before assigning decorative effects.

Color should distinguish:

- base environment;
- elevated or nested regions when needed;
- text hierarchy;
- primary emphasis;
- semantic states;
- interaction states.

Accent color is more meaningful when scarce.

Do not make all colors equally loud.

Treat radius, borders, dividers, shadows, translucency, and texture as one shape/depth language.

Use atmosphere only when it supports identity or spatial understanding.

Possible tools include:

- hairline rule systems;
- controlled grain;
- inset depth;
- selective translucency;
- geometric pattern;
- image field;
- lighting;
- layered tonal surfaces.

Do not stack effects to prove effort.

## 15. Responsive design is structural transformation

Never implement responsive behavior as:

`desktop but narrower`

For each region, decide whether it:

- remains;
- compresses;
- reorders;
- wraps;
- collapses;
- becomes a drawer/sheet;
- becomes horizontal overflow inside its own boundary;
- changes control type;
- moves closer to the active task;
- hides because it is genuinely secondary.

Think in priority transitions, not device names.

Add breakpoints where composition or interaction fails, not because a popular device width exists.

Validate at:

- the narrowest supported width;
- an intermediate stress width;
- a representative large width;
- relevant zoom;
- long/localized content;
- pointer and touch contexts when supported.

Avoid page-level horizontal scrolling. Data regions may own intentional overflow when preserving structure is more usable than destructive stacking.

## 16. Interaction design: every reachable state is product

For interactive surfaces, enumerate only reachable states, but do not omit real ones:

- default;
- hover where pointer exists;
- focus-visible;
- active/pressed;
- selected;
- disabled;
- loading;
- stale/background refresh;
- empty;
- partial data;
- validation error;
- system error;
- success;
- destructive confirmation;
- optimistic pending;
- retry;
- offline or interrupted when relevant;
- overflow/long content;
- permission denied when relevant.

The interface should explain state without requiring the user to infer it from color alone.

Motion should communicate:

- causality;
- spatial continuity;
- hierarchy;
- state transition;
- completion.

Decorative motion gets the remaining budget after interaction responsiveness.

Respect reduced motion.

Do not use animation to conceal slow work.

## 17. Component architecture

Do not optimize for number of files.

Extract a component when it buys:

- reuse;
- state ownership;
- behavioral isolation;
- visual identity;
- testability;
- cognitive simplification.

Avoid both:

- monoliths whose behaviors cannot be reasoned about independently;
- fragments that turn simple markup into indirection.

Expose product semantics rather than styling trivia.

Prefer:

`density="compact" tone="critical" state="selected"`

over collections of props that merely mirror CSS when those semantic dimensions actually exist.

Use the repository's primitives before creating parallel ones.

## 18. State architecture

Use the smallest correct state model.

Distinguish:

- local transient UI state;
- form state;
- URL/navigation state;
- server state;
- shared application state;
- persisted state;
- derived state.

Rules:

- keep state near the behavior that owns it;
- do not duplicate state that can be derived safely;
- URL state should represent navigable/shareable product state when appropriate;
- server state should not be copied into global client state without a concrete reason;
- model asynchronous transitions explicitly when ordering matters;
- protect against stale closures, duplicate submission, racing responses, and state resurrection when relevant.

For complex flows, reconstruct:

`input → event → owner → transition → side effect → persistence → render`

before editing.

## 19. Data and asynchronous UX

A data interface is a temporal system.

Consider:

- first load;
- background refresh;
- stale data;
- pagination/infinite loading;
- filtering;
- sorting;
- optimistic mutation;
- retry;
- partial failure;
- cancellation;
- empty results;
- permissions;
- network latency;
- race conditions.

Skeletons are not mandatory. Spinners are not mandatory. Optimism is not mandatory.

Choose the representation that gives the user the clearest model of what is happening.

Never fabricate successful server behavior in production code merely to make the UI look complete.

## 20. Accessibility is a construction constraint

Prefer native semantic behavior before ARIA.

Validate where relevant:

- semantic landmarks;
- heading structure appropriate to host page;
- accessible names;
- persistent form labels;
- field/error association;
- keyboard reachability;
- logical focus order;
- visible focus;
- focus restoration for overlays;
- escape behavior;
- text contrast of at least 4.5:1 for normal text and 3:1 for large text unless a stricter product requirement applies;
- meaningful non-text/control contrast around 3:1 against adjacent colors where required;
- touch targets designed around comfortable ~44 CSS px hit areas for primary touch interactions, without destroying dense expert workflows;
- screen-reader state announcements;
- reduced motion;
- zoom/reflow;
- non-color state communication.

Do not force "one h1 inside every reusable component." Heading levels belong to page hierarchy.

Do not add ARIA that duplicates or conflicts with native semantics.

Accessibility that changes after visual design is finished usually exposes architectural mistakes.

## 21. Performance: protect the interaction

Do not cargo-cult optimize.

Identify the suspected bottleneck first.

Possible contributors:

- render frequency;
- expensive reconciliation;
- large lists;
- layout thrash;
- image decoding;
- font loading;
- network waterfalls;
- script/bundle weight;
- hydration;
- expensive effects;
- main-thread animation;
- uncontrolled event work.

Use measurement or defensible proxies.

Prioritize the largest contributor.

Typical high-value protections:

- stable layout dimensions for media;
- appropriate image sizing/format;
- lazy loading where it helps;
- avoid unnecessary client JS;
- virtualization only for genuinely large lists;
- memoization only when it reduces measured/reasoned cost;
- transform/opacity motion when animation is needed;
- avoid forcing layout in hot interactions;
- preserve streaming/SSR/hydration assumptions.

Never degrade readability or maintainability for speculative micro-optimization.

## 22. Dependencies

A new dependency is justified only when:

1. existing project capability is insufficient;
2. the need is real, not convenience;
3. maintenance and bundle/runtime cost are acceptable;
4. compatibility with the current stack is verified;
5. the dependency materially reduces risk or implementation complexity.

Do not add a component library to implement one component.

Do not write fragile custom infrastructure to avoid a mature dependency when the dependency is clearly the safer choice.

## 23. Assets, icons, and content

Use real project assets first.

Never:

- invent a real company's logo;
- redraw a brand mark from memory;
- mix unrelated icon families;
- use emoji as interface icons unless the product intentionally does;
- use fake analytics or testimonials as if factual;
- leave broken image placeholders;
- hotlink arbitrary assets.

When an authorized image-generation or asset tool exists and custom imagery materially improves the product, generate for the actual composition and inspect the result before integration.

Text is part of interface architecture.

Use realistic copy lengths and domain-appropriate language. Design errors, empties, labels, and confirmations with the same care as the hero state.

## 24. Surface-specific routing

### Marketing / landing
Identity and narrative matter, but conversion hierarchy must remain clear. Vary section rhythm instead of repeating feature-card grids. Use proof only when real or clearly placeholder.

### Product application
Density, scanability, persistent context, state visibility, and fast interaction dominate decoration.

### Dashboard / analytics
Decide what questions the data answers before choosing charts or metric tiles. Preserve comparison and trend visibility. Do not tile every number.

### Forms
Design error recovery, progressive disclosure, field dependencies, input modes, autocomplete, validation timing, and successful completion.

### Tables / enterprise data
Prioritize alignment, column semantics, sorting/filtering, bulk actions, selection state, sticky context, overflow ownership, and keyboard use.

### Print / paged media
Use print-aware layout, physical units where appropriate, pagination behavior, repeating table headers, and output verification.

### Email
Follow the target email-client constraints. Avoid JavaScript and unsupported layout assumptions. Use robust table/inlined-style patterns when required by compatibility.

### Slides
Treat the slide as a fixed composition with one dominant idea. Preserve readability at presentation distance and verify no overflow.

## 25. Anti-default patterns

These are not universal bans. They require product justification.

- excessive rounded cards;
- card inside card;
- universal pills;
- giant hero type;
- purple/pink gradient as substitute for identity;
- glassmorphism without spatial reason;
- arbitrary glow;
- excessive shadows;
- centered everything;
- three-features-in-a-row by reflex;
- meaningless metric cards;
- tiny uppercase labels everywhere;
- decorative blobs;
- floating controls without interaction reason;
- identical spacing across every section;
- random asymmetry;
- gradients on headline text as the only typographic idea;
- decorative icons on every heading;
- a component library shipped visually untouched;
- motion on every element.

Do not replace one cliché with another.

## 26. Verification ladder

Verification must be proportional to risk.

### Level 1 — static
Inspect diff, types, semantics, state paths, and invariants.

### Level 2 — targeted
Run affected tests, lint/type checks, component checks.

### Level 3 — rendered
Start the real surface and inspect representative states and widths.

### Level 4 — interaction
Operate with keyboard, pointer/touch where available, validation, overlays, navigation, and error recovery.

### Level 5 — integration/build
Run relevant integration, build, smoke, or end-to-end validation.

### Level 6 — performance
Measure runtime, bundle, rendering, or network behavior when performance is part of the risk.

A screenshot does not prove behavior.

A passing test does not prove visual quality.

Compilation does not prove usability.

If rendering capability exists, substantial UI work should normally be rendered.

## 27. Perceptual QA loop

For meaningful UI work:

`IMPLEMENT → RENDER → INSPECT → CLASSIFY DEFECT → FIX ROOT → RENDER AGAIN`

Inspect in this order:

1. product hierarchy;
2. composition and balance;
3. typography and content measure;
4. alignment and spatial rhythm;
5. responsive behavior and overflow;
6. interaction states;
7. accessibility signals;
8. runtime errors and performance regressions;
9. signature DNA and genericity.

Do not tweak randomly.

For every defect, identify whether its owner is:

- token;
- primitive;
- component;
- layout;
- state model;
- content;
- asset;
- runtime behavior.

Fix the highest correct owner.

Use `dme-visual-verification-spynx-edition` for deep rendered review.

## 28. Failure recovery

When an approach fails:

`classify → collect evidence → update model → choose new strategy`

Examples:

- visual direction feels generic → do not add effects; revisit signature DNA and composition;
- responsive layout collapses repeatedly → revisit structure, not breakpoint count;
- state bugs recur → identify state owner and event ordering;
- component variants explode → revisit semantic API and token model;
- accessibility requires many patches → revisit primitive or interaction choice;
- performance tweak has no effect → invalidate the hypothesis and measure another contributor.

Do not repeat cosmetic variants of the same failed strategy.

## 29. Stop condition

Finish when:

- the user's objective is satisfied;
- critical invariants hold;
- the primary action and hierarchy are legible;
- reachable states are coherent;
- relevant responsive behavior is verified;
- accessibility obligations are met for the changed surface;
- technical checks relevant to risk pass;
- rendered evidence exists when the environment supports it;
- no known regression remains;
- another iteration is unlikely to create material improvement.

Do not keep polishing because more polish is possible.

## 30. Handoff

Normal frontend work should end with a concise report:

- what changed;
- important design/architecture decisions;
- validation actually performed;
- any material limitation or unverified surface.

Do not dump private reasoning.

Do not call work "production-ready", "polished", or "pixel-perfect" unless the evidence supports that claim.

The final test is not "does this look modern?"

It is:

**Does this product now feel more obvious, more specific, more trustworthy, more responsive to intent, and more satisfying to operate — without sacrificing correctness?**
