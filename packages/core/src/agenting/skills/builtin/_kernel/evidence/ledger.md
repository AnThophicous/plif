# Evidence Ledger — canonical evidence states

One place defines what a claim can be. Every flagship and every report uses this vocabulary verbatim; no local redefinitions.

## States

```text
VERIFIED     directly observed/tested/executed; requires verification_method
INFERRED     supported by code/config/history evidence but not directly executed
ASSUMED      plausible claim accepted provisionally; must carry impact_if_false at consumer level
UNKNOWN      no usable evidence either way
CONTRADICTED two usable sources disagree; keep both sides, record conflict
STALE        once-valid claim whose basis changed (see stale_if below)
```

Never upgrade a state implicitly. Absence of evidence is UNKNOWN, never positive.

## Record format (`record.schema.json`)

Required fields: `id, claim, state, provenance[{kind,ref}], captured_at`.
Provenance kinds: `code | config | test | runtime | web | user | model-inference | artifact`.
`verification_method` is mandatory when `state == VERIFIED`.
Optional: `contradicts[]` (other record ids), `stale_if[]` (change conditions, e.g. `"sha:src/auth/session.ts"`), `note`.

Store: `.plif/artifacts/<task-id>/evidence.jsonl` (one JSON object per line).

## Rules machines enforce (validate_ledger.py)

1. enums and required fields;
2. `VERIFIED` without method → ERROR;
3. duplicated ids → ERROR;
4. contradiction asymmetry (A lists B, B does not list A) → ERROR;
5. `CONTRADICTED` with empty `contradicts` → ERROR.

Rules models obey: a factual statement in any report needs a ledger entry somewhere in the task; downgrades propagate (`STALE` consumer claim → mark dependents UNKNOWN, re-evaluate).
