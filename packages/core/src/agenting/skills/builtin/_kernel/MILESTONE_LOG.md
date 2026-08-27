# Milestone Log â€” PLI'EF vNext implementation

Compact record per milestone: changes, key files, validations executed, results, real pendings, risks/degradations. Evidence paths are relative to this repository root.

## M0 â€” Prep (2026-08-26)

- Backup: `_backup_pre_vnext.zip` (full pre-migration snapshot).
- Environment: Python 3.14.7 confirmed; no node/npm available in-session (bridge scripts retained untested-at-runtime; contract unchanged).
- Sources of truth located and skimmed end-to-end: `_pli_ef_vnext/01..05` (all five present).

## M1 â€” Kernel

Changes:
- Created `_kernel/` with canonical docs: README ownership map, evidence ledger rules + schema, capability map protocol, artifact conventions registry, R0â€“R3 autonomy model, Cartographer spec/schema, Change Impact spec/schema.
- Implemented stdlib-only tools, each with `--selftest`: `validate_ledger.py`, `cartography.py`, `change_impact.py`, `package_conformance.py`, `run_evals.py`.

Validation:
- E1 selftests after regression-first fixes: ledger 4/4 checks PASS (fixtures corrected to satisfy symmetric contradiction rule + real duplicate fixture); cartography 6/6 PASS (argparse ordering fix); change_impact 9/9 PASS (parser made diff-boundary-safe, fixture normalized to realistic git format, secret-path trigger restored).

## M2 â€” Pli'ef Sifr

Changes:
- Created `plief-sifr/` as the single frontend entry (entry SKILL.md ~ routing only).
- Kernel internal: orchestration Â· experience-state Â· handoffs Â· degraded-mode capsule (single canonical copy of the retired fallbacks).
- 13 JIT modules consolidating the eight legacy PLIEF skills + eclipse + shared contract content (map in `_pli_ef_vnext/03` Â§2.2); genericity firewall canonical in verification.md.
- Engines w/ selftests: `ir_validate.py` (7 checks), `matrix_expand.py` (contractâ†’representative render matrix + promise widths + coverage gaps), `defect_classify.py` (digit-insensitive grouping, systemic flag, owner lookup incl. fallback TOKEN rule, repeat-patch cycle guard).
- 7 schemas; Orun integration templates; Pli'ef Capture assets migrated intact (extension/, plief-capture-bridge.mjs, CAPTURE_BRIDGE.md, SLOT_DNA.md, BUILD_INFO.json) â€” external contract untouched; atlas moved/revised to references/atlas.md.
- Eval pack: 35 CMP cases (semantics of the retired component-picker evals preserved) + 18 new B cases â†’ 4 case files normalized to canonical format.

Validation: engines selftests green after regression-first fixes (fixture/design errors were mine each time). Spec deviation logged below.

## M3 â€” Pli'ef Galileu

Changes: full rebuild per spec â€” SKILL.md modes router; core docs (graph/assumptions/questions/contradiction/counterfactual/premortem) + single-file modes/ for JIT economy; tools with selftests: `galileu_lint.py` (edges/dangling/single-option/assumption hard rules/PREFERENCE-as-constraint/invalidation-consistency) and `reopen.py` (BFS over DEPENDS_ON|IMPLIES proving partial-reopen property); 3 schemas; 14 behavioral cases GAL-01..14; manifest.

Validation: lint selftest 9/9, reopen proves invalidation touches only reachable dependents (7-of-15 chain case â‡’ GAL-06 property machine-checked).

## M4 â€” Pli'ef Argus

