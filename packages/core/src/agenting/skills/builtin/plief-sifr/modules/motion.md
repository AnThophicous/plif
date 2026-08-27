# Motion — MotionContract & engine boundaries

Motion communicates causality, continuity, hierarchy, feedback, spatial relationship.

Contract content (IR motion section): categories used (state feedback / spatial transition / entrance-exit / progress / attention), duration ranges proportional to distance-importance (~100–250ms small-state starting range; larger spatial transitions may take longer), easing character, interruption behavior, reduced-motion equivalents, transform/opacity preference for common motion.

Laws:

1. Feedback arrives at the speed the action expects — decorative motion must never increase perceived latency or conceal slow work.
2. Reduced-motion honored everywhere; non-essential decorative animation disabled under it, essential meaning preserved via non-motion channels.
3. Frequent actions stay fast; a designer flourish cannot slow frequent work.
4. Decorative motion gets budget ONLY after interaction responsiveness is protected (budget lives in perf_budget.animation_cap_ms).
5. Engine choice (CSS vs React-state-driven vs timeline lib vs asset-based vs 3D runtime) routes through Orun knowledge/rules (animation conflict rule: two engines driving one interaction need compelling reason) — this module owns CHARACTER and CONTRACTS, not vendor facts.
6. The one orchestrated moment beats scattered micro-animations; layout-property animation reads cheap — animate transform/opacity.
