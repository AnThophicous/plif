# Assumption Ledger

File: `.plif/artifacts/<task-id>/assumptions.jsonl`.

## Kinds and their hard requirements (lint-enforced)

| kind | requirements |
|---|---|
| FACT | provenance/source REQUIRED (Evidence Ledger or artifact reference); unproven "facts" are errors |
| INFERENCE | dependencies[] + note on what would flip it |
| ASSUMPTION | how_to_verify + impact_if_false REQUIRED |
| PREFERENCE | may never be cited via CONSTRAINS edges by any recommendation (lint) |
| CONSTRAINT | external authority named |
| UNKNOWN | needs open question entry |

Common fields: `{id, kind, statement, confidence(low|med|high), depends_on[], state(OPEN|VERIFIED|FALSIFIED|SUPERSEDED), how_to_verify?, impact_if_false?(minor|material|critical), source}`.

## Behavior

1. Before accepting an ASSUMPTION into a SETTLED path, attempt the cheapest verification.
2. FALSIFIED assumptions trigger partial reopen (contradiction engine / reopen.py).
3. IMPACT ranking drives question priority (core/questions.md).
4. Preference-disguised-as-fact ("lorem ranks better for SEO" style claims) get classified PREFERENCE with a one-line why — GAL-05 behavior is normative, not stylistic.
