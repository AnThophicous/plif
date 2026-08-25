---
name: dme-spyx-component-picker
description: >
  Discover, compare, acquire, adapt, swap, and verify real frontend components
  from the current project, team/private registries, shadcn-compatible registries,
  21st.dev tooling/authorized browser capture, and other configured providers
  without losing product DNA, behavior, accessibility, responsiveness, provenance,
  or repository conventions.
---

# DME Spyx | Component Picker — Component Intelligence Layer vNext

A component is raw material.

The product is the source of truth.

Do not start by installing what looks attractive.

When available, load:
- `../../shared/CORE_CONTRACT.md`;
- `references/COMPONENT_DNA.md`;
- `references/PROVIDER_ENGINE.md` only when provider discovery is needed;
- `references/SPYX_BRIDGE.md` only when browser-captured capsules are involved.

---

## 1. Core modes

### FAST LANE
For high-frequency shell/section swaps:
- header/navbar;
- footer;
- hero;
- CTA;
- pricing/proof block;
- sidebar;
- command/search;
- auth shell.

Open request:
`inspect slot → extract Slot DNA → discover → hard-gate → shortlist 2–4 → choose → acquire winner → transplant → render → verify`

Specific request/candidate:
`inspect → hard-gate candidate → acquire → transplant → render → verify`

Local tweak:
`inspect local owner → edit → targeted verification`

Do not run the picker for “make header 4px shorter.”

### DEEP PICKER
Use when component choice materially affects:
- state architecture;
- complex forms/data;
- nested navigation;
- accessibility model;
- server/client boundary;
- animation runtime;
- WebGL/shaders;
- large dependency graph;
- performance budget;
- shared design-system primitives.

Add deeper source inspection, behavior modeling, and specialist routing.

---

## 2. DME affinity

This skill is a specialist, not a competing frontend brain.

Inherit settled:
- Product Frame;
- IA Contract;
- Visual Direction / Design DNA;
- design-system authority;
- invariants;
- responsive behavior;
- accessibility constraints.

Route when component selection exposes another unresolved problem:

- information architecture/navigation unsettled → `dme-wireframe-spynx-edition`;
- visual thesis genuinely open → `dme-ui-options-spynx-edition`;
- shared token/primitive conflict → `dme-design-system-spynx-edition`;
- behavior must be tested before transplant → `dme-interactive-prototype-spynx-edition`;
- final rendered QA → `dme-visual-verification-spynx-edition`.

Do not rediscover decisions that are already settled.

---

## 3. Decision precedence

For component work:

1. explicit user choice/reference;
2. external behavior and product contracts;
3. accessibility/security/data integrity/platform constraints;
4. settled product/design decisions;
5. repository-native architecture/design system;
6. Slot DNA;
7. candidate signature;
8. provider defaults.

The imported component is never the highest authority.

---

## 4. Slot reconnaissance

Before discovery map the slot.

### Structural
- container/full-bleed;
- horizontal/stacked/split/overlay;
- sticky/fixed/static;
- one-row/multi-row;
- primary/secondary regions;
- mobile transformation;
- content density.

### Behavioral
- routes;
- active state;
- auth/session;
- menu/dropdown/sheet;
- search;
- locale/theme;
- keyboard;
- scroll behavior;
- analytics/flags;
- state ownership.

### Visual
- typography;
- spacing rhythm;
- surface/border/radius;
- icon family;
- contrast;
- material/elevation;
- motion character;
- signature accent.

### Product
- job;
- primary action;
- expertise;
- trust level;
- frequency;
- dominant device.

Identify:
- **must preserve**;
- **safe to adapt**;
- **opportunity for improvement**;
- **forbidden regression**.

Do not require a candidate to match every current detail. DNA tells you what matters and what can improve.

---

## 5. Project-native first

Before external search inspect:
- existing primitives;
- unused/adjacent components;
- internal/team registry;
- existing installed provider components.

Project-native wins when it satisfies the outcome with low adaptation cost and preserves product coherence.

Search externally only when it can materially improve:
- behavior;
- accessibility;
- design quality;
- speed;
- maintainability;
- distinctive product character.

Do not use provider search as ritual.

---

## 6. Provider capability detection

Providers and commands change.

Detect the live surface instead of assuming:
- configured MCP servers/tools;
- `components.json` or equivalent registry config;
- shadcn CLI/tool availability;
- 21st CLI/MCP availability;
- authorized Spyx browser bridge/capsule;
- team/private registry;
- Magic UI / Aceternity / other shadcn-compatible registries;
- configured v0 or other generation provider.

Use provider capability, provenance, and fit — not brand preference.

Do not make one provider a hard dependency for the suite.

---

## 7. Acquisition budget

Separate:

`search/discovery → preview/source inspection → acquisition/install → adaptation`

Do not consume install/download quotas just to compare visuals if preview/search is enough.

Maintain session memory:
- provider capabilities already checked;
- candidate IDs;
- source locations;
- acquisition status;
- rejected reason;
- selected transplant invariant.

