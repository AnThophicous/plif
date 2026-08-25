---
name: dme-interactive-prototype-spynx-edition
description: Build deterministic, realistic interactive frontend prototypes that answer explicit product questions through state machines, honest simulation boundaries, accessible interactions, responsive behavior, observability, and scenario evidence.
---

# DME Interactive Prototype | Spynx Edition — Executable Product Hypothesis vNext

A prototype is an **executable hypothesis**.

Its job is not to look production-ready. Its job is to make uncertain behavior testable without lying about what is real.

When available, load `../../shared/CORE_CONTRACT.md` once.

---

## 1. Entry gate

Use for:
- interaction studies;
- clickable/high-fidelity prototypes;
- multi-step flow validation;
- navigation/state concepts;
- gestures;
- optimistic interactions;
- stakeholder evaluation before backend commitment;
- behavior-heavy component candidates.

Do not call a static mock with random hover effects a prototype.

If there is no behavior question:
- implementation → `dme-front-end-spynx-edition`;
- visual direction → `dme-ui-options-spynx-edition`;
- information architecture → `dme-wireframe-spynx-edition`.

---

## 2. State the product question

Before coding, express the uncertainty as something the prototype can answer.

Examples:
- Can users compare three objects without losing selection context?
- Does inline edit remain understandable after server rejection?
- Is mobile checkout manageable when the keyboard is open?
- Does optimistic reorder feel trustworthy when save fails?
- Can nested keyboard navigation remain learnable?

If the question cannot be falsified by interacting with the prototype, it is too vague.

---

## 3. Scenario contract

Define:

- actor/user;
- start state;
- goal;
- completion state;
- alternate/invalid path;
- recovery path;
- screens/regions involved;
- data that must persist;
- data intentionally reset;
- states that must be represented;
- boundaries intentionally simulated;
- viewport/input modes that matter;
- evidence needed to answer the question.

Simulate only what helps answer the question.

---

## 4. Model the state machine

For non-trivial flows use:

`state + event → next state + side effect`

Represent relevant states explicitly:
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
- interrupted;
- stale/background refresh.

Avoid boolean soup that permits impossible combinations.

When ordering matters, model transitions rather than layering ad-hoc loading flags.

For complex flows track:
- source of truth;
- derived state;
- persistence boundary;
- async request identity;
- cancellation/stale response behavior.

---

## 5. Honest simulation boundary

Mock backend behavior behind a narrow adapter.

Good boundary:
`UI → domain action → adapter → deterministic simulated response`

Keep presentational components unaware of fake transport details when practical.

Never:
- include real credentials;
- perform destructive production calls;
- process real payments;
- claim persistence that does not exist;
- fake a successful server write as if production succeeded;
- hide mock data inside random UI components.

Make simulation status explicit in code and handoff.

---

## 6. Deterministic fixtures

Use:
- stable IDs;
- stable content;
- predictable latency;
- explicit success/failure modes;
- inspectable state.

Do not use randomness unless randomness itself is under test.

If several outcomes are needed, expose deliberate simulation controls or fixtures.

A reviewer should reproduce the same scenario twice.

---

## 7. Fidelity budget

Spend fidelity where it changes the product answer.

High fidelity may be justified for:
- validation;
- gestures;
- timing;
- spatial continuity;
- dense data;
- mobile ergonomics;
- realistic content;
- focus behavior.

Keep unrelated surfaces simple.

Do not build a full settings architecture to test one onboarding transition.

---

## 8. Repository integration

When prototyping inside an existing product:
- use its framework;
- use existing primitives/tokens;
- preserve route conventions;
- reuse real assets/content where safe;
- respect accessibility patterns;
- avoid a parallel mini-stack.

For standalone prototypes:
- choose the smallest runtime that supports the required interaction;
- do not add a framework just to look “production-like.”

---

## 9. Interaction contract

Where relevant support:
- keyboard;
- pointer;
- touch;
- focus;
- validation;
- navigation;
- overlays;
- escape/cancel;
- back behavior;
- loading;
- retry;
- reduced motion.

