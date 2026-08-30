# Media & Spatial — assets, video, shaders and 3D with a job

Load this module only when imagery, video, canvas/WebGL, shaders, 3D or dynamic material is important to the result. It owns `media_contracts[]` in ExperienceIR (`schemas/media-contract.schema.json`). Performance, accessibility, motion and component modules retain their own boundaries.

## 1. Pick the cheapest medium that preserves the idea

Start from the intended perception: explain, prove, orient, evoke, demonstrate, navigate, manipulate, or visualize data. Then compare suitable media; CSS -> SVG/canvas -> image -> video -> shader -> 3D is **not** a prestige ladder.

Use a heavier medium only when its distinctive property matters:

- image: a selected moment, evidence, atmosphere or art direction;
- video: change over time, human/product demonstration, cinematic pacing;
- shader: continuous procedural material, distortion, texture or data-reactive field;
- 3D: viewpoint, volume, spatial relationship or direct manipulation;
- CSS/SVG/canvas: often the stronger choice for crisp diagrams, bounded texture and lightweight motion.

Write the purpose and the cheaper rejected alternative in the media contract. Decoration with no product, narrative or identity return is removed.

## 2. Asset contract before placement

For each meaningful asset record: role, purpose, owner, source/provenance/license state, focal subject, crop/fit behavior, art treatment, aspect/size variants, loading priority, interaction, alt/captions/transcript, reduced-motion/data/transparency behavior, failure fallback and performance limits.

Source precedence: project-owned assets and real product media -> user-provided assets -> authorized generation/commission -> verified licensed source -> deliberate native abstraction. Never invent a real logo, customer, metric or product screenshot. A placeholder may communicate geometry during iteration, but cannot survive as evidence or final art direction.

Treat the asset set as one world: camera height, crop tension, light direction, grain, saturation, background treatment and subject distance should relate. A collection of individually attractive images with unrelated physics is not art direction.

For authorized generation or commission, write an asset brief before invoking the available asset tool: subject/action, environment, camera/lens or illustration geometry, composition/focal safe zones, light direction/quality, material/texture, palette/grade, aspect/crop variants, series-continuity anchors and explicit exclusions. Inspect the actual output at target crops; a good source image that fails the layout is not a usable asset. Reject generic floating orbs, anonymous device mockups and decorative 3D blobs unless the product thesis specifically earns them.

## 3. Video contract

- Decide `content-bearing` versus `ambient`. Content-bearing video needs user controls and equivalent captions/transcript as appropriate; ambient video cannot carry exclusive meaning.
- Autoplay only when justified; it must be muted and inline. Reduced motion disables autoplay and presents a useful poster/static state. Never autoplay sound.
- Specify poster, first-frame relationship and aspect ratio so poster -> playback does not jump. Give dimensions before load.
- Initial-viewport/LCP media and below-fold media use different loading strategies. Do not lazy-load the actual LCP candidate; defer non-critical media and avoid downloading hidden loops.
- Pause when offscreen/hidden; clean listeners; handle failed decoding and unsupported sources. Preserve action and contrast while frames change behind text.
- For scroll-scrub or timeline video, define authored time, cue ownership, seek behavior, interruption and a non-scrub path. Watch the sequence continuously; isolated stills cannot prove continuity.

## 4. Shader contract

Define effect family, semantic role, palette, inputs/uniforms, interaction driver, text-safe regions, intensity bounds, DPR/frame budget, lifecycle and static/CSS fallback. A shader behind text is tested against its brightest, darkest and highest-frequency frames, not one flattering capture.

Paper Shaders (`https://shaders.paper.design/`) is a candidate for bounded WebGL2 image filters and procedural fields in React or vanilla stacks. At selection time verify the current official API, package, license and runtime support. Choose one effect family because its material behavior fits the thesis; author palette, scale, speed and masking to the product. Never ship the demo preset as the brand. Confirm SSR/client boundaries, resize/DPR handling, offscreen pausing, context loss and a non-WebGL still.

Use custom GLSL only when a packaged effect cannot express the required behavior and the maintenance/performance cost is accepted. Avoid shader text, uncontrolled pointer nausea and full-page high-frequency noise.

## 5. 3D scene contract

Specify: comprehension/story job, scene units and hierarchy, hero silhouette, camera/framing per viewport, controls, object/material palette, light rig, environment, loading/empty/error states, interaction affordances, reduced-motion path, non-WebGL fallback and performance budget.

- Prefer a few named parts/materials and deliberate silhouette over invisible tessellation.
- Lighting is hierarchy: name key/fill/rim/environment roles; avoid shiny-default-everything.
- Camera and focal object must re-compose at intermediate and narrow widths, not merely scale down.
- Cap DPR by measured need; pause the render loop offscreen; dispose geometry, materials, textures and observers; handle context loss.
- Do not place critical navigation or text inside an inaccessible canvas. Provide DOM controls and semantic equivalents for essential information.
- Prototype uncertain manipulation before polishing. Verify keyboard/touch/pointer paths, orbit limits and focus behavior.

## 6. Effect libraries without collage

Magic UI (`https://magicui.design/docs/components`) and similar copy/adapt libraries are mechanism sources, not a design system. Route external discovery through component intelligence/Orun. Inspect framework, Tailwind/shadcn assumptions, Motion/runtime dependencies, global styles, accessibility and source blast radius. Copy or install only the bounded mechanism that survives the product/job test; remap content, tokens, geometry, timing and states; remove demo glows, gradients and typography.

Do not combine a shader background, animated border, particle field, smooth cursor, marquee and 3D globe because each is available. One identity-bearing effect plus quiet support usually creates more authorship than a library sampler.

## 7. Media QA gate

Before completion verify the representative render matrix plus:

- poster, first active frame, brightest/darkest dynamic frames and settled frame;
- loading, decode failure, offline/unsupported and fallback states;
- reduced motion, reduced transparency, reduced data/low-power proxy where applicable;
- contrast and focus visibility over changing backgrounds;
- crop/focal point and camera framing at wide, awkward intermediate and narrow widths;
- offscreen pause, cleanup/context loss, console/hydration health and measured or honestly inferred budget;
- continuous motion/video playback across boundaries, not screenshots only.
