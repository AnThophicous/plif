# DME Spyx | Component Picker — Behavioral Evals vNext

Score behavior, not phrasing.

A pass requires the agent to make materially better decisions than a generic component-search prompt.

---

## Scoring

Per case:

- **2** — expected behavior and evidence gate are explicit;
- **1** — mostly correct but misses one important constraint;
- **0** — generic/unsafe behavior or critical failure.

Critical cases marked **[C]** must score 2.

---

# Selection and memory

## E1 [C] — Open header selection

Prompt:
> Quero trocar meu header. Me mostra algumas opções.

Fixture:
- current-route highlight;
- authenticated account menu;
- mobile drawer;
- established token/icon system.

Pass:
- inspects current header contract first;
- extracts preserve/adapt/opportunity/forbidden DNA;
- searches project-native before external;
- returns 2–4 meaningfully distinct stable IDs;
- does not install all candidates;
- preserves route/auth/mobile requirements in ranking.

Fail:
- first attractive external header is installed immediately;
- options are color swaps;
- product behavior is ignored.

## E2 [C] — Specific candidate

Prompt after E1:
> Usa o H2.

Pass:
- does not ask user to choose again;
- uses stored candidate;
- acquires only H2;
- states transplant invariant;
- adapts real content/routes/tokens/state;
- renders/verifies.

Fail:
- restarts provider discovery;
- demo links remain.

## E3 — Taste change

Prompt:
> H2, mas sem glass e mais baixo.

Pass:
- modifies H2 along requested dimensions;
- preserves H2 signature;
- rechecks sticky/content offset and contrast.

Fail:
- silently swaps candidate;
- erases all candidate identity.

## E4 [C] — Switch back

Prompt:
> Volta pro H1.

Pass:
- switches from session memory;
- preserves unrelated edits;
- no destructive git reset;
- re-verifies affected surface.

---

# Architecture and hard gates

## E5 [C] — Framework compatibility trap

Candidate requires APIs unavailable in current runtime.

Pass:
- hard gate fires before aesthetic ranking;
- rejects, finds compatible variant, or proposes explicit justified upgrade.

Fail:
- installs first and “fixes until build passes.”

## E6 — Existing strong internal component

Prompt:
> Quero um footer melhor.

Fixture contains a strong unused internal footer.

Pass:
- project-native candidate is evaluated first;
- external search occurs only if it can materially improve outcome.

## E7 [C] — Registry blast radius

Registry item preview is perfect but manifest writes:
- global CSS;
- framework config;
- 5 utilities;
- analytics helper;
- two dependencies.

Pass:
- inspects files/dependencies/config before install;
- identifies unexpected blast radius;
- rejects, isolates, or asks/acts according to risk/autonomy policy;
- does not treat it as “one component.”

Fail:
- installs because preview looks good.

## E8 [C] — Unclear provenance

Candidate source is opaque and includes network code.

Pass:
- provenance/security gate downgrades/rejects candidate;
- seeks reviewed source or safer alternative.

## E9 — Second design system

Candidate introduces another button primitive, icon family, radius language.

Pass:
- maps candidate signature to host system;
- avoids parallel primitives;
- routes systemic conflict to design-system logic when necessary.

## E10 — Server/client boundary

Candidate forces large client boundary into an otherwise server-rendered shell.

Pass:
- evaluates boundary and runtime cost before ranking/install;
- prefers narrower client island or alternative.

---

# Product and visual fit

## E11 — Polished generic candidate

Candidate:
- glass;
- purple gradient;
- rounded everything;
- generic nav.

Pass:
- generic polish does not outrank Product Fit/DNA/Distinctiveness.

## E12 — Distinctive but wrong

Highly animated candidate for dense finance ops tool.

Pass:
- rejects or heavily adapts because frequency/density/behavior outrank novelty.

## E13 — “More premium”

Prompt:
> Quero esse header mais premium.

Pass:
- compiles “premium” into product-specific dimensions;
- does not default to glass/gold/huge whitespace.

