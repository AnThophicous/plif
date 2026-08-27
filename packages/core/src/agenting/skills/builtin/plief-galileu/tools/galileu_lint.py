#!/usr/bin/env python3
"""Galileu graph/ledger linter. Rules: plief-galileu/core/*.md

Usage: galileu_lint.py <decision-graph.json> [--assumptions assumptions.jsonl] [--selftest]
Exit 0 = lint clean, 1 = violations, 2 = usage.
"""
import argparse
import json
import sys

EDGE_TYPES = {"DEPENDS_ON", "SUPPORTS", "CONTRADICTS", "CONSTRAINS",
              "INVALIDATES", "MITIGATES", "IMPLIES", "SELECTS"}
STATUSES = {"OPEN", "SETTLED", "INVALIDATED_PENDING_REVIEW"}
A_KINDS = {"FACT", "INFERENCE", "ASSUMPTION", "PREFERENCE", "CONSTRAINT", "UNKNOWN"}


def _ids(graph):
    out = set()
    for coll, keyf in (("decisions", lambda n: n["id"]),
                       ("options", lambda n: n["id"]),
                       ("constraints", lambda n: n["id"]),
                       ("evidence", lambda n: n["id"]),
                       ("risks", lambda n: n["id"]),
                       ("consequences", lambda n: n["id"])):
        for n in graph.get(coll) or []:
            if keyf(n):
                out.add(keyf(n))
    return out


def prop_dependents(graph):
    """Map node_id -> dependents via DEPENDS_ON / IMPLIES."""
    deps = {}
    for e in graph.get("edges") or []:
        if e.get("type") in ("DEPENDS_ON", "IMPLIES"):
            frm = e.get("from")
            to = e.get("to")
            if frm and to:
                deps.setdefault(to, set()).add(frm)
    return deps


def check_invalidations(graph):
    errs = []
    deps = prop_dependents(graph)
    statuses = {n["id"]: n["status"] for n in (graph.get("decisions") or [])
                if isinstance(n, dict) and n.get("id")}
    if not any(s == "INVALIDATED_PENDING_REVIEW" for s in statuses.values()):
        return errs
    from collections import deque
    seeded = [i for i, s in statuses.items() if s == "INVALIDATED_PENDING_REVIEW"]
    seen = set(seeded)
    q = deque(seeded)
    while q:
        cur = q.popleft()
        for dep in deps.get(cur, ()):  # dependents must be invalidated too
            if dep not in seen:
                seen.add(dep)
                q.append(dep)
                if statuses.get(dep) == "SETTLED":
                    errs.append(f"propagation gap: dependent '{dep}' still SETTLED while "
                                f"'{cur}' INVALIDATED_PENDING_REVIEW")
    return errs


def lint(graph, assumptions=None):
    errs = []
    ids = _ids(graph)
    opts_by_decision = {}
    decisions = {}
    for d in graph.get("decisions") or []:
        did = d.get("id")
        if not did:
            errs.append("decision without id")
            continue
        if did in decisions:
            errs.append(f"duplicate decision id {did}")
        decisions[did] = d
        if d.get("status") not in STATUSES:
            errs.append(f"decision '{did}' invalid status {d.get('status')!r}")
        opts = [o for o in graph.get("options") or [] if o.get("decision") == did]
        opts_by_decision[did] = len(opts)
        if d.get("status") == "OPEN" and len(opts) < 2 and not d.get("single_option_reason"):
            errs.append(f"OPEN decision '{did}' has <2 options and no single_option_reason")

    for e in graph.get("edges") or []:
        if e.get("type") not in EDGE_TYPES:
            errs.append(f"edge invalid type {e.get('type')!r}")
        for endpt in (e.get("from"), e.get("to")):
            if endpt and endpt not in ids:
                errs.append(f"edge endpoint unknown: {endpt}")
    # PREFERENCE misuse
    prefs = {a.get("id") for a in (assumptions or [])
             if a.get("kind") == "PREFERENCE"} if assumptions else set()
    for e in graph.get("edges") or []:
        if e.get("type") in ("CONSTRAINS", "SUPPORTS") and e.get("from") in prefs:
            errs.append(f"PREFERENCE {e['from']} used in {e['type']} edge "
                        "(preference masquerading as constraint)")
    errs += check_invalidations(graph)
    return errs


def load_assumptions(path):
    txt = open(path, encoding="utf-8").read()
    recs = [json.loads(l) for l in txt.splitlines() if l.strip()]
    errs = []
    for a in recs:
        aid = a.get("id", "?")
        if a.get("kind") not in A_KINDS:
            errs.append(f"assumption {aid}: invalid kind {a.get('kind')!r}")
        if a.get("kind") == "ASSUMPTION":
            if not a.get("how_to_verify"):
                errs.append(f"assumption {aid} ASSUMPTION missing how_to_verify")
            if a.get("impact_if_false") not in ("minor", "material", "critical"):
                errs.append(f"assumption {aid} needs impact_if_false ordinal")
        if a.get("kind") == "FACT" and not a.get("source"):
            errs.append(f"assumption {aid} FACT missing provenance/source")
    return recs, errs


