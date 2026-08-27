# Evidence-aware Posture

Legacy weighted-mean /100 scores are RETIRED (false precision). Replacement contract:

## Dimensions reported individually

Authentication · Authorization · Secrets · Dependencies · Infrastructure · Monitoring · AI-Safety(or N/A) each at ordinal level:

```text
ABSENT | WEAK | PARTIAL | STRONG | TESTED
```

`TESTED` requires operational evidence of testing/control under stated environment.

## Coverage honesty

Report applicable-surface coverage %; list top critical unknowns by name.

## Overall band (deterministic; tools/argus_findings.py posture)

```text
coverage < 70%                              -> SCORE UNAVAILABLE - INSUFFICIENT EVIDENCE (+ missing surfaces listed)
any dimension ABSENT                        -> CRITICAL
min level WEAK                              -> WEAK
min PARTIAL                                 -> MODERATE
min STRONG and coverage < 90%               -> MODERATE (evidence-limited)
all >= STRONG                               -> STRONG
(all TESTED and coverage >= 95)             -> STRONG (no Excellent theater without release-gate artifacts)
```

The band is a posture signal, never a compromise probability or a "secure" claim. Narrative still names strongest/weakest controls, biggest unknowns, single highest-leverage improvement, tradeoffs included.
