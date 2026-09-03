#!/usr/bin/env python3
"""Attack Path traversal engine. Semantics: references/caminhos-de-ataque.md

Usage: argus_attackpath.py <security-ir.json> [--out FILE] [--selftest]
Classifies Confirmed/Likely/Possible/Theoretical exactly as legacy epistemology.
"""
import argparse
import json
import os
import sys
from collections import deque

HOP_EDGES = {"accesses", "crosses"}
PROV_KINDS = {"code", "config", "runtime", "web", "artifact", "interview", "scan"}


def build(ir):
    nodes = {n["id"]: n for n in ir.get("nodes") or [] if n.get("id")}
    adj = {}
    protected = {}   # node_id -> [control ids guarding it]
    for e in ir.get("edges") or []:
        f, t, ty = e.get("from"), e.get("to"), e.get("type")
        if ty == "protected_by" and t:
            protected.setdefault(f, []).append(t)
        if ty in HOP_EDGES and f and t:
            adj.setdefault(f, set()).add(t)
    return nodes, adj, protected


def hop_evidenced(node):
    p = node.get("provenance") or {}
    return bool(p) and bool(p.get("ref"))


def control_states(nodes, protected, nid):
    """'active' (>=1 verified), 'inactive' (controls exist, none verified),
    'missing' (no control guarding this hop)."""
    controls = [nodes[c] for c in protected.get(nid, []) if c in nodes]
    if not controls:
        return "missing"
    if any(c.get("verified") for c in controls):
        return "active"
    return "inactive"


def paths_from(ir, start, max_depth=8):
    nodes, adj, protected = build(ir)
    results = []
    q = deque([[start]])
    while q:
        path = q.popleft()
        last = path[-1]
        node = nodes.get(last)
        if not node:
            continue
        if node["type"] == "Asset":
            results.append(path)
            continue
        if len(path) > max_depth:
            continue
        for nxt in sorted(adj.get(last, ())):
            if nxt not in path:
                q.append(path + [nxt])
    return results, nodes, protected


def classify_path(path, nodes, protected):
    """Deterministic mapping (references/caminhos-de-ataque.md):
    - unevidenced hop                            -> Possible Risk
    - evidenced chain whose guards are all
      unverified ('inactive', none proven)       -> Likely (material condition open)
    - otherwise (proven chain; guards absent,
      active-with-traversing-evidence)           -> Confirmed"""
    evid_ok = all(hop_evidenced(nodes[n]) for n in path)
    states = [control_states(nodes, protected, n) for n in path[:-1]]
    on_controls = []
    for n in path[:-1]:
        on_controls += [c for c in protected.get(n, [])]
    inactive_only = any(s == "inactive" for s in states) and \
        all(s == "inactive" for s in states if s != "missing")
    if not evid_ok:
        status = "Possible Risk"
    elif inactive_only:
        status = "Likely Attack Path"
    else:
        status = "Confirmed Attack Path"
    return {"status": status,
            "evidence_complete": evid_ok,
            "guard_states": states,
            "controls_on_path": on_controls}


def analyze(ir):
    out_paths = []
    entrypoints = [n["id"] for n in ir.get("nodes") or []
                   if n.get("type") == "EntryPoint"]
    raw, nodes, protected = [], {n["id"]: n for n in ir.get("nodes") or []}, {}
    nodes_all, _, _ = build(ir)
    for ep in entrypoints:
        ps, nodes, protected = paths_from(ir, ep)
        for p in ps:
            cls = classify_path(p, nodes, protected)
            out_paths.append({"path_id": f"path-{ep}-{'-'.join(p[-2:])}",
                              "entry": ep, "target": p[-1],
                              "steps": p, **cls})
    leverage = {}
    for pth in out_paths:
        for cid in pth["controls_on_path"]:
            leverage[cid] = leverage.get(cid, 0) + 1
    ranking = sorted(({"control": k, "paths_broken_if_fixed": v}
                      for k, v in leverage.items()),
                     key=lambda x: -x["paths_broken_if_fixed"])
    order = ["Confirmed Attack Path", "Likely Attack Path",
             "Possible Risk", "Theoretical Risk"]
    out_paths.sort(key=lambda p: order.index(p["status"]))
    return {"schema_version": 1, "paths": out_paths,
            "leverage_ranking": ranking,
            "note": "graph gaps are UNKNOWN reachability, never safety"}


