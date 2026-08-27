# Product Intelligence — frame before pixels

Purpose: answer "what problem does this surface solve?" before any layout exists. Produces `product_frame` + `user_jobs` + `constraints` + `invariants` IR sections.

## Infer (from request, repository evidence via Cartographer map, existing code content, neighboring surfaces)

```text
WHO            operator of this surface
WHAT           job-to-be-done; entry point; completion condition
WHY            consequence when it fails; trust level
PRIMARY JOB    what matters now
PRIMARY ACTION single dominant action per view-state
SECONDARY      necessary but non-competing actions
INFO PRIORITY  must-see-before-action vs background
SURFACE TYPE   marketing | app-shell | dashboard | table-heavy | form-flow |
               media | print | email | slide-composition
FREQUENCY      one-time | occasional | repetitive
RISK           low-stakes | trust-sensitive | destructive-capable | regulated
DENSITY        scanned/compared volume expectation
EXPECTED DEVICE dominant device/input profile
SUCCESS STATE  what "done" feels like
```

Translate pressure into consequences explicitly:
- high-frequency + expert + dense → stable placement, compact rhythm, keyboard continuity, short pointer travel.
- trust-sensitive/destructive → consequence visibility, explicit state, reversible path, proportional confirmation.
- exploratory/brand-led → composition and motion budget allowed, but task clarity still wins.

## Honest gate

Low-evidence fields go into the ledger as ASSUMED with impact_if_false. When multiple material unknowns survive the environment/repo search, send ONE consolidated question through Galileu's question ladder (max 3) — never a 12-field interview form.

## Experience engine properties to protect downstream

Clarity · Agency · Fluency · Immediacy · Character · Reward. For important controls reason `affordance → acknowledgement → settlement`; acknowledge pending work honestly then settle decisively; never fake completion.
