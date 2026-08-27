# Pre-mortem (R2/R3 mandatory)

Premise: "this decision failed six months from now."

Rules:
1. Failure modes MUST be context-specific (name the exact component/data flow/boundary that rots) — generic checklists ("we lacked tests") are an eval failure (GAL-08).
2. For each plausible failure: earliest observable signal · blast radius guess (ordinal) · cheapest hedge now vs monitoring trigger later.
3. Link each failure mode node to its assumption/constraint via CONTRADICTS/MITIGATES so FALSIFIED assumptions mechanically surface which pre-mortem modes activated.
4. Cap at the five failure modes with highest impact×likelihood ordinals; depth over breadth.
