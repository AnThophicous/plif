# Implementation — stack-native integration

Operate inside the EXISTING codebase; repository-native integration beats convenience rewrites.

## Before changing anything (Cartographer-fed)

detect stack/runtime · architecture · styling system · component system · state management conventions · router/build system · existing patterns · relevant tests · constraints. Consume `.plif/artifacts/repository-map.json` when fresh; regenerate via `python _kernel/cartographer/cartography.py <root> --out .plif/artifacts/repository-map.json` otherwise.

## Stack-specific behavior

- Framework idioms win over generic solutions: do not replace a stack because another is easier to generate.
- State architecture smallest-correct-model: local transient / form / URL-navigation / server / shared-app / persisted / derived; keep state near its owner; no duplicated derivable state; URL-driven shareable state; explicit async ordering protection (stale closures, duplicate submission, races, stale responses, resurrection).
- Component creation must buy reusable behavior/domain semantics/state ownership/identity/testability/cognitive simplification — avoid monoliths AND renaming wrappers. Semantic variant APIs (`intent density state`) over style-prop explosions.
- Existing design-system policy lives in design-system module; parallel local visual language rejected.

## Surface pressure quick reference

marketing/landing → identity + narrative + conversion hierarchy; product-app → persistent context + scan speed + fluency; dashboard/analytics → questions before tiles, protect comparison/trend/filter/empty-error semantics; tables/enterprise → alignment/sort/bulk/keyboard/sticky/overflow ownership; forms/onboarding → sequence/recovery/completion clarity/mobile keyboard; media → readability+controls+budget; print/paged → physical units, pagination logic; email → table layouts/no modern-CSS assumptions; slide-web-composition → fixed stage, one idea per viewport.

## Copy as interface

When video, 3D, shader, canvas or an art-directed asset set materially carries the surface, read `media-spatial.md` before implementation and create `media_contracts[]`. A heavy effect cannot be smuggled in as a background CSS detail.

For public/crawlable surfaces, implement discoverability in the host framework: specific title and description, one page-level h1 with logical headings, semantic landmarks, canonical/social metadata when the product supplies authoritative values, and structured data only when truthful and relevant. Internal tools do not receive SEO ceremony merely because they render HTML.

Content is architecture: specific realistic domain copy over generic AI marketing ("Unlock your potential"/"Seamless experience" banned). Empty/loading/error/long-content states are designed surfaces. Anti-ai-slop skill governs authored strings; never invent real-company logos/testimonials/metrics.

Icons/SVG/assets: precedence project set > platform-native (platform-locked products) > one coherent library > custom SVG for brand/diagram/bespoke needs (viewBox hygiene, currentColor semantics, aria-hidden for decoration); imagery justified by function (explanation/evidence/identity/story/atmosphere/navigation/data), consistent art direction, dimensions to avoid shift, responsive sources, alt text where informative.

Library demos are raw material. Preserve the useful mechanism, then replace their copy, tokens, geometry, typography, motion timing and states with the product contracts. Do not let Magic UI, Paper Shaders, shadcn or any provider become visible as a second design language.
