# Verification — render, diagnose and repair + genericity firewall

## Closed loop

```text
IMPLEMENT -> RENDER(representative matrix from matrix_expand.py)
-> INSPECT(A-I) -> COMPARE WITH IR/DNA CONTRACTS
-> CLASSIFY {viewport,state,keyframe,symptom,user_impact,owner,severity,evidence}
-> REPAIR ROOT OWNER -> RE-RENDER AFFECTED MATRIX -> PROVE
```

Run the real product when capability exists; do not validate a fake standalone page outside its shell, theme, fonts, routing and data. The matrix is representative, not a Cartesian explosion.

## Inspect in perceptual order

A. Product clarity: user/job/primary action/evidence and settlement.
B. Macro composition: silhouette, focal path, anchors, density, dead space, container behavior.
C. Typography/content: hierarchy, measure, wrapping/localization, numeric alignment, font fallback and content truth.
D. Responsive: reflow/reorder/overflow owner, sheets/sticky offsets/safe areas/keyboard overlap, page scroll, reading/focus order after transformation.
E. Interaction/state: hover/focus/pressed/selected/disabled/loading/empty/partial/error/success, overlays, retry/cancel/back and interruption.
F. Accessibility: semantics/names, focus/restore, keyboard, targets, contrast/non-color state, zoom/reflow, reduced variants and announcements.
G. Runtime/performance: console/hydration, assets, layout shift, jank, network/media/GPU lifecycle.
H. Identity: agreement with DesignDNA, signature restraint, asset-world coherence, provider/demo leakage and counter-default.
I. Dynamic media/motion: poster -> first frame, transition boundaries/settlement, brightest/darkest/noisiest frames, camera/crop, reduced/failure/non-GPU fallbacks and offscreen pause.

Perceptual stress tests: squint · grayscale · silhouette · density (could ~20% of containers disappear?) · logo-off · effects-off · decoration-budget · unrelated-product substitution. Run against artifact files, never memory or vibes.

For motion/video, watch continuous playback and sample before/at/after boundaries plus rapid interruption/reverse. For shaders/3D, inspect wide/intermediate/narrow, fallback and representative high-load state. Two attractive captures cannot prove continuity, interaction or performance.

## Defect and owner resolution

Severity: critical (blocked/corrupt/inaccessible core/runtime failure) > high > medium > low. Fix critical/high before polish.

Owners: PRODUCT · STRUCTURE · DESIGN_DNA · TOKEN · COMPONENT · STATE · RESPONSIVE · ACCESSIBILITY · PERFORMANCE · CONTENT. `engines/defect_classify.py` deduplicates and proposes owners. Repeated symptoms with one cause become one systemic record; do not patch twelve cards for one token/DNA defect.

Two failed patches on the same defect group force a different strategy/mechanism. If tuning cannot make heavy media satisfy readability, responsiveness or budget, re-open the medium choice rather than degrading the rest of the product.

## Genericity firewall

Do not fabricate a numeric identity score. Make a qualitative proof:

- Name at least three formal choices that derive from this product's content, archetype or interaction model.
- State the single signature relationship and show that it survives logo-off, narrow and reduced-effect variants.
- State the counter-default and verify the implementation did not drift back to it.
- Ask whether an unrelated SaaS/product could reuse the page by swapping only logo, accent and copy. If yes, owner is usually PRODUCT, STRUCTURE or DESIGN_DNA — not “add more decoration.”

Challenge: endless rounded cards/card-in-card; universal pills; giant centered hero copy; gratuitous purple/blue gradients; glass everywhere; arbitrary glow/blob/noise; icon-title-gray-copy feature grids; fake metrics/testimonials; every section centered; uniform radius/elevation; bento without information reason; repeated fade-up reveals; library-demo typography; shader/video/3D spectacle with no product job.

For each suspicious move ask what product job it performs (hierarchy, comprehension, affordance, evidence, identity, spatial continuity, emotional trajectory). No strong answer -> remove or replace with a product-specific relationship. Fashionable patterns are not banned; unjustified ones are.

## Reference fidelity and stop conditions

With an approved reference, compare geometry, proportion, type, spacing, crop, color relationships, hierarchy, interaction and responsive transformation. Pixel diff only stable comparable states. Similarity never overrides product semantics, accessibility, host architecture or non-clonable identity.

Stop when critical/high defects are resolved; changed states cohere; representative widths/keyframes/fallbacks cover the contract; primary interaction works; relevant accessibility/runtime/technical gates pass; and another pass would yield only low-value polish. Report missing capability checks explicitly.
