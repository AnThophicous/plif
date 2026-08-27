#!/usr/bin/env python3
"""Security Diff - BEFORE vs AFTER SecurityIR delta classification.

Usage: argus_sec_diff.py --before ir.json --after ir.json [--out FILE] [--selftest]
Delta types: new_entry_point | new_data_flow_uncontrolled | new_identity_without_authz
             new_privilege_overbroad | new_dependency | new_secret_path_candidate
             weakened_control | removed_invariant (BLOCKING)
"""
import argparse
import json
import os
import re
import sys

SECRET_RE = re.compile(r"(secret|token|api[_-]?key|password|credential)", re.I)
BROAD_RE = re.compile(r"(\*|all|tenant[- ]wide|global)", re.I)


def _index(ir):
    nodes = {n["id"]: n for n in ir.get("nodes") or [] if n.get("id")}
    edges = {(e.get("type"), e.get("from"), e.get("to"))
             for e in ir.get("edges") or []}
    return nodes, edges


def controls_guarding(after_nodes, after_edges, target):
    return [e for e in after_edges if e[0] == "protected_by" and e[1] == target]


def diff(before, after):
    bn, be = _index(before)
    an, ae = _index(after)
    findings = []

    def add(t, ref, severity, detail=""):
        findings.append({"delta_type": t, "ref": ref,
                         "severity": severity, "detail": detail})

    for nid, node in an.items():
        if nid in bn:
            continue
        t = node.get("type")
        if t == "EntryPoint":
            add("new_entry_point", nid, "high", "exposure review required")
        elif t == "DataFlow":
            crossing = node.get("crosses_boundary", True)
            guarded = bool(controls_guarding(an, ae, nid))
            if crossing and not guarded:
                add("new_data_flow_uncontrolled", nid, "BLOCKING",
                    "cross-boundary flow without control")
        elif t == "Identity":
            has_authz = any(e[0] in ("requires", "approval_of", "grants")
                            and e[1] == nid for e in ae)
            if not has_authz:
                add("new_identity_without_authz", nid, "high",
                    "identity with no authorization edge in scope")
        elif t == "Privilege":
            stmt = str(node.get("statement", "")) + " " + str(node.get("scope", ""))
            if BROAD_RE.search(stmt):
                add("new_privilege_overbroad", nid, "high", "scope broadening detected")
        elif t == "Dependency":
            meta = json.dumps(node.get("meta", {}), default=str).lower()
            sev = "high" if ("lifecycle" in meta or "postinstall" in meta) else "medium"
            add("new_dependency", nid, sev)
        elif t == "Asset" and SECRET_RE.search(nid):
            flows_out = any(e[0] == "accesses" and e[1] != nid and e[2] == nid
                            or e[0] == "accesses" and e[2] == nid for e in ae)
            if flows_out:
                add("new_secret_path_candidate", nid, "high")

    # removals / weakening
    for eid, node in bn.items():
        if eid in an:
            continue
        if node.get("type") == "Invariant":
            add("removed_invariant", eid, "BLOCKING", "invariant dropped in change")
    lost_controls = 0
    for e in be:
        if e[0] == "protected_by" and e not in ae:
            lost_controls += 1
            add("weakened_control", f"{e[1]}->{e[2]}", "BLOCKING",
                "protection edge removed")
    return {"schema_version": 1,
            "blocking": [f for f in findings if f["severity"] == "BLOCKING"],
            "deltas": findings,
            "summary": {"total": len(findings),
                        "controls_lost": lost_controls}}


def selftest():
    def mk(with_new=True):
        nodes = [
            {"id": "A1", "type": "Asset", "provenance": {"kind": "config", "ref": "db"}, "confidence": "HIGH", "verified": True},
            {"id": "IV1", "type": "Invariant", "provenance": {"kind": "artifact", "ref": "mem.md"}, "confidence": "MED", "verified": True},
            {"id": "C9", "type": "Control", "provenance": {"kind": "code", "ref": "mw.py"}, "confidence": "HIGH", "verified": True},
        ]
        edges = [{"type": "protected_by", "from": "A1", "to": "C9"}]
        before = {"nodes": nodes, "edges": edges}
        after = json.loads(json.dumps(before))
        if with_new:
            after["nodes"] += [
                {"id": "EP2", "type": "EntryPoint", "provenance": {"kind": "code", "ref": "v2.py"}, "confidence": "HIGH", "verified": True},
                {"id": "DFX", "type": "DataFlow", "crosses_boundary": True, "provenance": {"kind": "code", "ref": "x.py"}, "confidence": "MED", "verified": True},
                {"id": "IDN", "type": "Identity", "provenance": {"kind": "interview", "ref": "ops"}, "confidence": "LOW", "verified": False},
                {"id": "PZ", "type": "Privilege", "statement": "grant all tenant-wide", "scope": "*", "provenance": {"kind": "config", "ref": "p.yaml"}, "confidence": "MED", "verified": True},
                {"id": "DEP", "type": "Dependency", "meta": {"lifecycle_scripts": True}, "provenance": {"kind": "web", "ref": "npm/xy"}, "confidence": "MED", "verified": True},
                {"id": "SECRET-TOKEN-STORE", "type": "Asset", "provenance": {"kind": "config", "ref": "vault"}, "confidence": "HIGH", "verified": True},
            ]
            after["edges"] += [
                {"type": "accesses", "from": "SVC", "to": "SECRET-TOKEN-STORE"},
                {"type": "contains", "from": "A1", "to": "SVC"}]
            after["nodes"].append(
                {"id": "SVC", "type": "Service", "provenance": {"kind": "code", "ref": "svc.py"}, "confidence": "LOW", "verified": False})
            after["edges"].remove({"type": "protected_by", "from": "A1", "to": "C9"})
            after["nodes"] = [n for n in after["nodes"] if n["id"] != "IV1"]
        return before, after

    b, a = mk(True)
    res = diff(b, a)
    types = {f["delta_type"] for f in res["deltas"]}
    checks = {
        "endpoint_flagged": "new_entry_point" in types,
        "uncontrolled_flow_blocking": any(f["delta_type"] == "new_data_flow_uncontrolled"
                                          and f["severity"] == "BLOCKING"
                                          for f in res["deltas"]),
        "identity_no_authz_flagged": "new_identity_without_authz" in types,
        "privilege_broad_flagged": "new_privilege_overbroad" in types,
        "dependency_high_lifecycle": any(f["delta_type"] == "new_dependency"
                                         and f["severity"] == "high"
                                         for f in res["deltas"]),
        "secret_path_flagged": "new_secret_path_candidate" in types,
        "invariant_removal_blocking": any(f["delta_type"] == "removed_invariant"
                                          and f["severity"] == "BLOCKING"
                                          for f in res["deltas"]),
        "weakened_control_blocking": any(f["delta_type"] == "weakened_control"
                                         for f in res["deltas"]),
        "clean_diff_empty": diff(*mk(False))["summary"]["total"] == 0,
    }
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--before")
    ap.add_argument("--after")
    ap.add_argument("--out")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if not args.before or not args.after:
        print(__doc__)
        sys.exit(2)
    result = diff(json.load(open(args.before, encoding="utf-8")),
                  json.load(open(args.after, encoding="utf-8")))
    dst = args.out or ".plif/artifacts/security-diff.json"
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    json.dump(result, open(dst, "w", encoding="utf-8"), indent=2)
    print(json.dumps(result["summary"], indent=2))
