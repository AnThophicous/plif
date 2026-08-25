---
name: dme-wireframe-spynx-edition
description: Resolve unsettled information architecture, navigation, content hierarchy, density, and task flow through structurally distinct low-fidelity directions that are pressure-tested before visual polish.
---

# DME Wireframe | Spynx Edition — Structure Before Style vNext

Use this when the product's **structure is the uncertainty**.

When available, load `../../shared/CORE_CONTRACT.md` once.

A wireframe is not a gray screenshot. It is a **decision instrument** that makes competing task models and information architectures comparable before visual styling hides bad structure.

---

## 1. Entry gate

Use this skill when one or more are unresolved:

- navigation model;
- page hierarchy;
- task sequence;
- progressive disclosure;
- content grouping;
- density;
- primary/secondary action placement;
- list/detail relationship;
- mobile structural transformation;
- multi-step flow;
- persistent context;
- comparison strategy;
- workspace/shell architecture.

Do not use it when:

- structure is settled but visual direction is open → `dme-ui-options-spynx-edition`;
- structure/design are settled and implementation is requested → `dme-front-end-spynx-edition`;
- behavior must be exercised to answer the question → `dme-interactive-prototype-spynx-edition`.

If repository evidence already makes the structure obvious, skip option theater and recommend the strongest structure directly.

---

## 2. Frame the decision

Resolve:

- actor/user;
- job-to-be-done;
- entry point;
- completion condition;
- primary action;
- decisions the user must make;
- information required before each decision;
- what can wait;
- frequency and expertise;
- content volume/variance;
- device/input constraints;
- high-consequence steps;
- required persistent context;
- interruption/recovery needs.

Use real labels and realistic content lengths when they affect structure.

Placeholder visual style is fine.

Placeholder meaning is not.

---

## 3. Build the task graph

Model the core path:

`entry → orient → inspect/decide → act → system response → next state`

For each step answer:

- What question is the user answering?
- What information is required to answer it?
- What action advances the task?
- What context must stay visible?
- What can be deferred?
- What could fail?
- How does the user recover?
- What should survive back/refresh/navigation?

Do not arrange sections before understanding the task graph.

For complex flows also map:
- branch points;
- destructive exits;
- confirmation gates;
- expert shortcuts;
- return paths;
- state that crosses screens.

---

## 4. Information obligations

Classify information by obligation:

### Must-see-before-action
Required for safe/correct decision.

### Must-remain-visible
Context needed while comparing or acting.

### Reveal-on-demand
Useful but not worth permanent chrome.

### Background/status
Should be available without competing with the task.

### Historical/reference
Important for audit or understanding, rarely primary.

This prevents "everything on the page" from becoming equal-weight UI.

---

## 5. Structural invariants

Write only constraints that every viable option must satisfy.

Examples:

- primary action remains available after filtering;
- account/workspace context cannot disappear;
- comparison requires simultaneous visibility;
- destructive action cannot be confused with navigation;
- mobile users must complete the task without impossible reach/overflow;
- experts require keyboard continuity;
- legal meaning must appear before confirmation;
- selected object context must survive detail navigation.

An invariant is useful only if violating it would reject an option.

---

## 6. Generate genuinely different structures

Produce 2–4 options only when comparison will change a decision.

Vary the **structural thesis**, not cosmetics.

Useful axes:

### Navigation
- persistent global;
- contextual;
- step-driven;
- command/search-led;
- object-centric;
- split shell.

### Hierarchy
- overview-first;
- task-first;
- object-first;
- timeline-first;
- exception-first.

### Relationship
- master/detail;
- split pane;
- page transition;
- inline expansion;
- side sheet;
- stacked workspace.

### Disclosure
- visible;
- staged;
- expandable;
- just-in-time;
- mode-based.

### Flow
- linear;
- branching;
- direct manipulation;
- command-driven;
- bulk-first.

### Mobile
- reordered;
- task-focused;
- tabbed;
- drawer-backed;
- sheet-based;
- horizontally scrollable within a bounded data region.

If two options preserve the same decision sequence, same context, and same information ownership, they are probably one option with different placement.

---

## 7. Option contract

Give each option a stable ID and:

- thesis in one sentence;
- best-fit user/context;
- navigation model;
- primary action placement;
- persistent context;
- disclosure strategy;
- list/detail or comparison model;
- mobile transformation;
- expert-efficiency behavior;
- major advantage;
- major cost/risk;
- invariant pressure points;
- what evidence would falsify the option.

