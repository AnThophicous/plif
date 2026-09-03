# Rive

**Type:** animation asset format, runtime ecosystem, state-machine animation system\
**Verification:** `VERIFIED_CURRENT` / `HIGH`\
**Last verified:** 2026-08-26

## Canonical profile

- Official source: `https://rive.app/`
- Documentation: `https://rive.app/docs/runtimes/getting-started`
- Repository: `None`
- Package: `@rive-app/* runtime packages`
- Registry: `None`
- CLI: `None`
- Current version: `None`
- Installation model: `runtime package + .riv asset`
- Free/paid: `runtime open source; editor/assets may have plan constraints`
- License: `runtime libraries are open source; asset/project licensing separate`
- Framework support: `Web, React, React Native, Apple, Android, Flutter, Unity, Unreal`
- Styling: `UNVERIFIED`

## Operational notes

- Recommended React option in current docs is @rive-app/react-webgl2 for advanced renderer features; canvas variants exist.
- Canvas size/lifecycle/WASM/network weight are material performance concerns.



## JIT triggers

Re-verify before:
- installation commands or exact slugs;
- imports/APIs/props not present in the local verified item;
- version-specific behavior;
- commercial/premium use when terms matter;
- claims that conflict with the current official source.

## Evidence

- `official docs` — React runtime options, useRive hook, WebGL2 recommendation. — https://rive.app/docs/runtimes/react/react
- `official docs` — Runtime size guidance and renderer tradeoffs. — https://rive.app/docs/runtimes/runtime-sizes
