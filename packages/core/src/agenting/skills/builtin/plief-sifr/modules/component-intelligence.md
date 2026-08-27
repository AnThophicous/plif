# Component Intelligence — selection, transplant, switching

## Order of evaluation (strict)

`PROJECT-NATIVE > ORUN > ADAPT > COMPOSE > BUILD`

Before external anything: inspect existing primitives, unused/adjacent components, team registry, already-installed provider components. External search only when it can materially improve behavior/accessibility/quality/speed/maintainability/distinctiveness. Provider search as ritual is a failure. When external search is warranted, emit `selection-query.json` per Orun QueryContract (`../adapters/orun-selection.template.json`) — include perf budget + dependency constraints + `already_searched_native:true`. Orun ranks; SIFR decides and records SelectionRecord with materiality gate (TRIVIAL = one-liner record; full record required at R2+).

## Slot DNA before ranking

Structural (container/full-bleed, stacking, sticky semantics, regions, density) · Behavioral (routes, auth/session, menus/search, keyboard, scroll, analytics flags, state ownership) · Visual (typography voice, spacing rhythm, surfaces/radius/border, icon family, material/motion character) · Product (job, expertise, frequency, consequence, conversion). Classify every property: preserve | adapt | opportunity | forbidden-regression.

## Hard gates BEFORE aesthetic ranking

Stack (framework/runtime/version, SSR/RSC/client boundary, TS, styling assumptions, path aliases) · Dependencies (peers, animation runtime, icons, CSS/keyframes, bundle cost) · Behavior (routes/state/auth/mobile transformations/loading/error) · Accessibility repairability (reject unrepairable core nav/focus/dialog semantics; hover-only essential actions rejected) · Provenance/security (opaque source, unexpected scripts/network, unrelated file mutations → reject/isolate/approval) · Integration risk (framework migration/global CSS corruption/state rewrite/second design system → reject). A visually perfect incompatible candidate loses to ranking rules by definition — gates run first.

## Transplant protocol

Transplant invariant string written INTO the component's IR record (`component.source=transplant:<record-id>`): what signature must survive (e.g. "compact asymmetric nav/CTA tension + instant mobile command-sheet transition"). Replace demo content/routes/CTA/analytics placeholders with real ones; reconnect routing/auth/locale/theme/state ownership/map styling into host tokens/radius/borders/icons/motion; repair accessibility semantics/focus/keyboard BEFORE visual polish; remove runtime cost that pays nothing.
Shader/WebGL candidates: product value justification, GPU/runtime cost estimate, mobile fallback, text readability, reduced motion, hydration/server-boundary correctness, non-WebGL fallback requirement.
Interaction-heavy candidates (command palettes, predictive search, mega-menus, drag/drop): state-machine modeling + prototype-first when uncertainty is meaningful; appearance alone cannot validate them.
Header/nav swaps: full behavior map (home/logo action, nav source, active route, primary CTA, account/auth, locale/theme switchers, mobile navigation model, sticky offsets, scroll behavior, overlay focus, z-index, keyboard path); preserve public header API where practical; adapter for prop-shape differences instead of leaking provider API app-wide; verify desktop/narrow/intermediate/active-route/auth/sticky-offset/keyboard+escape+focus-restore/build.

## Switching & failure

Stable candidate IDs are session CONTRACTS read from artifacts: "H2 without glass" modifies along that dimension preserving identity; "back to H1" switches from stored session info WITHOUT destructive git reset and re-verifies affected surface.
Failure routing: candidate breaks behavior→identify missing contract/adapt narrowly/reject; dependency storm→cheaper candidate or strip effects; mobile repeatedly fails while desktop fine→structural responsive revisit not more patches; provider outage→one meaningful retry then alternate/native path; bridge offline→downloaded capsule/manual import; preview-without-source→preview is EVIDENCE only, acquire authorized source or implement natively; build fails post-install→classify stack/dep/import/CSS mismatch, revert unsafe partials, change strategy — never blind reinstall loops.

Capsule trust model (`adapters/CAPTURE_BRIDGE.md`): validate schema, separate preview.dom from registry/source snapshot, honor handoff.doNotAutoInstall, hard-gate anyway; browser DOM ≠ framework source.
