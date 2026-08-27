# Artifact conventions — canonical state store

Durable task state lives inside the TARGET workspace at `.plif/artifacts/<task-id>/`. Conversation memory is explicitly NOT authoritative for anything representable here.

## Registry

| Artifact | Producer(s) | Consumer(s) | Validator |
|---|---|---|---|
| capabilities.json | any flagship session | all | informal enum check |
| repository-map.json | Cartographer | all | cartography.py --selftest contract |
| evidence.jsonl | all | all | evidence/validate_ledger.py |
| experience-ir.json | Sifr | Sifr, Galileu | sifr engines/ir_validate.py |
| design-dna.json | Sifr visual-direction | Sifr impl/verification, Orun query | sifr ir_validate --dna |
| selection-query.json / selection-record.json | consumer / consumer+Orun | Orun, Galileu, docs | orun scripts/validate_query_contract.py |
| decision-graph.json, assumptions.jsonl, decision-record.json | Galileu | all flagships | galileu tools/galileu_lint.py + reopen.py |
| security-ir.json, findings.jsonl, security-diff.json | Argus | Argus, deep-review, release gate | argus tools/* |
| change-impact.json | Change Impact Engine | deep-review, Argus SecDiff, Sifr | _kernel/change-impact schema subset via tool |

## Rules

- Every artifact carries `"schema_version"`.
- Producers declare the artifact key in their package manifest (`artifacts.produced`); consumers in `artifacts.consumed`. Conformance checks these declarations reference real validators where applicable.
- Stale handling: artifacts that depend on repository state record a fingerprint basis; consumers recheck cheaply or rebuild rather than trusting stale data.
- Redaction obligation applies to artifact writes too: obvious secret material is redacted as `<REDACTED_SECRET>`.
- No artifact without a named consumer somewhere in this registry (anti JSON-theater).
