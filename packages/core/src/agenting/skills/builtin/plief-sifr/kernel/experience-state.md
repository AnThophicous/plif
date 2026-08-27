# ExperienceIR — lifecycle and ownership

The ExperienceIR is Sifr's shared working memory. Everything another phase (or the next session) must inherit lives here.

## Path & versioning

`.plif/artifacts/<surface-id>/experience-ir.json` — siblings:
- `design-dna.json` (written by VISUALIZE/SYSTEMIZE, consumed everywhere)
- `defect-report.json` (REPAIR/VERIFY output)
- `selection-query.json` / `selection-record.json` (component intelligence ↔ Orun)

## Phase writes

| Mode | Sections written |
|---|---|
| DISCOVER | product_frame, user_jobs, constraints, existing_system, invariants |
| STRUCTURE | information_architecture (nav model, obligations, hierarchy), responsive regions skeleton |
| VISUALIZE | visual grammar file + design_dna ref |
| SYSTEMIZE | design-system mapping inside existing_system + DNA materialization notes |
| BUILD | component_graph, interaction_graph, motion, responsive_contract fills, perf_budget, accessibility_contract, orun_selections |
| REPAIR/VERIFY | verification_state.rendered_matrix + defect records; owners resolved |

## Rules

1. Incremental: write early, refine often. Never keep settled decisions only in chat memory.
2. Sections correspond to consumer modules — see `kernel/handoffs.md`.
3. Before building from an IR older than the last repo mutation, revalidate (`engines/ir_validate.py --in <file>`) and refresh `existing_system.stack_ref` if the Cartographer fingerprint changed.
4. `verification_state.gap_ledger` inherits the prototype gap semantics: real-now vs simulated vs still-required-for-production (never mark simulated boundaries production-ready).
5. Validate after each phase that writes it. Invalid IR blocks progression rather than being silently trusted.