Changes: SKILL.md preserves the legacy operating contract discipline nearly verbatim (read-only default, authorization boundary fields, forbidden actions, redaction); core docs ir/attack-paths/identity/ai-agent-security/findings/posture/release-gate; project-type matrix copied intact from legacy reference; tools w/ selftests: `argus_ir_lint.py` (incl. standing AUTHORIZATION-OUTSIDE-MODEL invariant + AI node kinds), `argus_attackpath.py` (guard states active/inactive/missing â†’ Confirmed/Likely/Possible/Theoretical + control leverage ranking), `argus_sec_diff.py` (8 delta types, BLOCKING on invariant removal/weakened control/uncontrolled cross-boundary flow), `argus_findings.py` (monotonic lifecycle w/ prior_cycles reopen semantics + commit-is-not-closure rule + dedupe + deterministic posture bands with SCORE UNAVAILABLE guard); schemas Ã—2; eval pack AR-01..17.

Validation: all four selftests green after regression-first corrections (fixture omissions, classifier semantic split).

## M5 â€” Orun enhancement

Changes: integration contract `rules/integration-contract.md` formalizing QueryContract/SelectionRecord/unavailability matrix and resolving the historical component-discovery overlap with consumers; selection-query/-record schemas; `scripts/validate_query_contract.py` (+selftest incl. stale-dependency-install refusal, weight key whitelist, TRIVIAL materiality collapse); SKILL.md additive integration section; eval pack OR-01..10; manifest v1.1.0-integration. Existing catalogs/indexes/scripts/tests untouched.

Validation: validator selftest 7/7; legacy catalog validators still pass (`validate_catalog.py` OK â€” rerun below in M6 evidence).

## M6 â€” Cleanup & final gates

Changes:
- 12 facades written (8 PLIEF + galileu + plif-cybersecurity + review-change + deep-engineering-audit): original descriptions preserved for router hits; bodies replaced by explicit migration pointers; originals recoverable from `_backup_pre_vnext.zip`.
- `deep-review/` merge completed: QUICK mode byte-parity test against extracted review-change v1 body (`tools/test_quick_parity.py`, fixture built from original file) â€” PASS.
- skill-creator updated with mandatory vNext conventions section.
- shared/* reduced to historical pointers with canonical-home tables.
- manifests written for every package incl. facades (24 total).

Validation evidence:

```text
package_conformance: CONFORMANT (24 packages, 0 errors)
run_evals:           E0 CONFORMANT | E1 13/13 | E2-E6 RUNTIME_EVAL_NOT_EXECUTED
orun validate_catalog.py: re-run OK (22 sources / 81 items / 11 concepts)
quick parity:        byte-equal TRUE
```

Known deviations from spec (each smallest-viable, documented):
1. postura/posture: kept exactly one band vocabulary; mixed STRONG/TESTED at â‰¥90% â†’ STRONG per core/posture.md table (spec example text treated TESTED-only+95% as the sole STRONG path; implementation allows both, table is normative here).
2. defect_classify maps identical-radius/elevation mass symptoms to DESIGN_DNA (radius law), with TOKEN as the unmapped-mass-repetition fallback â€” eval plan 05 SIFR-B13 already reads "DESIGN_DNA/TOKEN".
3. Galileu modes consolidated into single modes/modes.md instead of six files (JIT economy; one concept per file not violated â€” the concept is "modes").
4. Argus project-type modules consolidated into modules/project-type-matrix.md (legacy matrix copied intact) rather than eight near-duplicate files.

Pendings reais (declared honestly):
- E2â€“E6 behavioral/integration/degradation layers remain RUNTIME_EVAL_NOT_EXECUTED: no agentic host adapter present in this environment (`PLIEF_EVAL_ADAPTER` unset). Case packs are complete and release-blocking once executed; non-execution recorded, never assumed-passed.
- Bridge runtime smoke (node server up/POST roundtrip) not executed: node unavailable in-session. Contract unchanged; parity of files verified by copy.
- Cartographer/change-impact exercised via embedded synthetic fixtures only (no real target repo provided).

Risks/degradations: none silent. All capability-dependent claims across packages route through `_kernel/capabilities/map.md` protocol and degrade with explicit UNVERIFIED markers.
