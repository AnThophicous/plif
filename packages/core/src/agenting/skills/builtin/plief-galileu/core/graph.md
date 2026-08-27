# DecisionGraph — construction rules

File: `.plif/artifacts/<task-id>/decision-graph.json` (schema in ../schemas).

## Node kinds

```text
decision      {id, question, status: OPEN|SETTLED|INVALIDATED_PENDING_REVIEW,
               single_option_reason?}
option        {id, decision, thesis, costs[], risks[]}
constraint    {id, statement}   # technical/legal/product facts limiting options
assumption    ledger id ref     (separate file, embedded ok)
evidence      {id, kind, ref_or_quote, confidence: ordinal low|med|high}
risk          {id, statement, severity_ordinal minor|material|critical}
consequence   {id, statement}
```

## Edge types (exactly these eight)

```text
DEPENDS_ON  SUPPORTS  CONTRADICTS  CONSTRAINS
INVALIDATES MITIGATES IMPLIES     SELECTS
```

Direction semantics:
- `A DEPENDS_ON B`: if B is invalidated, A requires review (propagation edge).
- `A IMPLIES B`: A's acceptance forces review of derived conclusion B when A falls.
- `A SELECTS B` (option→record) is written only at DECIDE time; never used to imply settledness of dependents.

## Rules

1. Every referenced node must exist (lint).
2. OPEN decision ⇒ ≥2 options OR explicit `single_option_reason`. Option theater without comparison value is itself a defect.
3. Edges need no narrative prose; `note` optional.
4. Ordinal confidence ONLY. Percentages/scores without a mechanical source are forbidden.
5. New evidence node with zero edges → remains UNKNOWN-pending; unlinked invalidation is lint-illegal.
6. Settled decision inherits its option's DEPENDS_ON/IMPLIES obligations — "settled forever" claims unsupported by graph are audit findings.
