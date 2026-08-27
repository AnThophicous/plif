#!/usr/bin/env python3
"""SecurityIR linter. Rules: plief-argus/core/ir.md

Usage: argus_ir_lint.py <security-ir.json> [--selftest]
"""
import argparse
import json
import sys

NODE_TYPES = {"SystemBoundary", "Asset", "Principal", "Identity", "EntryPoint",
              "Component", "Service", "TrustBoundary", "DataFlow", "Privilege",
              "Control", "Dependency", "Threat", "AttackPath", "Finding",
              "Invariant", "SystemInstructions", "UserContent", "UntrustedContent",
              "Retrieval", "Memory", "ModelBoundary", "ToolAuthorization", "HumanApproval"}
EDGE_TYPES = {"contains", "crosses", "accesses", "protected_by", "delegates_to",
              "trusts", "grants", "requires", "approval_of", "mitigates"}
AI_KINDS = {"SystemInstructions", "UserContent", "UntrustedContent", "Retrieval",
            "Memory", "ModelBoundary", "ToolAuthorization"}
PROV_KINDS = {"code", "config", "runtime", "web", "artifact", "interview", "scan"}


def lint(ir):
    errs = []
    nodes = ir.get("nodes") or []
    seen = set()
    for n in nodes:
        nid, t = n.get("id"), n.get("type")
        if not nid or not t:
            errs.append(f"node missing id/type: {nid or t!r}")
            continue
        if t not in NODE_TYPES:
            errs.append(f"node {nid}: invalid type {t}")
        if nid in seen:
            errs.append(f"duplicate node id {nid}")
        seen.add(nid)
        prov = n.get("provenance") or {}
        if prov.get("kind") not in PROV_KINDS or not prov.get("ref"):
            errs.append(f"node {nid}: provenance requires kind/ref")
        if n.get("confidence") not in ("LOW", "MED", "HIGH"):
            errs.append(f"node {nid}: confidence must be LOW/MED/HIGH")
        if not isinstance(n.get("verified"), bool):
            errs.append(f"node {nid}: verified bool required")

    node_ids = seen
    for e in ir.get("edges") or []:
        if e.get("type") not in EDGE_TYPES:
            errs.append(f"edge invalid type {e.get('type')!r}")
        for ep in (e.get("from"), e.get("to")):
            if ep and ep not in node_ids:
                errs.append(f"edge endpoint unknown: {ep}")

    meta = ir.get("meta") or {}
    kinds_present = {n.get("type") for n in nodes}
    if meta.get("ai_system"):
        for k in AI_KINDS:
            if k not in kinds_present:
                errs.append(f"ai_system=true but node kind missing: {k}")

    # authorization-outside-model invariant (standing)
    grants_by_map = [e for e in ir.get("edges") or []
                     if e.get("type") == "grants"
                     and next((n["type"] for n in nodes if n.get("id") == e.get("from")), "") == "ModelBoundary"]
    for e in grants_by_map:
        errs.append(f"AUTHORIZATION-OUTSIDE-MODEL violation: ModelBoundary '{e['from']}' "
                    f"grants {e['to']} — text never confers capability; finding candidate")
    return errs


def selftest():
    base_nodes = [
        {"id": "MB", "type": "ModelBoundary", "provenance": {"kind": "code", "ref": "agent.py"},
         "confidence": "HIGH", "verified": True},
        {"id": "P1", "type": "Privilege", "provenance": {"kind": "config", "ref": "policy.yaml"},
         "confidence": "MED", "verified": True},
        {"id": "HA", "type": "HumanApproval", "provenance": {"kind": "code", "ref": "ui.ts"},
         "confidence": "HIGH", "verified": False},
    ]
    ok = {"schema_version": 1,
          "meta": {"ai_system": True,
                   "note": "uses representative AI subset for lint demo"},
          "nodes": base_nodes + [
              {"id": "SI", "type": "SystemInstructions", "provenance": {"kind": "code", "ref": "prompt.md"}, "confidence": "HIGH", "verified": True},
              {"id": "USRC", "type": "UserContent", "provenance": {"kind": "runtime", "ref": "session.log"}, "confidence": "MED", "verified": True},
              {"id": "UC", "type": "UntrustedContent", "provenance": {"kind": "web", "ref": "https://x"}, "confidence": "MED", "verified": True},
              {"id": "RT", "type": "Retrieval", "provenance": {"kind": "code", "ref": "rag.py"}, "confidence": "MED", "verified": True},
              {"id": "TA", "type": "ToolAuthorization", "provenance": {"kind": "config", "ref": "tools.yaml"}, "confidence": "HIGH", "verified": True},
              {"id": "MEM", "type": "Memory", "provenance": {"kind": "code", "ref": "store.py"}, "confidence": "LOW", "verified": False}],
          "edges": [{"type": "mitigates", "from": "HA", "to": "TA"}]}
    grant_bad = json.loads(json.dumps(ok))
    grant_bad["edges"].append({"type": "grants", "from": "MB", "to": "P1"})
    missing_ai = json.loads(json.dumps(ok))
    missing_ai["nodes"] = [n for n in missing_ai["nodes"]
                           if n["type"] != "Memory"]

    checks = {
        "valid_ai_ir_passes": not lint(ok),
        "model_grant_flagged": any("AUTHORIZATION-OUTSIDE-MODEL" in m
                                   for m in lint(grant_bad)),
        "missing_ai_kind_detected": any("node kind missing: Memory" in m
                                        for m in lint(missing_ai)),
    }
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("ir", nargs="?")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if not args.ir:
        print(__doc__)
        sys.exit(2)
    data = json.load(open(args.ir, encoding="utf-8"))
    errs = lint(data)
    if errs:
        print("SECURITY IR LINT FAILED")
        print("\n".join("- " + m for m in errs))
        sys.exit(1)
    print(f"OK: security IR valid ({len(data.get('nodes', []))} nodes)")
