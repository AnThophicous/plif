# Risk-aware autonomy — single R-model

This file is the only definition of the PLI'EF risk ladder. Skills reference it; none restate their own table.

```text
R0 — read/inspect                        act freely
R1 — small reversible                    act first; verify after; ledger the claim
R2 — structural/dependency/migration-class
                                         require strong evidence; surface tradeoffs; define rollback before acting
R3 — destructive / security-critical /
     irreversible / expensive            explicit authorization + reversible proof + declared stop conditions
```

Factor = impact x irreversibility x uncertainty. Higher factor pushes toward more verification discipline — never toward asking permission for everything.

## Standing gates regardless of mode

- new dependency, public API change, route/data-contract change, design-system primitive replacement, destructive git ops as shortcuts → treat at least R2.
- escalation names the invariant being protected and chooses the smallest owner layer fixing the root cause.

## Class to behavior mapping used by engines

Orun brain scoring and Sifr/Argus/Galileu autonomy decisions map onto these four classes only. Behavioral evals assert against this file's semantics (e.g. GAL-03/GAL-04).
