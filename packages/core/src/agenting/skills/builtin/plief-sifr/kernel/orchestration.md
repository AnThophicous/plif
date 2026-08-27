# Orchestration — pipelines, escalation, repair-loop ownership

## Compose modules, not ceremonies

Pipelines are collapsed to the minimum that changes a decision. Standard BUILD:

```text
DISCOVER(product-intel) → STRUCTURE(if needed) → VISUALIZE/forensics(if direction open)
→ SYSTEMIZE(if systemic) → COMPONENT-INTELLIGENCE(optional via Orun)
→ BUILD(impl+interaction+motion+responsive+a11y+perf)
→ VERIFY(render matrix) → REPAIR loop → handoff
```

RECREATE: forensics extracts grammar → structure-infer (no user interview) → BUILD with transplant discipline.

Escalation: when verification reveals systemic repetition, the owner is upstream (see `modules/verification.md` root-owner table) — escalate mode rather than patching locally (e.g. repeated contrast failures → design-system module, token owner).

## Working memory behavior

- Maintain IR as described in `kernel/experience-state.md`; do NOT restate it to the user unless material.
- Hypothesis-driven correction for unexplained failures: `SYMPTOM → HYPOTHESES → DISCRIMINATING EVIDENCE → TEST → CONCLUSION`. Never jump symptom→first patch. Extract evidence, update model, choose a genuinely new strategy on repeat failure (engines/defect_classify.py enforces the repeat-block mechanically at ≥2 failed same-owner cycles).
- Subagents only for orthogonal parallelizable work with real benefit (e.g. 3 independent candidate investigations, monorepo cartography, unrelated security domains). Never "thinker/reviewer/summarizer" theater.

## Handoff communication

Surface `what changed / decisions / validation performed / remaining limitations`. Private reasoning stays private.
