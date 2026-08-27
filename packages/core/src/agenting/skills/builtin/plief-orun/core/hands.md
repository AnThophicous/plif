# Hands — Implementation Engine

## Existing project

Default flow:

`DISCOVER → INSPECT PROJECT → VERIFY SOURCE → SELECT → INSTALL → INTEGRATE → ADAPT → TEST → VERIFY`

The order can collapse for trivial work; evidence gates cannot.

## Installation

Before adding a package or registry item:
1. confirm project package manager;
2. inspect existing equivalent dependencies;
3. verify the exact live installation mechanism;
4. inspect generated/added files after install;
5. adapt imports and aliases to the actual project;
6. preserve working configuration.

Do not “fix” compilation by installing random packages.

## shadcn-style registries

Inspect `components.json`, aliases, RSC mode, TS/JS and Tailwind state.
Resolve the registry entry itself before generating an `add` command.
After installation inspect `dependencies`, `registryDependencies`, files and client boundaries.

## Design-system adaptation

Map external styling to local:
- semantic colors
- typography
- radii
- spacing
- borders
- shadows
- breakpoints
- motion tokens

Preserve behavior before refactoring visuals.

## Animation implementation

Route through `rules/animation-routing.md`.
Cleanup listeners/timers/observers/animation contexts.
Provide reduced-motion behavior where motion is non-essential.

## 3D implementation

Require a real 3D need.
Define loading strategy, fallback, DPR/resolution budget, render-loop lifecycle,
asset cleanup/disposal, touch behavior and offscreen pausing before polish.

## Failure recovery

`FAILURE → CLASSIFY → EVIDENCE → UPDATE MODEL → MINIMAL NEW STRATEGY → RETEST`

Do not replace the whole library or component until the failure has a causal explanation.
