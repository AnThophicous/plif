# Integration Contract - Orun -> consumers (Sifr et al.)

Formal resolution of the historical component-discovery overlap between Orun and the consuming flagships:
1. **Knowledge of WHERE resources live** = Orun (catalogs/indexes/freshness/verification ladders).
2. **Skill of HOW to integrate/transplant** = consuming flagship (Sifr component-intelligence transplant protocol).
3. Provider capability notes that duplicated this knowledge were archived with the legacy package; live discovery flows exclusively through the interfaces below.

## Consumer interface

A consumer emits `.plif/artifacts/<task-id>/selection-query.json` following
`schemas/selection-query.schema.json` (template shipped by consumers,
e.g. `../plief-sifr/adapters/orun-selection-query.template.json`).

Contract obligations on Orun:
- validate query before discovery (`scripts/validate_query_contract.py`);
- respect `ranking_weights_override` when present (brain scoring dimensions);
- honor hard gates BEFORE ranking (licensing / freshness / conflicts_with / provenance);
- honor `performance_budget` and `dependency_budget` as ranking HARD constraints;
- when `already_searched_native: true`, do NOT re-run project-native search;
- return top-k candidates WITH reasons; Orun RECOMMENDS, never approves;
- never auto-install anything; install mechanics belong to consumer's Hands flow.

## Decision record backflow

Consumer writes `selection-record.json` (`schemas/selection-record.schema.json`):
materiality TRIVIAL collapses to one-liner; MATERIAL/R2+ requires why_selected,
why_rejected[], adaptation_required, dependencies_introduced, risk, freshness,
compatibility, evidence[]. Rejected selections feed Galileu reopen hooks.

## Unavailability matrix

| situation | behavior |
|---|---|
| claim stale + WEB available | verify live before use |
| claim stale + NO web | decision proceeds with UNVERIFIED flag; installs with STALE/UNVERIFIED facts are FORBIDDEN |
| catalogs absent | consumer degrades to PROJECT-NATIVE/ADAPT/BUILD and marks external discovery PENDING |
