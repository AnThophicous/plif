# DME Spyx | Component Picker — Behavioral Evals

These evals exist to detect prompt inflation.

A passing skill must make a coding agent behave materially differently from a
generic "search and install components" prompt.

Score observable behavior, not whether the agent repeats skill terminology.

## Scoring

For each scenario:

- **2** — correct decision and evidence;
- **1** — mostly correct but misses a material behavior;
- **0** — generic, unsafe, wasteful, or contradictory behavior.

Recommended release gate:

- no scenario scored `0` in the Critical set;
- at least 85% of all available points;
- no regression against the prior released skill on the same agent/runtime.

---

# Critical set

## E1 — Open header selection

Prompt:

> Quero trocar meu header. Me mostra algumas opções.

Repository:

- existing global header;
- current-route highlighting;
- authenticated account menu;
- mobile drawer;
- Tailwind/shadcn stack.

Expected:

- inspects current header contract before external search;
- extracts Header DNA/invariants;
- discovers candidates without installing every one;
- returns 2–4 stable IDs such as H1/H2/H3;
- candidates are meaningfully different;
- explains behavior/integration trade-offs;
- does not destroy auth/current-route behavior;
- does not install before user chooses unless preview requires a reversible local
  harness that does not consume external acquisition.

Fail if:

- immediately installs the first attractive header;
- gives color-swapped options;
- ignores existing account/mobile behavior.

## E2 — Specific candidate

Prompt:

> Usa o H2.

Expected:

- does not ask the user to choose again;
- uses stored candidate/session information;
- acquires only H2;
- preserves transplant invariant;
- adapts content/routes/tokens/state;
- verifies rendered header.

Fail if:

- reruns discovery;
- offers H1/H2/H3 again;
- drops demo links into production.

## E3 — Iterative taste change

Prompt after H2:

> H2, mas sem glass e mais baixo.

Expected:

- modifies H2 rather than creating a new random direction;
- preserves the candidate's structural/signature identity;
- removes translucency only if not structurally necessary;
- rechecks sticky/content offset after height change.

Fail if:

- silently replaces H2 with another component;
- rediscovers catalog;
- removes the characteristic reason H2 was selected.

## E4 — Switching back

Prompt:

> Agora volta pro H1.

Expected:

- switches from picker/session memory;
- does not search providers again;
- preserves unrelated edits made since the first comparison;
- reruns affected verification.

Fail if:

- uses destructive git reset;
- starts discovery from zero.

## E5 — Compatibility trap

Candidate:

- React 19-only behavior;
- project is React 18;
- candidate is visually ideal.

Expected:

- hard gate fires before aesthetic ranking wins;
- rejects candidate, finds compatible variant, or explicitly proposes a justified
  project upgrade;
- never silently ports incompatible APIs with guesses.

Fail if:

- installs then "fixes until build passes" without deciding compatibility first.

## E6 — Existing strong component

Prompt:

> Quero um footer melhor.

Repository already contains a high-quality footer primitive used on another
surface.

Expected:

- discovers project-native option before external providers;
- evaluates adapting/reusing it;
- searches externally only if it can materially improve the outcome.

Fail if:

- provider search is mandatory regardless of repo evidence.

## E7 — Reference site

Prompt:

> Quero um header baseado nesse site: <reference>.

Expected:

- extracts structure, hierarchy, behavior, responsive transformation, signature;
- ports principles into the host product;
- preserves host brand/routes/state;
- increases fidelity only when requested/authorized.

Fail if:

- blindly copies branding/copy;
- chooses a candidate solely from screenshot resemblance.

## E8 — Acquisition budget

Provider exposes many candidates but limited installs/downloads.

Expected:

- search/preview/dry-run before acquisition;
- shortlist before consuming install budget;
- only winner is acquired;
- session memory prevents duplicate acquisition.

Fail if:

- installs 3–5 candidates just to compare them.

---

# Specialist-routing set

## E9 — Navigation architecture is unsettled

Prompt:

> Quero outro header, mas também não sei se a navegação devia ser lateral,
> mega-menu ou normal.

Expected:

- recognizes that the real uncertainty is information architecture;
- routes/invokes `dme-wireframe` logic before component shopping;
- component discovery follows the chosen navigation model.

Fail if:

- treats navigation architecture as aesthetic choice.

## E10 — Design system conflict

Candidate introduces:

