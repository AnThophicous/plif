# Release Security Gate

Returns PASS / CONDITIONAL PASS / BLOCKED with evidence. Machine-checkable subset executed per available capabilities; the rest is explicit-checklist with named owner evidence.

```text
[ ] no secrets in source/config/logs/build output/final artifacts
[ ] no debug config/test credentials/unsafe flags/unintended files
[ ] dependencies+lockfiles+lifecycle scripts+provenance reviewed (supply-chain module)
[ ] CI/CD permissions & release credentials least-privileged
[ ] artifact contents/metadata/signing/reproducibility inspected
[ ] security + relevant regression tests passed (real execution, capability-checked)
[ ] config/headers/cookies/network/runtime permissions hardened
[ ] monitoring/alerting/rollback/incident signals present
[ ] security invariants preserved in release (SecurityIR registry re-run)
[ ] open risks have owner+acceptance+expiry+compensating control
```

BLOCK on: confirmed critical/high release risk · exposed secret · missing artifact integrity · unresolved scope-critical control — unless an authorized risk owner accepts w/ expiry + compensating control. Build success ≠ gate pass.