Do not reacquire the same candidate unless source changed.

---

## 8. External-code blast-radius gate

Before installation, inspect what the registry/provider item can change.

Check:
- provenance/author/source;
- license when relevant;
- all files written/replaced;
- registry dependencies;
- package dependencies/peer dependencies;
- install/postinstall scripts;
- config/global CSS changes;
- environment variables;
- server/client boundary;
- framework/runtime version;
- path aliases;
- Tailwind/CSS assumptions;
- security-sensitive code;
- network calls;
- analytics/telemetry;
- data/auth assumptions.

Modern registries may distribute components, hooks, utilities, configuration, rules, or other files. Do not treat a registry item as “one TSX file” without inspection.

Reject, sandbox, or require explicit approval when blast radius is disproportionate.

---

## 9. Candidate hard gates

A candidate does not enter aesthetic ranking until it passes or has an explicit repair plan for:

### Stack
- framework;
- runtime/version;
- SSR/RSC/client boundary;
- TypeScript;
- styling system;
- package manager;
- path aliases.

### Dependencies
- peer compatibility;
- animation runtime;
- icon system;
- utility packages;
- CSS/keyframes;
- bundle/runtime implications.

### Behavior
- required routes/state;
- auth;
- keyboard;
- mobile transformation;
- active/selected state;
- loading/error where relevant.

### Accessibility
Reject or budget repair for:
- inaccessible core navigation;
- missing focus model;
- incorrect semantic controls;
- hover-only essential actions;
- broken dialog/menu semantics that require extensive rewrite.

### Provenance/security
Reject or isolate when:
- source/provenance is unclear;
- unexpected scripts/network behavior exists;
- item modifies unrelated configs/files;
- secrets or unsafe assumptions appear.

### Integration risk
Reject when it requires disproportionate:
- framework migration;
- global CSS corruption;
- state rewrite;
- rendering-boundary rewrite;
- second design system.

A visually perfect but incompatible candidate loses.

---

## 10. Candidate ranking

After hard gates, rank by consequence:

- **Product Fit** — supports the actual user job/primary action;
- **DNA Affinity** — can feel native without erasing its value;
- **Behavior Fit** — required interaction/state matches;
- **Responsive Fit**;
- **Accessibility Repair Cost**;
- **Adaptation Cost**;
- **Dependency/Runtime Cost**;
- **Provenance Confidence**;
- **Distinctiveness** — strengthens identity instead of importing generic provider UI.

Use 1–5 scores only when close candidates benefit from explicit comparison.

Hard gates outrank totals.

Do not confuse provider polish with product fit.

---

## 11. Picker Board

When user choice is valuable, return 2–4 stable IDs.

For each candidate store:
- ID (`H1`, `H2`, `F1`, ...);
- provider/source;
- thesis/signature;
- product-fit note;
- behavior note;
- adaptation cost;
- dependency/blast-radius note;
- risk;
- acquisition status.

Candidates must be meaningfully different.

Do not install all candidates to create the board.

If the user already selected a candidate, skip the board.

---

## 12. Reference-site mode

When the user provides a reference, extract:

`structure → hierarchy → behavior → responsive transformation → signature move`

Also inspect:
- typography relationship;
- material;
- density;
- animation/spatial behavior when visible.

Do not mechanically transplant:
- branding;
- copy;
- proprietary data;
- inaccessible behavior;
- framework-specific internals;
- accidental layout defects.

Default: derive and adapt.

Increase fidelity only when explicitly requested/authorized.

---

## 13. Browser-capsule trust model

A Spyx capsule is **evidence**, not automatically trusted production source.

For `dme-spyx-capsule/v1`:
- validate schema;
- inspect provider/page URL;
- separate `preview.dom` from registry/source snapshot;
- treat preview DOM as visual/structural evidence;
- prefer authorized registry/source files for production code;
- honor `handoff.doNotAutoInstall`;
- run normal hard gates before acquisition/integration.

Never equate captured DOM with framework source.

If source is unavailable:
- use preview as evidence;
- acquire through another authorized route;
- or implement a project-native interpretation.

Label what was captured versus acquired.

---

## 14. Candidate acquisition

Acquire only after:
- user selection; or
- evidence strongly establishes one winner and autonomy/risk rules permit direct action.

Before applying:
- inspect diff/manifest where tooling permits;
- confirm files/dependencies;
- isolate unexpected changes;
- reject provider demo data/config not needed by host.

Never run opaque install commands blindly just because they are official examples.

---

## 15. Transplant invariant

Before adaptation, name what made the candidate worth choosing.

Example:

```text
TRANSPLANT INVARIANT
preserve the compact asymmetric nav/CTA tension and the fast mobile command transition
```

You may change:
- exact color;
- font;
- copy;
- spacing;
- radius;
- icon family;
- implementation library;
- breakpoint;
- internal component structure.

Do not adapt so aggressively that all candidates collapse into the same house component.

Product coherence and candidate identity must coexist.

---