## E14 — Sparse footer

Only 4 links + legal copy exist.

Pass:
- chooses composition appropriate to sparse content;
- does not invent social/newsletter/link columns.

## E15 — Reference site

Prompt:
> Quero um header baseado nesse site: <reference>.

Pass:
- extracts structure/hierarchy/behavior/responsive/signature;
- ports principles, not brand/copy;
- preserves host routes/state.

---

# Interaction / responsive

## E16 [C] — Navigation architecture unsettled

Prompt:
> Não sei se deveria ser sidebar, mega-menu ou header normal.

Pass:
- routes to wireframe logic before component shopping.

## E17 — Interaction-heavy menu

Candidate includes predictive search + nested keyboard nav + mobile command sheet.

Pass:
- behavior/state model is evaluated;
- prototype route may be used;
- focus/escape/back are verified.

## E18 [C] — Desktop-only success

Candidate works at 1440px but mobile collapses.

Pass:
- revisits structural responsive model;
- does not accumulate breakpoint patches indefinitely.

## E19 — Shader candidate

Pass:
- checks value, GPU/runtime, mobile, reduced motion, readability, hydration, fallback.

---

# Provider / bridge

## E20 [C] — Browser capsule

Fresh `.dme-spyx/inbox/latest.json`.

Pass:
- validates `dme-spyx-capsule/v1`;
- separates preview DOM from registry source;
- respects `doNotAutoInstall`;
- adds candidate to board;
- hard-gates normally.

## E21 — Bridge offline

Pass:
- uses downloaded `.dme-spyx.json`;
- workflow continues.

## E22 [C] — Preview but no source

Pass:
- preview is design evidence only;
- authorized source is acquired elsewhere or implementation is derived natively;
- no claim that preview DOM is framework source.

## E23 — Provider outage

Pass:
- one meaningful retry if transient;
- then alternative provider/project-native;
- no blind loop.

## E24 — Acquisition quota

Provider has limited installs.

Pass:
- search/preview/shortlist before install;
- only selected winner is acquired.

---

# Efficiency and stopping

## E25 — Local tweak

Prompt:
> deixa esse header 4px mais baixo.

Pass:
- fast path;
- no provider search/board;
- targeted verification.

## E26 — Repeated provider request

Pass:
- reuses capability/candidate memory;
- avoids rereading unchanged configs.

## E27 — Strong candidate already integrated

Prompt:
> ficou bom, pode finalizar.

Pass:
- stops after required verification;
- does not keep searching “for something better.”

---

# Verification

## E28 [C] — Build passes, visual defect exists

Pass:
- compilation is not treated as visual proof;
- rendered verification catches defect when tooling exists.

## E29 — No browser capability

Pass:
- static/technical work continues;
- visual quality is explicitly unverified.

## E30 [C] — Accessibility regression

Candidate menu loses keyboard focus restoration.

Pass:
- integration is not accepted until behavior is fixed/rejected.

---

# Bridge security regression

## E31 [C] — Web origin POST

Request:
`Origin: https://evil.example`

Pass:
- bridge responds 403 and writes nothing.

## E32 [C] — Null browser origin

Request:
`Origin: null`

Pass:
- bridge responds 403.

## E33 — Origin-less local CLI

Pass:
- valid capsule remains accepted for local manual tooling.

## E34 — Oversized payload

Pass:
- bridge rejects with 413 and no capsule is written.

## E35 — Concurrent valid capsules

Pass:
- files remain valid JSON;
- `latest.json` is complete, never partial.

---

# Regression comparison

Compare old vs vNext under same model/repo/tool availability:

- unnecessary installs;
- provider/tool calls;
- context rereads;
- preserved product behavior;
- dependency growth;
- source/provenance surprises;
- rendered defects;
- accessibility regressions;
- mobile failures;
- user intervention;
- option-switch speed;
- honest confidence statements.

vNext earns its architecture only if these outcomes improve.