Transitions should communicate causality or continuity.

Do not make users wait for decorative animation.

Essential actions must not depend only on hover.

---

## 10. Prototype realism

Use realistic:
- labels;
- content length;
- list volume;
- validation messages;
- empty cases;
- delays;
- failures;
- permissions.

The prototype should break for the same classes of reasons the production experience might break.

Do not use lorem ipsum where content length or meaning affects comprehension/layout.

---

## 11. Responsive behavior

Prototype structural transformations, not just smaller CSS.

Test:
- narrow stress width;
- intermediate width;
- representative desktop;
- long content;
- open overlays;
- keyboard focus after reflow;
- on-screen keyboard overlap where mobile forms matter.

If mobile interaction is meaningfully different, prototype the different model.

Do not force one composition to mimic desktop everywhere.

---

## 12. Observability

A prototype used for decisions should make its behavior inspectable.

Where useful provide development-only observability:
- current state;
- current route/step;
- selected fixture;
- simulated latency;
- failure mode;
- transition log.

Keep this out of product UI unless the product question requires it.

Observability should reduce review ambiguity, not become a debug dashboard project.

---

## 13. Scenario validation matrix

Before handoff, run relevant scenarios.

### Primary path
Start → successful completion.

### Invalid path
Trigger a realistic validation or domain error.

### Recovery
Recover without resetting unrelated state.

### Back/cancel
Verify rollback/persistence expectations.

### Refresh
Verify whether state should survive. If not, say so.

### Race/stale response
When async ordering matters, verify stale responses do not resurrect old state.

### Responsive
Complete the core scenario at narrow and desktop widths.

### Accessibility
Keyboard-operate the core path and inspect focus/announcement behavior.

If browser/rendering capability exists, run the real prototype.

---

## 14. Evidence capture

Record only evidence that answers the product question:

- observed success/failure;
- confusing transition;
- task completion friction;
- focus/keyboard break;
- state loss;
- responsive collapse;
- misleading pending/success state;
- timing issue.

Do not collect screenshots because screenshots look impressive.

A prototype exists to change a decision.

---

## 15. Failure recovery

If the prototype does not answer the question:

Classify the failure:
- question too broad;
- flow problem;
- state model problem;
- content problem;
- hierarchy problem;
- simulation fidelity problem;
- implementation defect;
- insufficient evidence case.

Change the smallest layer that invalidates the current model and rerun.

Do not polish a prototype whose hypothesis is still undefined.

---

## 16. Production gap ledger

Before handoff separate:

### Real now
- UI behavior;
- state transitions;
- validation logic;
- responsive composition;
- accessibility behavior.

### Simulated
- API;
- persistence;
- auth;
- payment;
- notifications;
- background jobs.

### Still required for production
- API contracts;
- server validation;
- analytics;
- authorization;
- persistence;
- error telemetry;
- real performance testing;
- security review.

Only include items relevant to the prototype.

Never describe a simulated boundary as production-ready.

---

## 17. Handoff

Report:
- product question;
- conclusion supported by evidence;
- what is real;
- what is simulated;
- persistence assumptions;
- known gaps;
- recommended production behavior;
- what still needs production integration.

The prototype succeeds when a product decision becomes easier and more defensible.

---

## 18. Exit gate

Finish when:
- product question is explicit;
- state machine cannot enter obvious impossible states;
- fixtures are deterministic;
- simulation boundary is honest;
- primary/invalid/recovery paths were exercised as relevant;
- responsive/accessibility evidence exists where required;
- decision evidence is sufficient;
- extra polish would not change the answer.

---

## Standalone core capsule

If shared core is unavailable: preserve product contracts; simulate only what answers the question; use explicit state transitions; keep fixtures deterministic; avoid real destructive systems; test primary/error/recovery/responsive/keyboard paths as relevant; distinguish real from simulated; stop when evidence answers the product question.
