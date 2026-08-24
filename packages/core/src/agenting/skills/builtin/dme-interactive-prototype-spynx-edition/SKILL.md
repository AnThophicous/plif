---
name: dme-interactive-prototype-spynx-edition
description: Build a deterministic, realistic interactive frontend prototype that answers explicit product questions through real state transitions, validation, responsive behavior, and honest simulation boundaries.
---

# DME Interactive Prototype | Spynx Edition — Behavior Before Backend

A prototype is an executable hypothesis.

Its job is not to look like production. Its job is to make uncertain product behavior testable without lying about what is real.

Use this for:

- clickable prototypes;
- interaction studies;
- high-fidelity product demos;
- validation of multi-step flows;
- testing navigation/state concepts;
- stakeholder evaluation before backend integration.

Do not add random hover effects to a static mockup and call it a prototype.

## 1. State the question

Before implementation, define what the prototype must answer.

Examples:

- can users understand how to add and compare three items;
- does the inline-edit model remain clear after validation failure;
- is the mobile checkout flow manageable without losing order context;
- does optimistic reordering feel trustworthy.

If no product question exists, use `dme-front-end-spynx-edition` for implementation or `dme-ui-options-spynx-edition` for visual exploration.

## 2. Define the scenario contract

Specify:

- start state;
- actor/user;
- goal;
- completion state;
- alternate/invalid path;
- recovery path;
- screens or regions involved;
- data that must persist;
- states that must be represented;
- boundaries intentionally simulated.

Only simulate what helps answer the question.

## 3. Model the state machine

For non-trivial flows, define states and transitions explicitly.

Think:

`state + event → next state + side effect`

Include relevant:

- idle;
- editing;
- validating;
- pending;
- success;
- error;
- retry;
- confirmation;
- cancellation;
- empty;
- permission-limited;
- interrupted.

Avoid boolean soup when several booleans can create impossible combinations.

The prototype should make impossible states impossible where practical.

## 4. Preserve deterministic behavior

Use:

- stable fixtures;
- stable ids;
- predictable latency;
- explicit mock outcomes;
- inspectable state.

Do not use randomness unless randomness itself is being tested.

A reviewer should be able to reproduce the same path twice.

If multiple outcomes are needed, expose a deliberate simulation control or deterministic fixture mode rather than hidden chance.

## 5. Build an honest simulation boundary

Mock server behavior behind a narrow adapter.

Keep UI logic unaware of whether the adapter is real or simulated when that helps future integration.

Make simulation explicit in code and handoff.

Never:

- include real credentials;
- perform destructive production calls;
- process real payments;
- claim persistence that does not exist;
- show misleading success after a simulated operation;
- bury mock data inside presentational components.

## 6. Fidelity budget

Spend fidelity where it answers the product question.

High fidelity may be justified for:

- complex validation;
- gestures;
- animation timing;
- spatial continuity;
- dense information;
- mobile ergonomics;
- realistic content.

Keep fidelity low for unrelated areas.

Do not build a full settings system to test one onboarding transition.

## 7. Repository integration

When prototyping inside an existing product:

- use its framework;
- use existing design primitives;
- preserve routing conventions;
- reuse assets;
- respect existing accessibility patterns;
- avoid introducing a parallel mini-stack.

For a standalone prototype, choose the smallest runtime that supports required interactions.

Do not add dependencies by reflex.

## 8. Interaction quality

Implement the path using actual interaction semantics.

Where relevant:

- keyboard;
- pointer;
- touch;
- focus;
- validation;
- navigation;
- overlays;
- escape/cancel;
- back behavior;
- reduced motion;
- loading;
- error recovery.

Transitions should communicate causality or continuity.

Do not make users wait for decorative animation.

## 9. Prototype realism

Use realistic:

- labels;
- content lengths;
- validation messages;
- list sizes;
- empty cases;
- delays;
- failures.

The prototype should break for the same kinds of reasons the real interface might break.

Do not use lorem ipsum where text length affects layout or comprehension.

## 10. Responsive behavior

Prototype structural transformations, not just width changes.

Test:

- narrow supported width;
- intermediate stress width;
- representative desktop;
- long content;
- open overlays;
- keyboard focus after reflow.

If mobile interaction differs meaningfully, prototype the difference rather than pretending one DOM composition must look identical everywhere.

## 11. Observability

A prototype used for decision-making should make its behavior understandable.

Where useful, provide lightweight development-only observability:

- current state;
- selected fixture;
- simulated latency/failure mode;
- transition log;
- route/step identifier.

Do not expose this as product UI unless the test requires it.

## 12. Validation run

Before handoff, run at least:

### Primary path
Start → successful completion.

### Invalid path
Trigger realistic validation failure.

### Recovery
Recover from an error without resetting unrelated state.

### Back/cancel
Verify expected rollback or persistence.

### Refresh expectation
Verify whether state should survive refresh; if not, say so.

### Responsive path
Complete the core scenario at representative narrow and desktop widths.

### Accessibility path
Keyboard-operate the core interaction and inspect focus.

If browser capability exists, perform the run in the rendered prototype.

## 13. Failure recovery

If the prototype does not answer the product question:

- identify whether the problem is flow, state model, content, visual hierarchy, simulation fidelity, or implementation;
- change the smallest layer that invalidates the hypothesis;
- rerun the scenario.

Do not keep polishing a prototype whose underlying question remains unanswered.

## 14. Handoff contract

Report:

- product question answered;
- what is real;
- what is simulated;
- state/data persistence assumptions;
- known gaps;
- what evidence supports the recommended behavior;
- what production integration still requires.

Never describe simulated backend behavior as production-ready.

The prototype succeeds when a product decision becomes easier to make.
