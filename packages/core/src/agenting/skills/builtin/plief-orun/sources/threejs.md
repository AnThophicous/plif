# Three.js

**Type:** 3D engine\
**Verification:** `VERIFIED_CURRENT` / `HIGH`\
**Last verified:** 2026-08-26

## Canonical profile

- Official source: `https://threejs.org/`
- Documentation: `https://threejs.org/docs/`
- Repository: `None`
- Package: `three`
- Registry: `None`
- CLI: `None`
- Current version: `None`
- Installation model: `npm/module or official distribution`
- Free/paid: `open source`
- License: `None`
- Framework support: `browser JavaScript`
- Styling: `UNVERIFIED`

## Operational notes

- Three.js requires explicit disposal of many GPU resources; removing a mesh is not disposal.
- Responsive rendering must manage drawing-buffer size and camera aspect; do not blindly use maximum device DPR for heavy scenes.


## Performance/lifecycle
Removing an object from the scene does not free its geometry/material/texture resources.
Disposal is application responsibility. Responsive canvas work must update camera projection
and drawing-buffer sizing deliberately.


## JIT triggers

Re-verify before:
- installation commands or exact slugs;
- imports/APIs/props not present in the local verified item;
- version-specific behavior;
- commercial/premium use when terms matter;
- claims that conflict with the current official source.

## Evidence

- `official docs` — Current core API catalog includes Object3D, BufferGeometry, Raycaster, cameras, animation, etc. — https://threejs.org/docs/
- `official manual` — Geometries/materials/textures and other resources require explicit disposal. — https://threejs.org/manual/en/how-to-dispose-of-objects.html
- `official manual` — Responsive canvas/camera sizing and pixel-ratio considerations. — https://threejs.org/manual/en/responsive.html
