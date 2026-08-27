# Responsive — behavioral constraint engine

Never "desktop / tablet / mobile", never "desktop stacked vertically".

## IR `responsive_contract.regions[]` semantics

```text
INVARIANT types: keep | compress | reflow | reorder | hide | disclose |
                 stack | transform-control | change-density | swap-input-mode
region record:  { region, wide:"...", mid_1024:"...", mid_768:"...",
                  narrow_390:"...", verify_at:[...], ownership:"..." }
```
`ownership` names intentional overflow owners: page-level horizontal scroll is a defect EXCEPT inside data regions owning it deliberately to preserve comparison. Breakpoints appear where composition/interaction fails, not at popular device widths.

## Contract → matrix (mechanism)

`engines/matrix_expand.py` turns the contract into the REPRESENTATIVE render matrix:
{min supported width, every width where composition changes, desktop cap} × {populated, one high-risk state, long-content} (+zoom/touch/reduced-motion where declared). Non-Cartesian; coverage gaps vs contract are machine-detected and repair-block verification exit.

## Mid-width promises enforced

A region promising `mid_768 == mid_1024` MUST hold at 768 — SIFR-B06 regression case exists exactly for this. "Works at 1440 & 390 but breaks 768" is an owner=RESPONSIVE/STRUCTURE failure, fixed at the contract level, never by piling breakpoint patches.

## Mobile specifics inspected when relevant

safe areas · keyboard overlap · bottom/sticky actions · thumb reach · table adaptation (transform-control) · modal/sheet sizing · touch targets (ergonomic target may exceed WCAG normative minimum — WCAG nuance canonical in accessibility module) · long labels.
