# Debug

`SYMPTOM → HYPOTHESES → EVIDENCE → TEST → ROOT CAUSE → MINIMAL FIX → REGRESSION TEST`

Frontend-specific suspects:
- state ownership
- stale closure/event ordering
- client/server boundary
- hydration
- CSS stacking/layout/overflow
- duplicate animation controllers
- resize/observer loops
- missing cleanup
- registry dependency drift
- stale API or component slug

Do not switch libraries until the failure class justifies it.
