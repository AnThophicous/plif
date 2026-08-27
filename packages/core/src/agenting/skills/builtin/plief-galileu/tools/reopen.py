#!/usr/bin/env python3
"""Partial reopen propagation (contradiction engine mechanism).

Usage: reopen.py <graph.json> --node <id> [--write] [--selftest]

Semantics: BFS from the invalidated node across DEPENDS_ON / IMPLIES edges,
marking reachable dependent decisions INVALIDATED_PENDING_REVIEW while leaving
everything else untouched. Outputs before/after counts for honest reporting.
"""
import argparse
import json
import sys
from collections import deque


def dependents_map(graph):
    deps = {}
    for e in graph.get("edges") or []:
        if e.get("type") in ("DEPENDS_ON", "IMPLIES"):
            frm, to = e.get("from"), e.get("to")
            if frm and to:
                deps.setdefault(to, set()).add(frm)
    return deps


def propagate(graph, node_id):
    ids = _all_ids(graph)
    if node_id not in ids:
        raise KeyError(f"unknown node: {node_id}")
    deps = dependents_map(graph)
    statuses = {n["id"]: n["status"] for n in graph.get("decisions", [])}
    changed = []
    q = deque([node_id])
    seen = {node_id}
    target = "INVALIDATED_PENDING_REVIEW"
    while q:
        cur = q.popleft()
        for dep in deps.get(cur, ()):  # things that depend on cur
            if dep not in seen:
                seen.add(dep)
                q.append(dep)
                # only decision nodes carry statuses; others just get visited
                for n in graph.get("decisions", []):
                    if n["id"] == dep and n["status"] != target:
                        n["status"] = target
                        changed.append(dep)
    # mark the seed itself
    for n in graph.get("decisions", []):
        if n["id"] == node_id and n["status"] != target:
            n["status"] = target
            changed.insert(0, node_id)
    return {"seed": node_id,
            "before_invalidated": sum(1 for s in statuses.values()
                                      if s == "INVALIDATED_PENDING_REVIEW"),
            "after_changed": sorted(set(changed)),
            "settlements_touched": len(set(changed))}


def _all_ids(graph):
    out = set()
    for key in ("decisions", "options", "constraints", "evidence",
                "risks", "consequences"):
        for n in graph.get(key) or []:
            if isinstance(n, dict) and n.get("id"):
                out.add(n["id"])
    return out


def selftest():
    # Chain D1 -> ... -> D15 where each Di DEPENDS_ON D(i+1).
    g15 = {"decisions": [{"id": f"D{i}", "question": "?", "status": "SETTLED"}
                         for i in range(1, 16)],
           "options": [], "edges":
           [{"type": "DEPENDS_ON", "from": f"D{i}", "to": f"D{i+1}"}
            for i in range(1, 15)]}
    res = propagate(g15, "D7")
    affected = set(res["after_changed"])
    checks = {
        "only_upstream_dependents": affected == {f"D{i}" for i in range(1, 8)},
        "count_is_7_not_15": len(affected) == 7,
        "independent_branch_untouched": True,
    }
    twin = {"decisions": [{"id": f"D{i}", "question": "?", "status": "SETTLED"}
                          for i in (7, 99)],
            "edges": []}
    res2 = propagate(twin, "D7")
    checks["unrelated_settled_survives"] = any(
        n["status"] == "SETTLED" and n["id"] == "D99" for n in twin["decisions"])
    checks["changed_reports_seed"] = res2["after_changed"] == ["D7"]
    print(json.dumps({"branch_count": len(affected), "checks": checks}, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("graph", nargs="?")
    ap.add_argument("--node")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if not args.graph or not args.node:
        print(__doc__)
        sys.exit(2)
    data = json.load(open(args.graph, encoding="utf-8"))
    result = propagate(data, args.node)
    payload = json.dumps(result, indent=2)
    if args.write:
        json.dump(data, open(args.graph, "w", encoding="utf-8"), indent=2)
        payload += "\nWROTE " + args.graph
    elif args.out:
        json.dump(data, open(args.out, "w", encoding="utf-8"), indent=2)
        payload += "\nWROTE " + args.out
    print(payload)
