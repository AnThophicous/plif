---
name: deep-review
display_name: "Deep Review"
description: >
  Review a diff/change for correctness (QUICK mode) or run an adversarial
  production-grade audit where mistakes are expensive - auth, migrations,
  data loss, public APIs, irreversible changes (DEEP mode).
---

# Deep Review

Two modes; routing is automatic from stakes, never ceremony:

## QUICK — diff correctness review (behavior preserved verbatim from review-change v1)

<!-- QUICK-MODE-BEGIN -->
Read the change for what it does, not for how it looks.

Order to work in:
1. What is this change trying to do? Get that from the code, not the message.
2. Does it do that? Trace the actual path, including the error path.
3. What breaks that used to work? Look for callers, not just the edited file.
4. What input makes this wrong? Boundaries, empty, null, concurrent, very large.
5. Is anything now unreachable, unused, or duplicated?

Report only what you can demonstrate with a concrete failing case: the inputs,
and what goes wrong. "This could be clearer" is not a finding. Formatting is
never a finding.

If the change is correct, say so plainly and stop.
<!-- QUICK-MODE-END -->

Parity is machine-tested (`tools/test_quick_parity.py`) against
`fixtures/review-change-v1.txt`.

## DEEP — adversarial engineering audit

Use when failure cost is high (builder/breaker separation preserved from deep-engineering-audit):

1. **Think:** inspect real source, configs, tests, callers, constraints.
2. **Plan:** acceptance criteria, assumptions, failure modes, blast radius BEFORE mutation.
3. **Work:** smallest focused change + change log.
4. **Structural review:** reread every changed line against contracts/callers.
5. **Test:** malformed input, boundaries, retries, cancellation, repetition, reported regression.
6. **Adversarial:** attack trust boundaries, authorization, secrets, silent failures, state/timing/concurrency, compatibility.
7. **Complete:** resolve blockers/major findings or document accepted risk.

Every finding: severity · exact location · scenario · impact · fix direction.
Never call complete because it compiles or worked once; rerun verification after final edit; report only commands actually run.

## Kernel-fed inputs (vNext)

- Start from `.plif/artifacts/<task>/change-impact.json` when present (affected callers/tests/security candidates precomputed).
- Security-relevant deltas route findings to Pli'ef Argus SecDiff instead of duplicating them here.
- Findings vocabulary follows `_kernel/evidence/ledger.md`; claims are VERIFIED/INFERRED/etc., demonstrated cases only.
