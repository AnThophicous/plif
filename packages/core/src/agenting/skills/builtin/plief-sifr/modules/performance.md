# Performance — budgets before implementation

Perf budget lives in IR `perf_budget` BEFORE candidates/implementations:

```text
initial_js_kb · animation_cap_ms · image_strategy · font_budget/strategy ·
third_party_kb · hydration concerns (sensitive elements) · LCP-sensitive elements ·
interaction latency concerns
```

## Orun integration

`selection-query.json.performance_budget` carries these numbers so ranking respects them pre-install; a candidate violating budget needs explicit tradeoff justification in its SelectionRecord. Component intelligence bundles-cost gate reads the same budget.

## Implementation guidance

Identify likely contributor before optimizing (render frequency, reconciliation, list size, layout thrash, images decode/resize/dimensions, fonts loading, network waterfalls, JS bundle, hydration boundaries, expensive filters/backdrop blur, main-thread animation, repeated event work). Measure when tools exist; otherwise defensible proxies marked INFERRED in the ledger. High-value protections: correct media sizing/stable dimensions, targeted lazy loading, minimal client JS, avoiding unnecessary client boundaries and huge filtered regions, virtualization only for genuinely large lists, memoization only for observed/reasoned cost, progressive enhancement for expensive effects.

3D/WebGL/shaders follow component-intelligence heavy-effect gates plus: DPR/resource lifecycle, render-loop visibility offscreen pausing, asset disposal.

Do not claim speedups without measurement; do not micro-optimize speculatively at maintainability's expense; perf regressions surfaced in VERIFY become PERFORMANCE-owner defects.
