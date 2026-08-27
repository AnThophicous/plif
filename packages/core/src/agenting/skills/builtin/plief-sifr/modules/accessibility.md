# Accessibility — construction constraints (canonical a11y rules)

Accessibility enters contracts (`accessibility_contract`), not final polish.

## Construction rules

Prefer native semantics before ARIA; no ARIA duplicating native behavior. Landmarks + heading hierarchy belong to page context (reusable components don't hardcode levels). Overlays: deliberate focus entry, containment where appropriate, escape/close, focus restoration; sticky content must not obscure focused controls; hover-only is insufficient for essential actions; visible focus retained or replaced with equivalent-or-better treatment.

## Contract fields verified post-render

keyboard reachability & logical order · focus-visible styling · labels/persistent labels & accessible names · contrast (text, non-text, against REAL backgrounds incl. accent-on-its-surface; robust opaque fallback for translucency) · state communication never color-only · error field association · reading order · zoom/reflow · reduced motion · screen-reader announcements for important async changes · touch usability · escape/back of overlays.

## Normative distinction (single place)

WCAG 2.2 AA SC 2.5.8 = 24×24 CSS px minimum with defined exceptions; ~44px remains an ergonomic product target commonly chosen for primary touch interactions, NOT the normative threshold. Document product target separately from conformance target.

Repeated local accessibility patches signal primitive/architecture problems — fix the layer above (root-owner ACCESSIBILITY in defect classification).
