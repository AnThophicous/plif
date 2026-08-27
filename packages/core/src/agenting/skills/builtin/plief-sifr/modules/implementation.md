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

Content is architecture: specific realistic domain copy over generic AI marketing ("Unlock your potential"/"Seamless experience" banned). Empty/loading/error/long-content states are designed surfaces. Anti-ai-slop skill governs authored strings; never invent real-company logos/testimonials/metrics.

Icons/SVG/assets: precedence project set > platform-native (platform-locked products) > one coherent library > custom SVG for brand/diagram/bespoke needs (viewBox hygiene, currentColor semantics, aria-hidden for decoration); imagery justified by function (explanation/evidence/identity/story/atmosphere/navigation/data), consistent art direction, dimensions to avoid shift, responsive sources, alt text where informative.
