#!/usr/bin/env python3
"""Findings lifecycle enforcement, dedupe, evidence-aware posture band.

Usage:
  argus_findings.py check  <findings.jsonl>       # monotonic transitions + proof rules
  argus_findings.py dedupe <findings.jsonl>       # merge same root_cause+component
  argus_findings.py posture <dimensions.json>     # band or SCORE UNAVAILABLE
  argus_findings.py --selftest
"""
import argparse
import json
import sys

ORDER = ["OPEN", "REMEDIATION_PROPOSED", "PATCHED", "ATTACK_PATH_BROKEN",
         "REGRESSION_PROTECTED", "VERIFIED"]
IDX = {s: i for i, s in enumerate(ORDER)}
NEED_PROOF = {"Confirmed Attack Path", "Likely Attack Path"}
LEVELS = ["ABSENT", "WEAK", "PARTIAL", "STRONG", "TESTED"]


def _cycles(record):
    """History may split into prior cycles after authorized reopens
    (references/ciclo-de-achados.md rule 1: regressions reopen WITH CAUSE). Each entry of
    `prior_cycles` is one closed history; current attempt lives in `history`.
    Proof obligations check the union of every cycle."""
    cycles = [c for c in (record.get("prior_cycles") or []) if c] or []
    current = record.get("history") or [record.get("state", "OPEN")]
    return cycles + [current]


def _as_records(data):
    """Accept a list, an envelope {"findings": [...]}, or a single record.

    A one-line JSONL file parses as a plain dict, which the envelope branch
    would read as zero records — printing a clean "OK" that verified nothing.
    """
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if isinstance(data.get("findings"), list):
            return data["findings"]
        return [data]
    return []


def check(records):
    errs = []
    for r in records:
        fid = r.get("id", "?")
        cycles = _cycles(r)
        reached = []
        for ci, states_raw in enumerate(cycles):
            states = [s for s in states_raw if s in IDX]
            seq = [IDX[s] for s in states]
            if seq != sorted(seq):
                errs.append(f"{fid}: non-monotonic transition in cycle {ci} {states}")
            if any(seq[i + 1] - seq[i] > 1 for i in range(len(seq) - 1)):
                errs.append(f"{fid}: skipped steps in cycle {ci} {states}")
            reached += states
        last_cycle = cycles[-1]
        last = last_cycle[-1] if last_cycle else "OPEN"
        if last == "VERIFIED":
            cls = r.get("attack_path_class")
            missing = []
            if cls in NEED_PROOF:
                if "ATTACK_PATH_BROKEN" not in reached:
                    missing.append("ATTACK_PATH_BROKEN")
                if "REGRESSION_PROTECTED" not in reached:
                    missing.append("REGRESSION_PROTECTED")
            if missing:
                errs.append(f"{fid}: VERIFIED requires {missing} "
                            f"(class={cls}) — commit is not closure")
        if last in ("PATCHED", "ATTACK_PATH_BROKEN", "REGRESSION_PROTECTED",
                    "VERIFIED") and not r.get("patch_ref"):
            errs.append(f"{fid}: {last} without patch_ref")
        # reopen legality: current cycle OPEN-following-closed needs reopen metadata
        if len(cycles) > 1 and not r.get("reopen_reason"):
            errs.append(f"{fid}: reopened without reopen_reason/cause")
    return errs


def dedupe(records):
    groups = {}
    out, dups = [], 0
    for r in records:
        key = (str(r.get("root_cause", "")).lower().strip(),
               str(r.get("affected_component", "")).lower().strip())
        g = groups.setdefault(key, [])
        if g:
            dups += 1
            g[0].setdefault("merged_evidence_ids", []).append(r.get("id"))
            if len(r.get("evidence", [])) > len(g[0].get("evidence", [])):
                g[0]["evidence"] = r.get("evidence", [])
        else:
            out.append(r)
        g.append(r)
    return out, dups


