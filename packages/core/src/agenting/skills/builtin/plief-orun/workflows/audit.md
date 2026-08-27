# Audit / Optimize

Explicit AUDIT or OPTIMIZE widens refactor scope.

Inspect:
- duplicate UI abstractions
- duplicated animation engines
- hard-coded motion timings/easings
- layout-thrashing effects
- missing reduced motion
- inaccessible custom controls
- dead registry components
- stale external APIs
- unnecessary bundle/runtime dependencies
- 3D loops/assets that stay alive offscreen
- design-token drift

Prioritize by user impact × evidence × fix leverage.
Measure before/after when claiming performance improvement.
