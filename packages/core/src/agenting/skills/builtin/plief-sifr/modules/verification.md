# Verification — render → diagnose → repair loop + GENERICITY FIREWALL (canonical)

## Loop

```text
IMPLEMENT → RENDER(representative matrix from engines/matrix_expand.py)
→ INSPECT(passes A–H) → COMPARE_WITH_CONTRACT(IR sections!)
→ CLASSIFY_DEFECT({viewport,state,symptom,user_impact,owner_candidate,severity,evidence})
→ RESOLVE_ROOT_OWNER → RE-RERENDER_AFFECTED_MATRIX(minimal) → PROVE
```

Run the REAL product when capability exists; no fake standalone renders bypassing shell/theme/fonts/routing/data. Evidence matrix = representative combinations, never Cartesian explosion.

## Inspect passes (perceptual order — hierarchy before 1px)

A product clarity · B macro composition/balance/anchors/dead space/container behavior · C typography/content measure/wrapping/numeric alignment/fallback shifts · D responsive mechanics (reorder/collapse/overflow ownership/sheet behavior/sticky offsets/safe areas/keyboard overlap/page h-scroll violation/focus order after reflow) · E interaction states (hover/focus-visible/pressed/disabled/loading/validation/system-error/success/overlays/retry/cancel/back) · F accessibility signals (semantics/names/focus visibility+restoration/keyboard reach/targets/contrast/non-color state/reduced motion/zoom/reflow/announcements) · G runtime health (console/hydration/assets/layout shift/jank/network) · H identity vs design-dna.json + provider leakage + signature restraint.

Perceptual stress tests: squint / grayscale / silhouette / density (~20% containers removable?) / logo-off / decoration-budget count. Run against the DNA FILE, not vibes — fixes the "forgot the design" regression class by construction.

## Defect record & owner resolution

Severity: critical(blocks task/corrupts/inaccessible core/runtime failure) > high > medium > low; fix critical/high first ("don't tune shadows while mobile CTA is unreachable").
Owners fixed enum: PRODUCT STRUCTURE DESIGN_DNA TOKEN COMPONENT STATE RESPONSIVE ACCESSIBILITY PERFORMANCE CONTENT.
`engines/defect_classify.py` dedupes and proposes owners; grouped symptom (e.g., 12 cards same cause) collapses to ONE record with root owner (TOKEN etc.) — repairing twelve cards individually for one systemic cause is a failure case.
Root examples: seven controls share wrong focus→primitive/token · hero-specific asymmetry→local composition · recurring mobile modal overflow→interaction/layout architecture · repeated contrast failures→semantic color system (accessibility contract).

Repeat-cycle guard: ≥2 failed patches on same defect group forces a genuinely different strategy/mechanism (script-enforced flag), per anti-thrash policy.

## Reference-fidelity mode

When approved reference exists compare geometry/alignment/proportion/type/spacing/crop/color relationships/hierarchy/interaction/responsive transformation; pixel-diff only stable comparable states; similarity never overrides product semantics, accessibility or host architecture; copy nothing proprietary/accidental.

## Stop conditions

critical/high resolved · changed states coherent · representative widths pass contract coverage matrix · primary interaction operable · relevant a11y checks pass · runtime clean enough · appropriate technical gates passed (tests/typecheck/build per capabilities) · another pass would yield only low-value polish.

## GENERICITY FIREWALL — canonical section

Diagnose qualitatively (no fake score): silhouette identity · squint identity · logo-off recognition · visual rhythm · composition intentionality · signature element presence · density honesty · default-component dependence (shipped-untouched library defaults read as "the brand").

Challenge any resemblance of: endless rounded cards; card-in-card nesting; universal pills; giant centered hero type; gratuitous purple/blue gradients; glass everywhere; arbitrary glow; decorative blobs; icon-title-gray-copy feature grids repeated; tiny uppercase labels everywhere; fake metrics/testimonials; every section centered; identical radius/elevation on everything; motion with no causal purpose; bento fragmentation without information reason.

For each suspicious decision ask WHAT PRODUCT JOB it performs (hierarchy? comprehension? affordance? identity? emotional character?). No strong answer → remove or replace with product-specific relationship. Do not replace one cliché with another; do not ban fashionable patterns blindly — justify them or drop them.

Reference copy protection lives in visual-forensics non-clonables; here it's enforcement during inspection (Pass H).
