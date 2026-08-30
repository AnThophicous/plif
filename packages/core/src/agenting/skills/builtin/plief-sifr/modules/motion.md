# Motion — choreography, causality and engine boundaries

Motion communicates cause, continuity, hierarchy, state, spatial relationship and settlement. It does not exist to prove that the page is animated. Store substantial motion in IR `motion` using `schemas/motion-contract.schema.json`.

## Motion hierarchy

Define three levels, using fewer when the product is quieter:

1. **Signature sequence** — at most one identity-bearing moment tied to comprehension, navigation or completion.
2. **Recurring motifs** — a small family of related transitions encoding the spatial/material model.
3. **Microfeedback** — immediate acknowledgement and settlement for activation, selection, save, drag, validation and progress.

An interface where every section fades upward, every control springs and every decoration loops has activity but no choreography.

## Sequence contract

For each meaningful sequence record:

```text
trigger -> anticipation -> action -> follow-through -> settlement
purpose | affected hierarchy | spatial origin/destination | cue/beat timing |
easing/tempo | interrupt/cancel/reverse behavior | input ownership |
reduced-motion equivalent | performance owner | verification keyframes
```

- Choreograph attention: establish context, reveal the primary fact/action, then supporting detail; do not reveal everything with equal delay.
- Preserve object continuity across transitions. Shared elements travel from a believable origin; enter/exit directions reflect the spatial model.
- Frequent actions settle quickly. Decorative motion cannot hide latency or delay input.
- Motion is interruptible: rapid toggles, route changes, back navigation and repeated gestures must converge on valid state without queueing stale animations.
- Scroll-linked motion must remain legible at fast/slow/reverse scroll and cannot hijack essential navigation. Use a static or discrete alternative when continuous mapping adds no meaning.
- Idle motion needs a reason and a rest state. Competing loops are removed; held stillness may be a deliberate beat.

## Timing and engine boundaries

Small-state transitions often begin around 100–250ms; distance, consequence, platform convention and frequency decide the final range. Define a tempo family rather than one duration for everything.

CSS/WAAPI suits bounded property transitions; state-driven libraries suit interruptible component/layout orchestration; timeline tools suit authored sequences; Rive/Lottie/video suit authored media; WebGL suits material/spatial behavior. Route current library facts through Orun. Two engines cannot drive the same property/interaction without a recorded reason and ownership boundary.

Prefer transform/opacity for common motion. Layout, filters, clip paths, canvas and shaders require measured budgets; the visual idea does not waive runtime cost.

## Reduced motion and proof

Reduced motion removes non-essential translation, scale, parallax, autoplay and continuous drift while preserving state/sequence meaning through opacity, instant replacement, color, outline, copy or discrete progress. It is a designed variant, not `animation:none` applied blindly.

Watch substantive choreography continuously. Also capture keyframes immediately before/at/after boundaries plus interruption, reverse, rapid repeat, loading, reduced-motion and narrow cases. Two pleasing stills do not prove a good transition; a smooth transition does not prove correct settlement.
