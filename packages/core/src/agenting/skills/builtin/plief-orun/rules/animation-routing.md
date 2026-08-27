# Animation Engine Resolver

Choose by interaction model, not prestige.

## CSS
Default for local hover/focus/color/opacity/simple transforms and short transitions.

## Motion
Prefer for React state-driven enter/exit, layout/shared-layout, gestures, drag,
scroll-linked values and composable React interactions.
Current React imports must be verified against Motion docs; do not fall back to historical
`framer-motion` imports by habit.

## GSAP
Prefer for complex imperative timelines, scroll choreography/pinning, advanced SVG,
sequencing, Draggable/Inertia and orchestration across heterogeneous targets.
Load/register only plugins actually required.

## Anime.js
Consider for imperative DOM/SVG/text/timeline/draggable/layout workflows where its engine
is a cleaner fit than React-centric state animation.

## Rive
Use when the animation is a `.riv` asset, state machine, data-bound interactive graphic
or designer/runtime workflow. Do not casually translate it into another engine.

## Three.js
Use only for true 3D/WebGL content.

## Conflict rule
Two engines may coexist when concerns are orthogonal.
Two engines driving the same element/property/interaction require a compelling reason.