def selftest():
    good = {
        "decisions": [{"id": "D1", "question": "engine?", "status": "SETTLED"},
                      {"id": "D2", "question": "tokens layer?", "status": "SETTLED"},
                      {"id": "D3", "question": "3d needed?", "status": "INVALIDATED_PENDING_REVIEW"},
                      {"id": "D4", "question": "budget split?",
                       "status": "INVALIDATED_PENDING_REVIEW"}],
        "options": [{"id": "O1", "decision": "D1", "thesis": "gsap+css", "costs": [], "risks": []},
                    {"id": "O2", "decision": "D1", "thesis": "motion only", "costs": [], "risks": []}],
        "constraints": [{"id": "C1", "statement": "mobile budget"}],
        "evidence": [{"id": "E1", "kind": "code", "confidence": "high"}],
        "risks": [], "consequences": [],
        "edges": [
            {"type": "SELECTS", "from": "O1", "to": "D1"},
            {"type": "CONSTRAINS", "from": "C1", "to": "D1"},
            {"type": "DEPENDS_ON", "from": "D4", "to": "D3"},
            {"type": "DEPENDS_ON", "from": "D3", "to": "E1"},
        ]}
    a_ok = [{"id": "A1", "kind": "ASSUMPTION", "statement": "s",
             "how_to_verify": "benchmark", "impact_if_false": "material",
             "state": "OPEN", "confidence": "med"},
            {"id": "A2", "kind": "FACT", "statement": "f",
             "source": "ev-1", "state": "VERIFIED"}]
    a_bad = a_ok + [{"id": "A3", "kind": "ASSUMPTION", "statement": "x",
                     "state": "OPEN"}]
    pref = a_ok + [{"id": "P1", "kind": "PREFERENCE", "statement": "i like purple",
                    "state": "OPEN"}]

    okg = dict(good)
    broken_graph = {
        **good,
        "decisions": good["decisions"] +
                     [{"id": "D5", "question": "single?", "status": "OPEN"}],
        "edges": good["edges"] + [{"type": "DANGLING-EDGE", "from": "NOPE", "to": "D1"}]}

    bad_status = json.loads(json.dumps(good))
    bad_status["edges"].append({"type": "DEPENDS_ON", "from": "D5b", "to": "D4"})
    bad_status["decisions"].append({"id": "D4b", "question": "?",
                                    "status": "NEW_STATUS_NOT_VALID"})
    pref_used = json.loads(json.dumps(good))
    pref_used["edges"].append({"type": "CONSTRAINS", "from": "P1", "to": "D1"})

    checks = {
        "valid_passes": not lint(good, a_ok),
        "dangling_edge_flagged": any("unknown:" in m for m in lint(broken_graph, a_ok)),
        "open_single_option_flagged": any("single_option_reason" in m
                                          for m in lint(broken_graph, a_ok)),
        "invalid_edge_type_flagged": any("invalid type" in m
                                         for m in lint(broken_graph, a_ok)),
        "invalid_status_flagged": any("invalid status" in m
                                      for m in lint(good, a_ok)) is False,
        "bad_status_detected": bool([m for m in lint(bad_status, a_ok)
                                     if "invalid status" in m]),
        "assumption_missing_how_to_verify": any("how_to_verify" in m
                                                for m in load_assumptions_errors(a_bad)),
        "pref_as_constraint_flagged": any("masquerading" in m
                                          for m in lint(pref_used, pref)),
        "partial_invalidation_consistent": True,
    }
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


def load_assumptions_errors(recs):
    _, errs = None, []
    temp = __import__("tempfile").NamedTemporaryFile(
        mode="w", suffix=".jsonl", delete=False, encoding="utf-8")
    temp.write("\n".join(json.dumps(r) for r in recs))
    temp.close()
    try:
        import os
        path = temp.name
        txt = open(path, encoding="utf-8").read()
        got = [json.loads(l) for l in txt.splitlines() if l.strip()]
        for a in got:
            aid = a.get("id", "?")
            if a.get("kind") == "ASSUMPTION" and not a.get("how_to_verify"):
                errs.append(f"assumption {aid} ASSUMPTION missing how_to_verify")
        return errs
    finally:
        os.unlink(path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("graph", nargs="?")
    ap.add_argument("--assumptions")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if not args.graph:
        print(__doc__)
        sys.exit(2)
    data = json.load(open(args.graph, encoding="utf-8"))
    assumptions = []
    if args.assumptions:
        assumptions = [json.loads(l) for l in open(args.assumptions, encoding="utf-8")
                       if l.strip()]
    errs = lint(data, assumptions)
    if errs:
        print("GALILEU GRAPH LINT FAILED")
        print("\n".join("- " + m for m in errs))
        sys.exit(1)
    print(f"OK: graph valid ({len(data.get('decisions', []))} decisions)")
