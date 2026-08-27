# Findings & Proof-of-Fix lifecycle

Finding record (schema ../schemas/finding.schema.json) preserves the legacy professional schema: ID, Title, Category, CWE, OWASP Mapping, Severity(critical|high|medium|low|informational), Confidence(Confirmed 100%|Highly Likely 80%|Possible 50%|Hypothesis 25% — evidence labels, NOT exploit probability), Attack-path status(class), Exploitability, Affected surface/component/files, Attack scenario, Business impact, Evidence, Safe reproduction, Root cause, Recommended fix, Regression protection/test, Invariants affected, Residual risk + developer-coach block (Problem/Why dangerous/Root cause/Fix/Principle/Recurrence).

Severity ≠ confidence ≠ exploitability. Never collapse into one number.

## Lifecycle (tools/argus_findings.py enforce)

```text
OPEN -> REMEDIATION_PROPOSED -> PATCHED -> ATTACK_PATH_BROKEN -> REGRESSION_PROTECTED -> VERIFIED
```

Rules:
1. monotonic single-step transitions only; regressions reopen with cause;
2. VERIFIED for class Confirmed/Likely REQUIRES history containing ATTACK_PATH_BROKEN and REGRESSION_PROTECTED — commit/patch alone NEVER closes a finding;
3. re-verify after final edit; validate both the changed control AND the motivating attack path;
4. dedupe by (root_cause, affected_component) merging evidence;
5. Security Regression Memory entries remain narrow durable control statements stored ONLY where authorized (`SECURITY MEMORY` legacy format preserved; read-only mode proposes, never writes).