def posture(dimensions, coverage_pct):
    """dimensions: {name: level}. Deterministic table from references/postura.md."""
    if coverage_pct < 70:
        return {"result": "SCORE UNAVAILABLE — INSUFFICIENT EVIDENCE",
                "coverage_pct": coverage_pct,
                "missing_surface_guidance":
                    "list unaudited applicable surfaces explicitly; never fabricate scores"}
    levels = list(dimensions.values())
    unknown = [k for k, v in dimensions.items() if v not in LEVELS]
    if unknown:
        return {"result": "SCORE UNAVAILABLE — INSUFFICIENT EVIDENCE",
                "reason": f"unknown levels: {unknown}"}
    min_idx = min(LEVELS.index(v) for v in levels)
    weakest = LEVELS[min_idx]
    if weakest == "ABSENT":
        band = "CRITICAL"
    elif weakest == "WEAK":
        band = "WEAK"
    elif weakest == "PARTIAL":
        band = "MODERATE"
    elif coverage_pct < 90:
        band = "MODERATE (evidence-limited)"
    elif all(v == "TESTED" for v in levels) and coverage_pct >= 95:
        band = "STRONG"
    else:
        band = "STRONG"
    return {"result": band, "coverage_pct": coverage_pct,
            "weakest_dimension_level": weakest}


def selftest():
    ok_close = {
        "id": "F-01", "attack_path_class": "Confirmed Attack Path",
        "patch_ref": "abc123", "root_cause": "no ownership check",
        "affected_component": "api/users.ts",
        "history": ["OPEN", "REMEDIATION_PROPOSED", "PATCHED",
                    "ATTACK_PATH_BROKEN", "REGRESSION_PROTECTED", "VERIFIED"],
        "evidence": ["a"], "state": "VERIFIED"}
    bad_close = dict(ok_close, id="F-02",
                     history=["OPEN", "PATCHED", "VERIFIED"])
    skip_case = dict(ok_close, id="F-03",
                     history=["OPEN", "ATTACK_PATH_BROKEN"])
    regressed = dict(ok_close, id="F-04",
                     history=["PATCHED", "ATTACK_PATH_BROKEN",
                              "REGRESSION_PROTECTED", "VERIFIED"],
                     prior_cycles=[["OPEN", "REMEDIATION_PROPOSED"]],
                     reopen_reason="control regression observed in staging")
    checks = {
        "full_proof_cycle_valid": not check([ok_close]),
        "commit_only_closure_rejected": any("commit is not closure" in m
                                            for m in check([bad_close])),
        "skipped_step_rejected": any("skipped steps" in m
                                     for m in check([skip_case])),
        "regression_history_allowed": not check([regressed]),
        "patched_needs_patch_ref": any("without patch_ref" in m for m in check(
            [dict(ok_close, id="F-05", patch_ref=None)])),
        "dedupe_merges_root_cause": dedupe([
            dict(ok_close, id="D1"),
            dict(ok_close, id="D2", evidence=["b"])])[1] == 1,
        "posture_low_coverage_unavailable": posture(
            {"Auth": "STRONG"}, 40)["result"].startswith("SCORE UNAVAILABLE"),
        "posture_absent_critical": posture({"Auth": "ABSENT", "Sec": "TESTED"},
                                           100)["result"] == "CRITICAL",
        "posture_weak_band": posture({"Auth": "WEAK"}, 100)["result"] == "WEAK",
        "posture_strong_evidence_limited_85": posture(
            {"a": "STRONG", "b": "TESTED"}, 85)["result"] == "MODERATE (evidence-limited)",
        "posture_all_tested_95": posture({"a": "TESTED", "b": "TESTED"},
                                         95)["result"] == "STRONG",
    }
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", nargs="?")
    ap.add_argument("path", nargs="?")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if args.mode not in ("check", "dedupe", "posture") or not args.path:
        print(__doc__)
        sys.exit(2)
    raw = open(args.path, encoding="utf-8").read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # O artefato de achados e publicado como JSONL (uma linha por
        # registro); sem este ramo a ferramenta nao consegue ler o proprio
        # arquivo que o fluxo produz.
        data = [json.loads(line) for line in raw.splitlines() if line.strip()]
    records = _as_records(data)
    if args.mode == "check":
        if not records:
            print(f"ERROR: no finding records found in {args.path} — reporting "
                  "'lifecycle valid' over an empty set would be a false assurance")
            sys.exit(2)
        errs = check(records)
        print("\n".join(errs) if errs
              else f"OK: lifecycle valid ({len(records)} finding(s) checked)")
        sys.exit(1 if errs else 0)
    if args.mode == "dedupe":
        merged, dups = dedupe(records)
        print(json.dumps({"merged_records": merged,
                          "duplicates_found": dups}, indent=2))
        sys.exit(0)
    dims, cov = data.get("dimensions"), float(data.get("coverage_pct", 0))
    print(json.dumps(posture(dims, cov), indent=2))
