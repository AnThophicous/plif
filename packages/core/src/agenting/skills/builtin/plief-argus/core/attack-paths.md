# Attack Path Engine — traversal semantics

Tool: `../tools/argus_attackpath.py <security-ir.json> [--from capability-level]`

## Path shape

```text
ENTRYPOINT -> [crosses TrustBoundary / accesses component] ... -> ASSET/SINK
per hop record: preconditions, identity traversed, privilege needed,
controls encountered (protected_by linked), provenance/completeness flags
```

## Classification mapping (legacy epistemology preserved EXACTLY)

| mechanical condition on a fully-formed path | status |
|---|---|
| every hop evidenced AND every en-route control verified false/absent | Confirmed Attack Path |
| chain complete, exactly one material unverified control/link | Likely Attack Path |
| ≥1 hop lacks provenance/completeness | Possible Risk |
| weak link exists but does not form a full chain to an asset | Theoretical Risk (watchlist, not finding) |

Only the first two normally become actionable findings.

## Leverage computation

For each control C: `leverage(C)` = number of paths whose hop-set includes C's protected target. Highest leverage = remediation that breaks the most paths simultaneously — answer "which control should stop it / which fix breaks most paths" mechanically, not rhetorically.

## Boundaries

No exploit payload generation, ever. "Reachability unknown" appears as UNKNOWN with the exact missing links listed; graph gaps are NEVER read as safety.