def selftest():
    chain_nodes = [
        {"id": "E1", "type": "EntryPoint", "provenance": {"kind": "code", "ref": "routes.py#12"}, "confidence": "HIGH", "verified": True},
        {"id": "B1", "type": "TrustBoundary", "provenance": {"kind": "config", "ref": "ingress.yaml"}, "confidence": "MED", "verified": True},
        {"id": "S1", "type": "Component", "provenance": {"kind": "code", "ref": "api.py"}, "confidence": "HIGH", "verified": True},
        {"id": "A1", "type": "Asset", "provenance": {"kind": "config", "ref": "db.yml"}, "confidence": "HIGH", "verified": True},
        {"id": "C1", "type": "Control", "provenance": {"kind": "config", "ref": "waf.json"}, "confidence": "MED", "verified": False},
        {"id": "E2", "type": "EntryPoint", "provenance": {}, "confidence": "LOW", "verified": False},
        {"id": "A2", "type": "Asset", "provenance": {"kind": "config", "ref": "secrets"}, "confidence": "LOW", "verified": False},
    ]
    base_edges = [
        {"type": "accesses", "from": "S1", "to": "A1"},
    ]

    def mk(extra_edges, e1_b1=True):
        edges = []
        if e1_b1:
            edges += [{"type": "crosses", "from": "E1", "to": "B1"},
                      {"type": "accesses", "from": "B1", "to": "S1"}]
        edges += extra_edges + base_edges + \
                 [{"type": "accesses", "from": "E2", "to": "A2"}]
        return {"nodes": json.loads(json.dumps(chain_nodes)), "edges": edges}

    # A: full evidenced chain, NO controls anywhere -> Confirmed
    res_a = analyze(mk([]))
    a1 = next(p for p in res_a["paths"] if p["target"] == "A1")
    # B: same chain, WAF control exists but unverified -> Likely
    ir_b = mk([{"type": "protected_by", "from": "S1", "to": "C1"}])
    res_b = analyze(ir_b)
    b1 = next(p for p in res_b["paths"] if p["target"] == "A1")
    # C: E2 hop without provenance ref -> Possible
    res_c = analyze(mk([]))
    c1 = next(p for p in res_c["paths"] if p["target"] == "A2")

    checks = {
        "no_control_chain_confirmed": a1["status"] == "Confirmed Attack Path",
        "inactive_guard_likely": b1["status"] == "Likely Attack Path",
        "unproven_hop_possible": c1["status"] == "Possible Risk",
        "leverage_counts_control": any(
            r["control"] == "C1" and r["paths_broken_if_fixed"] >= 1
            for r in res_b["leverage_ranking"]),
        "note_emitted": "UNKNOWN reachability" in res_a["note"],
    }
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("ir", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if not args.ir:
        print(__doc__)
        sys.exit(2)
    data = json.load(open(args.ir, encoding="utf-8"))
    result = analyze(data)
    dst = args.out or ".plif/artifacts/attack-paths.json"
    # O destino padrao vive sob .plif/artifacts/, que normalmente ainda nao
    # existe na primeira execucao: criar a pasta evita um FileNotFoundError
    # depois de a analise ja ter sido feita.
    parent = os.path.dirname(dst)
    if parent:
        os.makedirs(parent, exist_ok=True)
    json.dump(result, open(dst, "w", encoding="utf-8"), indent=2)
    print(json.dumps({"paths": len(result["paths"]),
                      "top_leverage": result["leverage_ranking"][:1]}, indent=2))
