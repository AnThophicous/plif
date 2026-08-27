# Visual Forensics — reference → grammar → principles → original implementation

Goal: extract GRAMMAR from screenshots, sites, UI panels, renders, multi-viewport references. Never clone logos/brand assets/proprietary copy/accidental defects.

## INPUT / STATE

References (image/url/surface). Intermediary `.plif/artifacts/<id>/visual-grammar.json`:

```text
layout_laws        grid behavior, container strategy, alignment system, negative space
vertical_rhythm    base interval, section cadence
type_hierarchy     role→(size ratio, weight ladder, tracking)
density            information-per-container readout
visual_weight      luminance/size/color distribution logic
color_relationships dominance/accent ratio, temperature, semantic usage
radius_logic       hierarchy or near-zero rule + where pills belong
border_set         separators, outlines, emphasis edges
elevation_signals  what earns depth; channels used (luminance|shadow|blur|scale)
component_families detected families with structure notes
motion_language    visible transition character hints
interaction_hints  hover reveals, affordances, scroll behavior
responsive_transformations  when multi-viewport evidence available
signature_composition  the one memorable move
```

## ALGORITHM

1. [JUDGMENT] perceptual identification of laws is yours; support it mechanically: for reachable web targets measure real numbers (column widths, gaps, font-size ratios) using image.inspect/browser capabilities.
2. Inferred approximations are recorded as intervals INFERRED, never verbatim invention; low-quality/partial sources lower confidence and require confirmation at R2 before DNA freeze.
3. Map grammar → DesignDNA draft (`schemas/design-dna.schema.json`) without stylistic labels ("premium dark minimal") — laws only.

## OUTPUT / HANDOFF

grammar file + DNA draft + non-clonable checklist (brand marks, proprietary assets, protected text, illegible-with-fix defects).

## FAILURE

Unmeasurable/degraded input → mark rows ASSUMED with explicit visual confidence; do not silently present guesses as observed laws.
