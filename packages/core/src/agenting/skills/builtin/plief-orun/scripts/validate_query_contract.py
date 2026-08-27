#!/usr/bin/env python3
"""QueryContract / SelectionRecord validator (integration contract).

Usage: validate_query_contract.py <file.json> [--selftest]
Auto-detects template kind. Exit 0 valid, 1 invalid.
"""
import argparse
import json
import sys

WEIGHT_KEYS = {"functional_fit", "stack_compatibility", "accessibility",
               "maintainability", "visual_fit", "customizability",
               "performance", "implementation_cost", "dependency_cost",
               "freshness_risk", "licensing_risk"}


def validate_query(q):
    errs = []
    for f in ("requester", "functional_requirement", "framework"):
        if not q.get(f):
            errs.append(f"query missing required field '{f}'")
    if q.get("already_searched_native") is None:
        errs.append("query must state already_searched_native explicitly")
    if q.get("freshness_requirement") not in ("HIGH", "MED", "LOW", None):
        errs.append("invalid freshness_requirement")
    w = q.get("ranking_weights_override") or {}
    bad = set(w) - WEIGHT_KEYS
    if bad:
        errs.append(f"unknown ranking weight keys: {sorted(bad)}")
    pb = q.get("performance_budget") or {}
    for k in ("initial_js_kb_max",):
        v = pb.get(k)
        if v is not None and (not isinstance(v, (int, float)) or v <= 0):
            errs.append(f"performance_budget.{k} must be positive number")
    return errs


def validate_record(r):
    errs = []
    if r.get("materiality") not in ("TRIVIAL", "MATERIAL"):
        return ["record materiality must be TRIVIAL|MATERIAL"]
    if r.get("materiality") == "TRIVIAL":
        if not r.get("why_selected"):
            errs.append("TRIVIAL record still needs one-line why_selected")
        return errs
    if not r.get("why_selected"):
        errs.append("MATERIAL record requires why_selected")
    if not r.get("why_rejected"):
        errs.append("MATERIAL record requires why_rejected[] (BUILD counts as candidate)")
    if r.get("risk") == "HIGH" and not r.get("evidence"):
        errs.append("HIGH risk selection without evidence refused")
    fr = r.get("freshness")
    VALID_FR = {"VERIFIED_CURRENT", "VERIFIED_BUT_VERSION_UNKNOWN", "STALE",
                "UNVERIFIED", "DEPRECATED", "REMOVED", None}
    if fr not in VALID_FR:
        errs.append(f"invalid freshness {fr!r}")
    if fr in ("STALE", "UNVERIFIED") and r.get("dependencies_introduced"):
        errs.append("install/introduce dependencies with STALE/UNVERIFIED facts is FORBIDDEN "
                    "(integration contract)")
    return errs


def selftest():
    q_ok = {"requester": "plief-sifr/component-intelligence",
            "functional_requirement": "command menu with keyboard nav",
            "framework": "React 19", "already_searched_native": True}
    q_bad = dict(q_ok, already_searched_native=None,
                 ranking_weights_override={"made_up": 2})
    rec_ok = {"candidate": "x:y", "materiality": "MATERIAL",
              "why_selected": "fits", "why_rejected": [{"candidate": "BUILD",
                                                        "reason": "worse"}],
              "freshness": "VERIFIED_CURRENT", "risk": "LOW",
              "evidence": ["official docs"]}
    rec_trivial = {"candidate": "x:y", "materiality": "TRIVIAL",
                   "why_selected": "micro swap"}
    rec_bad_install = {"candidate": "z", "materiality": "MATERIAL",
                       "why_selected": "s", "why_rejected": [],
                       "freshness": "STALE", "dependencies_introduced": ["new-pkg"]}
    checks = {
        "query_valid": not validate_query(q_ok),
        "query_native_flag_required": any("already_searched_native" in m
                                          for m in validate_query(q_bad)),
        "query_unknown_weight_flagged": any("made_up" in m
                                            for m in validate_query(q_bad)),
        "material_record_valid": not validate_record(rec_ok),
        "trivial_one_liner_ok": not validate_record(rec_trivial),
        "stale_dep_install_refused": any("FORBIDDEN" in m
                                         for m in validate_record(rec_bad_install)),
        "high_risk_needs_evidence": any("evidence" in m for m in validate_record(
            dict(rec_ok, risk="HIGH", evidence=[]))),
    }
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if not args.path:
        print(__doc__)
        sys.exit(2)
    data = json.load(open(args.path, encoding="utf-8"))
    kind = data.get("template") or ("query" if "functional_requirement" in data
                                    else "record")
    errs = (validate_query(data) if kind.startswith("selection-query") or kind == "query"
            else validate_record(data))
    if errs:
        print(f"{kind.upper()} INVALID")
        print("\n".join("- " + e for e in errs))
        sys.exit(1)
    print(f"OK: {kind} valid")
