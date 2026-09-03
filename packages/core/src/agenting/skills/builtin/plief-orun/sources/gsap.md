# GSAP

**Type:** animation engine, plugin ecosystem\
**Verification:** `VERIFIED_CURRENT` / `HIGH`\
**Last verified:** 2026-08-26

## Canonical profile

- Official source: `https://gsap.com/`
- Documentation: `https://gsap.com/docs/v3/`
- Repository: `None`
- Package: `gsap`
- Registry: `None`
- CLI: `None`
- Current version: `None`
- Installation model: `npm/CDN; plugins imported as needed`
- Free/paid: `all plugins available on npm according to current official install docs`
- License: `None`
- Framework support: `browser JavaScript, React via @gsap/react/useGSAP`
- Styling: `UNVERIFIED`

## Operational notes

- Official install docs state all plugins are freely available on npm and advise GSAP 3.13+.
- Register plugins when required; never load every plugin by default.


## Plugin resolver
Never pin a frozen plugin list as eternal truth. Query current official plugin docs before
a plugin-sensitive implementation.

Current official docs expose families including Scroll, SVG, UI/interaction, physics,
easing/ecosystem and React integration. Load and register only the plugins actually used.


## JIT triggers

Re-verify before:
- installation commands or exact slugs;
- imports/APIs/props not present in the local verified item;
- version-specific behavior;
- commercial/premium use when terms matter;
- claims that conflict with the current official source.

## Evidence

- `official docs` — Install gsap from npm; all plugins available on npm; legacy private repo no longer maintained. — https://gsap.com/docs/v3/Installation/
- `official docs` — Current plugin catalog and registerPlugin guidance. — https://gsap.com/docs/v3/Plugins/