- 24px radius;
- new button primitive;
- new icon library;
- project uses square controls and another icon family.

Expected:

- invokes design-system thinking;
- normalizes infrastructure;
- preserves the candidate's actual signature instead of provider defaults;
- avoids duplicate button/icon systems.

Fail if:

- imports visible provider styling wholesale.

## E11 — Interaction-heavy navigation

Candidate has:

- predictive search;
- nested keyboard navigation;
- mobile command sheet.

Expected:

- models behavior before production transplant;
- may route to `dme-interactive-prototype`;
- verifies focus and escape/back behavior.

Fail if:

- judges candidate from appearance only.

## E12 — Final QA

After a substantial header/footer swap.

Expected:

- invokes/render-equivalent `dme-visual-verification`;
- checks narrow/intermediate/desktop;
- keyboard;
- navigation state;
- sticky offset;
- console/runtime;
- supported themes.

Fail if:

- declares success from build alone.

---

# Provider/bridge set

## E13 — Browser-picked 21st candidate

A fresh `.dme-spyx/inbox/latest.json` exists.

Expected:

- validates capsule schema;
- separates preview DOM from registry source;
- runs hard gates;
- adds candidate to Picker Board;
- does not auto-install when the user's request was only exploratory.

Fail if:

- treats captured DOM as production source.

## E14 — Bridge offline

Extension cannot POST locally.

Expected:

- uses downloaded `.dme-spyx.json` fallback;
- continues selection workflow.

Fail if:

- tells user the whole provider is unusable.

## E15 — Registry source unavailable

Capsule contains preview DOM but no source snapshot.

Expected:

- uses preview as structural/visual evidence;
- acquires source through another authorized path or derives a project-native
  implementation;
- labels what was and was not acquired.

Fail if:

- claims source exists because preview HTML exists.

## E16 — Shader candidate

A shader standalone is available.

Expected:

- treats it as effect/runtime evidence;
- checks WebGL/GPU, mobile, reduced motion, readability, fallback, and hydration;
- integrates only if product value justifies the runtime cost.

Fail if:

- pastes standalone HTML into a React component and ships.

---

# Anti-generic set

## E17 — Candidate is polished but generic

Candidate:

- rounded cards;
- glass header;
- purple gradient;
- generic nav;
- strong provider polish.

Expected:

- ranks it below a more product-specific candidate unless those patterns have a
  product/DNA reason;
- does not confuse visual polish with product fit.

## E18 — Candidate is distinctive but wrong

Candidate:

- memorable;
- highly animated;
- poor fit for dense B2B workflow.

Expected:

- Product Fit and Behavior Fit outrank novelty;
- rejects or heavily adapts candidate.

## E19 — User wants "more premium"

Expected:

- compiles intent into concrete dimensions;
- uses current Product/Slot DNA;
- does not default to glass, gradient, huge whitespace, or gold.

## E20 — Empty-content footer

Project has only:

- 4 links;
- legal line;
- no newsletter/social.

Expected:

- chooses a composition that works with sparse content;
- does not invent 20 links to fill a catalog footer.

---

# Performance/efficiency set

## E21 — Repeated request

User asks for another footer after already scanning providers.

Expected:

- reuses provider/tool capability knowledge;
- avoids rereading unchanged project config;
- searches only what changes the decision.

## E22 — Low-risk local tweak

Prompt:

> deixa esse header 4px mais baixo.

Expected:

- fast path;
- no provider search;
- no Picker Board;
- targeted verification.

Fail if:

- runs the complete Spyx workflow.

## E23 — Provider failure

21st unavailable after one meaningful retry.

Expected:

- classifies provider failure;
- falls back to configured registries/project-native alternatives;
- does not loop repeated fetch/install attempts.

## E24 — No browser capability

Implementation environment cannot render.

Expected:

- completes static/technical work if possible;
- explicitly says rendered verification is unavailable;
- does not claim visual polish.

---

# Regression contract

Run these evals against both old `frontend-components` and DME Spyx with:

- same agent/model;
- same repository fixture;
- same tool availability;
- same user prompts.

Compare:

- unnecessary installs;
- user choice quality;
- preserved behavior;
- number of regressions;
- rendered defects;
- dependency growth;
- repeated tool calls;
- amount of user intervention;
- successful option switching.

The new skill earns its size only if those outcomes improve.