Do not use meaningless names such as “Modern” or “Clean.”

Name the structural mechanism.

---

## 8. Fidelity discipline

Keep visual fidelity low enough that reviewers judge structure.

Use:
- real labels;
- realistic content lengths;
- clear hierarchy;
- basic states;
- meaningful spacing;
- enough responsive behavior to expose structural problems.

Avoid:
- final brand palette;
- decorative gradients/effects;
- detailed icon polish;
- elaborate motion;
- high-fidelity illustrations

unless one is structurally necessary to test the model.

Do not let visual attractiveness bias architecture selection.

---

## 9. Pressure tests

Pressure-test each serious option.

### Task pressure
Can the primary job be completed without needless context switching?

### Information pressure
Does important information appear before the decision that needs it?

### Volume pressure
What happens with 3, 30, 300, or 3,000 items where relevant?

### Long-content/localization pressure
Do labels, names, errors, and translated text break grouping?

### Narrow-width pressure
What transforms rather than merely stacks?

### Intermediate-width pressure
Does the design become awkward before the mobile breakpoint?

### Wide-width pressure
Does content become disconnected or excessively stretched?

### Interruption pressure
Can users leave, return, resume, or understand pending state?

### Error pressure
Can they recover without losing unrelated work?

### Expertise pressure
Does the same structure support novice comprehension and expert speed where required?

### Accessibility pressure
Does the structure create a logical reading/focus order and avoid interactions that depend solely on hover/visual position?

### State pressure
What happens when content is empty, loading, partial, permission-limited, or stale?

---

## 10. Compare by consequence

Do not flatten everything into a fake score if one trade-off dominates.

Compare:

- task completion clarity;
- information availability;
- navigation cost;
- context preservation;
- scan/comparison quality;
- mobile viability;
- expert efficiency;
- accessibility risk;
- implementation/state complexity;
- scalability with content;
- reversibility;
- fit with existing product shell.

A structurally elegant option that violates a critical invariant loses.

---

## 11. Recommend, do not outsource judgment

When evidence is sufficient:
- recommend one option;
- explain the dominant reason;
- name the strongest alternative and the condition under which it would win.

Do not end with “all options are valid.”

If user preference materially changes the product, invite the choice using stable IDs.

If one option dominates under known constraints, say so and continue.

---

## 12. Convergence

Once a direction is selected, freeze:

- navigation model;
- information ownership;
- task sequence;
- primary action;
- persistent context;
- disclosure rules;
- responsive structural transformations;
- critical state transitions.

Create an **IA Handoff Contract**.

Example:

```text
IA CONTRACT
- global nav remains persistent desktop, drawer-backed mobile
- object list owns filters and selection
- detail context stays side-by-side >= container threshold, route transition below it
- primary action remains in object context, never global header
- destructive action requires explicit detail context
- filter state is URL-shareable
```

Later skills inherit this contract.

Do not reopen it without new evidence.

---

## 13. When to prototype

Route to `dme-interactive-prototype-spynx-edition` when a structural choice cannot be judged statically because it depends on:

- gesture;
- multi-step timing;
- keyboard traversal;
- predictive search;
- nested menus;
- drag/drop;
- optimistic behavior;
- complex validation;
- animation/spatial continuity.

Prototype only the uncertainty.

---


## 14. Verification

Before finalizing the IA Contract, verify the selected structure against the highest-risk cases identified in the pressure tests.

When a rendered low-fidelity harness exists, operate the core path rather than judging screenshots alone.

Mark structural assumptions that remain unverified.

## 15. Exit gate

Finish when:

- task graph is understood;
- important information obligations are explicit;
- structural invariants are protected;
- alternatives are meaningfully different when options were needed;
- serious options survived relevant pressure tests;
- one structure is selected/recommended;
- IA Handoff Contract is clear;
- visual polish has not concealed unresolved structure.

The outcome should make later visual design easier because **what belongs where and why** is no longer ambiguous.

---

## Standalone core capsule

If the shared core cannot be loaded: preserve explicit user intent and product contracts; inspect minimum repository context; use risk-based depth; avoid unnecessary options; protect invariants; validate the selected structure against realistic content, narrow/wide layouts, error/recovery, and accessibility; distinguish verified from inferred.
