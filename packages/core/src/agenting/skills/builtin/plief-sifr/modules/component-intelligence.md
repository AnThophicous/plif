# Component Intelligence — selection, transplant, switching

## Order of evaluation

`PROJECT-NATIVE > ORUN > ADAPT > COMPOSE > BUILD`

Inspect existing primitives, unused/adjacent components, team registry and installed providers first. Search externally only when it can materially improve behavior, accessibility, quality, speed, maintainability or the chosen signature. Provider search as ritual is a failure.

When external search is warranted, fill `../adapters/orun-selection-query.template.json` and write `selection-query.json`: include performance/dependency budgets, visual DNA reference and `already_searched_native:true`. Orun ranks; Sifr decides and records `selection-record.json` from `../adapters/orun-selection-record.template.json`. TRIVIAL decisions collapse to a one-line reason; dependency, structural or heavy-media changes require the full record.

## Slot DNA before ranking

Structural (regions, stacking, sticky/overflow semantics, density) · behavioral (routes, auth/session, search/menu, keyboard, state/scroll ownership) · visual (type, rhythm, surfaces, icons, material, motion) · product (job, expertise, frequency, consequence, conversion). Mark each property `preserve | adapt | opportunity | forbidden-regression`.

## Hard gates before aesthetic ranking

- stack: framework/runtime/version, SSR/RSC/client boundaries, TypeScript, styling assumptions, aliases;
- dependencies: peers, animation engines, icon/CSS/global side effects, package/source size;
- behavior: routes, state/auth, loading/error, responsive transformations;
- accessibility repairability: reject unrepairable navigation/focus/dialog semantics and essential hover-only actions;
- provenance/security/license: opaque source, unexpected scripts/network or unrelated mutations -> reject/isolate/seek authorization;
- integration: framework migration, global CSS corruption, state rewrite or second design system -> reject;
- performance: evaluate the same IR budget used by implementation, including GPU/media costs.

A visually attractive incompatible candidate loses before ranking.

## Named ecosystems are ingredients

- Magic UI and comparable copy/adapt collections offer bounded motion/effect mechanisms. Inspect their Tailwind/shadcn/Motion assumptions, source ownership and global styles. Transplant one useful behavior; remove demo gradients, glows, copy and typography. Do not import a gallery into the product.
- Paper Shaders and other shader sources route through `media-spatial.md`. Require a ShaderContract, verified current official docs/license/runtime, non-WebGL fallback and measured or defensible GPU budget before selection.
- Motion/GSAP/Rive/Lottie/Three/R3F are engine choices, not visual directions. Orun owns current vendor facts; the motion/media contracts own why and how they appear.

## Transplant protocol

Write the invariant into the component IR record (`source:"transplant"`, `source_record_ref:"<record-id>"`, `invariant:"<signature that must survive>"`). Replace demo content/routes/CTA/analytics; reconnect routing, auth, locale, theme, state ownership and host tokens/icons/motion. Repair semantics/focus/keyboard before polish; remove runtime cost that pays nothing. Legacy `transplant:<record-id>` records remain readable but new records use the structured fields.

Heavy effects require purpose, cost, responsive/mobile fallback, readable text, reduced-motion/transparency behavior, hydration correctness and a useful no-effect path. Interaction-heavy candidates require a state graph and prototype-first when uncertainty matters; appearance cannot validate them.

Header/nav swaps require a full behavior map: home action, nav source/active route, primary CTA, auth/account, locale/theme, mobile model, sticky/scroll offsets, overlay focus, z-index, keyboard/escape/focus restore. Preserve the public API where practical; adapt provider props behind a host-semantic wrapper.

## Switching and failure

Stable candidate IDs live in artifacts. “H2 without glass” changes that dimension while preserving its invariant; “back to H1” restores the stored candidate without destructive git operations and re-verifies affected surfaces.

On failure, classify before retry: missing behavior -> adapt narrowly or reject; dependency storm -> cheaper candidate/strip effect; repeated narrow failure -> revisit responsive structure; provider outage -> one meaningful retry then alternate/native; preview without source -> evidence only; post-install build failure -> identify stack/dependency/import/CSS mismatch, remove unsafe partials and change strategy. Never blind-reinstall.

Captured browser DOM is evidence, not framework source. Validate the capsule and honor `adapters/CAPTURE_BRIDGE.md` including `doNotAutoInstall`.
