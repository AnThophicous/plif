# Project Inspection

Inspect only what affects the task.

## Frontend baseline
- package.json / lockfile
- framework config
- tsconfig/jsconfig
- Tailwind configuration or CSS entry
- shadcn components.json
- component aliases
- theme/tokens
- installed UI/motion/3D dependencies
- relevant feature entry points

## Change-risk expansion
If changing shared primitives, also find consumers.
If changing animation runtime, find existing engines and global providers.
If adding 3D, locate route/layout boundaries and lifecycle ownership.
If migrating a registry component, diff local modifications before overwrite.

Treat existing behavior the user did not ask to change as an invariant.
