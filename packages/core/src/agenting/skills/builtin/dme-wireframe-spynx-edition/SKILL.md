---
name: dme-wireframe-spynx-edition
description: Explore and pressure-test information architecture, navigation, content hierarchy, and task flow through structurally different low-fidelity interface directions before visual styling hides bad decisions.
---

# DME Wireframe | Spynx Edition — Structure Before Style

Use this when the product's structure is unsettled.

The deliverable is not a gray mockup. It is a **decision instrument** that makes competing information architectures and interaction models comparable.

Do not spend polish to hide uncertainty.

## 1. Entry conditions

Use this skill when one or more are unresolved:

- navigation model;
- page hierarchy;
- task sequence;
- progressive disclosure;
- content grouping;
- density;
- primary/secondary action placement;
- relationship between list/detail;
- mobile structure;
- multi-step flow;
- persistent context.

Do not use it when:

- the structure is already approved and only visual direction is open — use `dme-ui-options-spynx-edition`;
- the structure and design are settled and implementation is requested — use `dme-front-end-spynx-edition`;
- a clickable behavior model is necessary — use `dme-interactive-prototype-spynx-edition`.

## 2. Frame the task

Before drawing structure, establish:

- user;
- job-to-be-done;
- entry point;
- completion condition;
- primary action;
- decisions the user must make;
- information required before each decision;
- information that can wait;
- frequency of use;
- user expertise;
- device constraints;
- high-consequence steps;
- expected content volume.

Use real labels and realistic content lengths whenever they affect structure.

Placeholder styling is acceptable.

Placeholder meaning is not.

## 3. Build the task graph

Model the primary path as:

`entry → orient → inspect/decide → act → system response → next state`

For each step, ask:

- what question is the user answering;
- what information answers it;
- what action moves them forward;
- what context must remain visible;
- what can be deferred;
- what can go wrong;
- how they recover.

Do not arrange sections before understanding the task graph.

## 4. Establish structural invariants

Write the constraints that every option must satisfy.

Examples:

- primary action remains visible after filtering;
- account context is never lost;
- mobile users can complete the task with one hand;
- comparison requires simultaneous visibility;
- destructive action cannot be confused with navigation;
- expert users need keyboard continuity;
- legal copy must be visible before confirmation.

These invariants make option comparison honest.

## 5. Generate real alternatives

Produce 3-5 options only when the user needs comparison.

Each option must vary the **structural thesis**, not merely component placement.

Useful axes:

- navigation: persistent / contextual / step-driven;
- hierarchy: overview-first / task-first / object-first;
- density: scan-dense / staged / progressive;
- relationship: master-detail / page transition / split pane / inline expansion;
- flow: linear / branching / command-driven / direct manipulation;
- disclosure: visible / expandable / just-in-time;
- mobile adaptation: reordered / collapsed / task-focused / tabbed.

If two options would be implemented with essentially the same information architecture, they are not two options.

## 6. Option contract

Give each option:

- stable id;
- one-line thesis;
- best-fit user/context;
- dominant navigation model;
- primary-action placement;
- strongest advantage;
- largest cost;
- failure risk;
- mobile transformation.

Order from most conventional defensible solution to most exploratory unless evidence suggests another ordering.

Preserve ids across rounds.

## 7. Keep fidelity low but meaning high

Use visual quietness deliberately.

Avoid:

- brand color debates;
- decorative imagery;
- complex shadows;
- motion polish;
- detailed token systems;
- ornamental iconography.

Show enough to understand:

- hierarchy;
- regions;
- controls;
- content length;
- states;
- transitions;
- overlays;
- empty/error behavior;
- responsive transformation.

A beautiful wireframe is not the goal.

A bad structure that is impossible to ignore is useful.

## 8. Pressure-test each option

Walk the same scenario through every option.

At minimum test:

### Task pressure
Can the primary user reach completion without unnecessary decisions?

### Information pressure
Is required context visible at the moment of decision?

### Volume pressure
What happens with many records, long labels, long values, or empty data?

### Narrow-width pressure
What transforms structurally at the smallest supported layout?

### Wide-width pressure
Does extra space improve the task or merely create emptiness?

### Interruption pressure
Can the user leave, go back, or recover without losing context?

### Error pressure
Where is the error explained and how does recovery work?

### Expertise pressure
Does the design punish experts with ceremony or overwhelm novices with density?

### Accessibility pressure
Does source order still make sense? Are actions distinguishable without relying on spatial tricks?

## 9. Compare by consequence

Do not write vague judgments such as "Option B feels cleaner."

Compare consequences.

Example:

`Option B keeps filters and results in one visual field, reducing context switches for frequent users, but consumes more horizontal space and requires a deliberate mobile filter-sheet model.`

Use a decision matrix only when it clarifies a genuine trade-off. Do not create tables by ritual.

## 10. Recommend

Recommend the option whose trade-offs best fit:

- user frequency;
- task complexity;
- content density;
- device mix;
- risk;
- product goals.

Do not automatically recommend the most experimental option.

Do not automatically recommend the safest option.

If a hybrid is clearly superior, derive it explicitly from named strengths of existing options rather than inventing a silent fourth design.

## 11. Convergence

Once the structure is selected:

- freeze the main information architecture;
- preserve its id/thesis;
- record important invariants;
- pass them to `dme-ui-options-spynx-edition`, `dme-interactive-prototype-spynx-edition`, or `dme-front-end-spynx-edition`.

Do not continue generating alternatives after the decision has been made unless new evidence invalidates it.

## 12. Exit gate

A wireframe phase is complete when:

- primary flow is understandable;
- hierarchy supports the job;
- the selected structure survives realistic content;
- mobile and wide behavior are defined structurally;
- critical states have a place;
- known trade-offs are explicit;
- the next phase does not need to rediscover information architecture.

If typography, color, and polish are still needed, that is success. They were not the purpose of this phase.
