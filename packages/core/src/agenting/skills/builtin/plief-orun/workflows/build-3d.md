# Build 3D

Use Three.js only when real 3D/WebGL value exists.

Before code:
- define scene purpose
- device targets
- fallback
- asset/loading strategy
- resolution/DPR budget
- interaction/touch
- lifecycle owner
- offscreen behavior

For image → procedural object reconstruction, inspect `sources/img2threejs.md` and follow
the staged pipeline rather than one-shot geometry.

After code:
- responsive canvas
- correct camera update
- pause/stop invisible loops when appropriate
- dispose obsolete textures/geometries/materials/render targets/controls
- verify low-end/touch fallback
