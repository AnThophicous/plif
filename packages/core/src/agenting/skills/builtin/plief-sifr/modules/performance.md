# Performance — budgets before effects and dependencies

Write `perf_budget` in ExperienceIR before candidate selection or heavy implementation. Use only relevant fields from `schemas/perf-budget.schema.json`:

```text
initial_js_kb · third_party_kb · media_initial_kb · animation_cap_ms ·
gpu_frame_ms · max_dpr · image/video/font strategy · hydration-sensitive/LCP
elements · interaction-latency concerns · offscreen-pause requirement
```

Budgets express a product constraint, not an invented universal threshold. Use measured baseline/targets when available; otherwise label defensible proxies INFERRED and say which device/network class they assume.

## Selection and construction

`selection-query.json.performance_budget` carries the same numbers so Orun and component intelligence can reject incompatible candidates before install. A library preview never waives dependency, hydration, media or GPU cost.

Identify likely owners before optimizing: render/reconciliation frequency, list size, layout thrash, images decode/resize/dimensions, video download/decode, font loading, network waterfalls, JS and client boundaries, hydration, filter/backdrop regions, shader fill rate/DPR, 3D geometry/textures, main-thread animation and repeated listeners.

High-value protections:

- reserve media dimensions and serve appropriate sizes; do not lazy-load actual LCP media, but defer below-fold assets;
- use posters and explicit preload policy for video; hidden autoplay loops do not download or run indefinitely;
- minimize client JS and third-party runtimes; one effect should not introduce a second animation stack without a recorded reason;
- animate transform/opacity when suitable; avoid per-frame layout reads/writes and unbounded blur/filter regions;
- pause video, canvas and render loops when offscreen/hidden; cap DPR by observed value; dispose GPU/media resources and observers;
- progressively enhance heavy material/spatial effects so the fallback remains a designed surface;
- virtualize only genuinely large lists and memoize only observed/reasoned cost.

For shaders/3D, inspect frame time at representative wide/narrow sizes and at the highest allowed DPR; exercise resize, tab visibility, navigation away/back and context loss/fallback. A still screenshot cannot verify GPU behavior.

Do not claim speedups without before/after evidence. Do not micro-optimize at maintainability's expense. Regressions found in VERIFY become PERFORMANCE-owner defects and re-open the upstream medium/library decision when local tuning cannot satisfy the budget.