## 16. Transplant protocol

### Content
Replace demo:
- branding;
- links;
- CTA;
- account actions;
- fake metrics/testimonials;
- placeholder text.

Use real routes/data/content.

### Behavior
Reconnect:
- routing;
- auth/session;
- active route;
- menus/search;
- locale/theme;
- analytics hooks/flags when already present;
- responsive interaction.

### Design system
Map to host:
- typography;
- semantic colors;
- spacing;
- radius;
- borders/surfaces;
- icons;
- motion.

Preserve signature; discard provider boilerplate.

### Architecture
Fit:
- component boundaries;
- aliases;
- server/client split;
- state ownership;
- utilities;
- test conventions.

### Accessibility
Repair semantics/focus/keyboard before visual polish.

### Performance
Remove runtime/decorative cost that does not pay for product value.

---

## 17. Header/navigation swap protocol

Headers are high-risk.

Map before swap:
- home/logo action;
- nav source;
- active route;
- primary CTA;
- account/auth;
- locale/theme;
- mobile navigation;
- sticky/fixed offsets;
- scroll behavior;
- overlay focus;
- z-index;
- keyboard path.

Prefer preserving public header export/API.

Use a local adapter when provider props differ instead of leaking provider API across the app.

After swap verify:
- desktop;
- narrow/mobile;
- intermediate awkward width;
- active route;
- auth/account state;
- sticky offset;
- keyboard + escape/focus restore;
- build/runtime.

---

## 18. Interaction-heavy candidate gate

For command palettes, predictive search, mega-menus, drag/drop, animated navigation, or unusual gesture:

- model state/transition behavior;
- inspect keyboard semantics;
- inspect cancellation/back;
- inspect loading/error;
- prototype first when uncertainty is meaningful.

Appearance alone cannot validate behavior-heavy components.

---

## 19. Shader / WebGL / heavy-effect gate

Before integrating:
- identify product value;
- measure/estimate runtime/GPU cost;
- inspect mobile fallback;
- protect text readability;
- respect reduced motion;
- avoid hydration/server-boundary mistakes;
- provide non-WebGL fallback where product still needs to function.

A visually impressive shader is not automatically a good component.

---

## 20. Switching and iteration

Stable candidate IDs are session contracts.

If user says:
- “H2 but no glass” → modify H2 along that dimension;
- “back to H1” → switch using stored candidate/session info;
- “make H2 shorter” → preserve H2 identity and reverify affected layout.

Do not rediscover providers every time.

Do not use destructive git reset to switch variants.

Preserve unrelated edits.

---

## 21. Failure recovery

### Candidate does not fit visually
Revisit DNA/signature; do not accumulate endless CSS overrides.

### Candidate breaks behavior
Identify missing product contract; adapt narrowly or reject.

### Too many dependencies
Find lower-cost candidate or remove nonessential effects.

### Desktop works, mobile fails repeatedly
Revisit structural responsive model, not breakpoint patch count.

### Provider unavailable
One meaningful retry if transient, then use another provider/project-native path.

### Bridge offline
Use downloaded capsule/manual import. Do not block the whole workflow.

### Preview exists, source absent
Treat preview as evidence, not source.

### Build fails after install
Classify stack/dependency/import/CSS mismatch, revert unsafe partial integration, update candidate model, choose a new strategy.

Do not blindly repeat install.

---

## 22. Verification

A component is not integrated because it compiles.

For substantive swaps verify:
- source acquisition status;
- integration status;
- targeted tests/typecheck/lint as relevant;
- build/runtime;
- representative widths;
- required states;
- keyboard/focus;
- responsive transformation;
- host token/design coherence;
- console/runtime errors;
- performance risk when effect-heavy.

Use `dme-visual-verification-spynx-edition` for deep rendered QA.

Distinguish:
- source acquired;
- source integrated;
- build passing;
- rendered verified.

They are different claims.

---

## 23. Stop conditions

Stop when:
- selected/evidence-selected candidate is integrated;
- transplant invariant survives;
- product behavior survives;
- host design language is coherent;
- provider boilerplate does not leak without reason;
- responsive states work;
- accessibility is acceptable for changed surface;
- dependencies/blast radius are justified;
- relevant technical checks pass;
- rendered verification exists when tooling permits;
- no known material regression remains.

Do not keep searching after a strong candidate is successfully integrated unless user asks for more.

---

## 24. Communication contract

For open selection show the Picker Board.

For direct implementation, do not force a catalog.

After integration report:
- selected component/source;
- what was preserved;
- what was adapted;
- dependencies/files added or changed materially;
- verification performed;
- remaining limitation.

Do not narrate every search/install attempt.

---

## Standalone core capsule

If shared core is unavailable: inspect slot/product before providers; prefer project-native; detect live provider capabilities; hard-gate compatibility/provenance/blast radius before ranking; acquire only selected candidate; preserve a transplant invariant; reconnect real behavior/content/tokens; render and verify; recover by changing strategy rather than reinstalling blindly.
