# Accessibility — construction constraints

Accessibility enters `accessibility_contract` and media/motion contracts before implementation.

## Core construction

Prefer native semantics before ARIA; never duplicate native behavior. Landmarks and heading hierarchy belong to page context, so reusable components do not hardcode levels. Overlays define focus entry, containment when appropriate, escape/close and focus restoration. Sticky content cannot obscure focused controls. Essential actions cannot be hover-only. Visible focus stays or is replaced with an equivalent-or-better treatment.

Post-render checks: keyboard reach/logical order · focus-visible · labels and accessible names · text/non-text contrast against **actual** backgrounds · non-color state communication · error association/recovery · reading order · zoom/reflow · reduced motion · async announcements · touch usability · overlay escape/back.

## Dynamic media and material

- Text over video/shader/3D/glass is tested at brightest, darkest and noisiest representative frames. Use a robust backing/scrim or relocate text; a single sampled color is not evidence.
- Content-bearing video provides controls and captions/transcript as appropriate. Ambient media carries no exclusive information, never autoplays audio and has a meaningful static state.
- Reduced motion disables or replaces non-essential parallax, auto-pan/orbit, scroll scrubbing, continuous shader drift and background autoplay while retaining state meaning.
- Reduced transparency gets an authored opaque/high-contrast material. Loss of backdrop-filter or WebGL cannot erase boundaries.
- Essential 3D/canvas information has DOM semantics/equivalent content and operable controls. Pointer-only orbit, drag or hover needs keyboard/touch alternatives when the action matters.
- Flashing, high-frequency patterns and uncontrollable motion are rejected. Give people pause/stop control when moving content persists or competes with reading.

## Normative distinction

WCAG 2.2 AA SC 2.5.8 uses a 24×24 CSS px target minimum with defined exceptions; about 44px remains a common ergonomic product target, not the normative threshold. Record conformance and ergonomic targets separately.

Repeated local fixes indicate a primitive, token, material or architecture owner. Repair that layer rather than accumulating overrides.
