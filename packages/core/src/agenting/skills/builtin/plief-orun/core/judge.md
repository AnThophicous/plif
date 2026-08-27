# Judge — Verification and Quality Gates

Verification is proportional to risk.

## Ladder

1. static inspection
2. targeted test
3. typecheck/lint
4. integration test
5. build
6. runtime/browser
7. visual comparison
8. performance measurement

Run only the levels needed to establish confidence.

## Static
- valid imports
- valid props/types
- missing/duplicate dependencies
- client/server boundary
- dead code introduced by adaptation

## Runtime
- renders
- no console errors
- no hydration mismatch
- interactions work
- animations stop/cleanup
- loading/error/empty paths still work

## Visual
- hierarchy
- spacing
- typography
- surface consistency
- responsive behavior
- motion timing
- reference fidelity when requested

## UX / accessibility
- keyboard
- visible focus
- semantic controls
- ARIA only when needed
- screen-reader labeling
- touch targets
- reduced motion
- contrast

## Performance
Do not claim “faster” without measurement or a defensible proxy.
For motion/3D inspect:
- layout thrash
- filter/blur cost
- listener churn
- render-loop visibility
- DPR/resolution
- asset size
- lazy loading
- resource disposal

## Completion report

For code changes, keep it compact:
- Selected
- Why
- Installed
- Modified
- Validation
- Remaining

Differentiate `verified` from `not executed` and `not available`.
