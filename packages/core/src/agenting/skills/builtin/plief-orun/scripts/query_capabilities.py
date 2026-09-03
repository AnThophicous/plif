#!/usr/bin/env python3
"""Capability-first, deterministic retrieval for Orun's local index."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name: str) -> dict:
    return json.loads((ROOT / "knowledge" / name).read_text(encoding="utf-8-sig"))


def terms(value: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9][a-z0-9+.#/-]*", value.lower()) if len(t) > 1}


def flatten(value) -> str:
    if isinstance(value, list):
        return " ".join(flatten(v) for v in value)
    if isinstance(value, dict):
        return " ".join(flatten(v) for v in value.values())
    return str(value)


def main() -> int:
    parser = argparse.ArgumentParser(description="Resolve a frontend need into verified capability candidates.")
    parser.add_argument("query", nargs="+", help="intent and constraints")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--framework", default="", help="hard framework constraint")
    parser.add_argument("--require", action="append", default=[], help="hard term/capability constraint")
    parser.add_argument("--native", action="store_true", help="mark project-native inspection as the first route")
    parser.add_argument("--full", action="store_true", help="include complete capability records")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    query = " ".join(args.query).strip()
    qterms = terms(query + " " + args.framework + " " + " ".join(args.require))
    domains = load("capability-domains.json")["domains"]
    baseline = load("capabilities.json")
    expansion = load("capabilities-expansion.json")
    records = baseline["capabilities"] + expansion["capabilities"]
    base_graph = load("capability-graph.json")
    expansion_graph = load("capability-graph-expansion.json")
    graph_edges = base_graph["edges"] + expansion_graph["edges"]
    for domain in domains:
        extra_ids = expansion.get("domain_candidates", {}).get(domain["id"], [])
        domain["candidate_item_ids"] = list(dict.fromkeys([*domain["candidate_item_ids"], *extra_ids]))
    by_id = {r["id"]: r for r in records}
    record_terms_by_id = {record["id"]: terms(flatten(record)) for record in records}
    satisfiable_requirements = {
        requirement
        for requirement in args.require
        if any(terms(requirement).issubset(record_terms) for record_terms in record_terms_by_id.values())
    }
    domain_hits = []
    for domain in domains:
        domain_terms = terms(flatten(domain))
        hits = sorted(qterms.intersection(domain_terms))
        if hits:
            domain_hits.append((len(hits) * 8, domain, hits))
    domain_hits.sort(key=lambda x: (-x[0], x[1]["id"]))
    candidate_ids: list[str] = []
    for _, domain, _ in domain_hits:
        for cid in domain["candidate_item_ids"]:
            if cid not in candidate_ids:
                candidate_ids.append(cid)
    ranked = []
    for record in records:
        record_terms = record_terms_by_id[record["id"]]
        hits = sorted(qterms.intersection(record_terms))
        value = len(hits)
        if record["id"] in candidate_ids:
            value += 6 + max(0, len(candidate_ids) - candidate_ids.index(record["id"])) // 4
        if args.framework and not any(args.framework.lower() in f.lower() for f in record["framework_support"]):
            value -= 12
        missing = [req for req in args.require if not terms(req).issubset(record_terms)]
        if missing:
            continue
        if value > 0:
            ranked.append((value, record, hits, missing))
    ranked.sort(key=lambda x: (-x[0], x[1]["id"]))
    selected = ranked[: max(1, min(args.top_k, 8))]
    result = {
        "query": query,
        "corpus_version": f"{baseline['version']}+{expansion['version']}",
        "pipeline": ["NEED", "CAPABILITY", "CANDIDATES", "EVIDENCE", "FIT", "USE|ADAPT|COMPOSE|BUILD"],
        "native_first": args.native,
        "hard_gates_before_ranking": ["project/runtime compatibility", "SSR/client boundary", "accessibility", "license/provenance", "performance/bundle"],
        "domains": [{"id": d[1]["id"], "name": d[1]["name"], "capability_type": d[1]["capability_type"], "matched_terms": d[2]} for d in domain_hits[:4]],
        "candidates": [],
        "related_capabilities": [],
        "graph_edges_considered": [],
        "unresolved_requirements": sorted(set(args.require) - satisfiable_requirements),
        "routing": "ORUN_QUALIFIES; SIFR_SELECTS_EXPERIENCE_FIT_WHEN_VISUAL_OR_PRODUCT_DECISION_IS_MATERIAL",
    }
    for score, record, hits, missing in selected:
        if args.full:
            item = dict(record)
        else:
            item = {k: record[k] for k in ("id", "name", "category", "capabilities", "limitations", "framework_support", "SSR_constraints", "accessibility_characteristics", "performance_characteristics", "licensing", "maintenance_status", "API_stability", "integration_complexity", "best_for", "avoid_when", "alternatives", "known_conflicts", "source_evidence", "confidence", "last_verified", "volatility")}
        item["score"] = score
        item["matched_terms"] = hits[:10]
        item["missing_requirements"] = missing
        item["verification"] = "VERIFY_REQUIRED" if record["volatility"] == "HIGH" or record["confidence"] in {"LOW", "UNVERIFIED"} else "LOCAL_EVIDENCE_AVAILABLE"
        result["candidates"].append(item)
    selected_ids = {item["id"] for item in result["candidates"]}
    graph_ids = set(by_id)
    related: set[str] = set()
    considered_edges = []
    for edge in graph_edges:
        endpoints = {edge.get("from"), edge.get("to")}
        if endpoints.intersection(selected_ids):
            considered_edges.append(edge)
            for endpoint in endpoints - selected_ids:
                if endpoint in graph_ids:
                    related.add(endpoint)
    result["related_capabilities"] = sorted(related)[:12]
    result["graph_edges_considered"] = considered_edges[:16]
    if args.native:
        result["decision"] = "PROJECT_NATIVE_FIRST: inspect existing primitives/source before any external acquisition"
    elif not selected:
        result["decision"] = "BUILD_OR_ADAPT: no verified local candidate matched; do not silently weaken hard constraints"
    elif any(item["verification"] == "VERIFY_REQUIRED" for item in result["candidates"]):
        result["decision"] = "VERIFY_REQUIRED: refresh volatile source evidence before install/import/API claim"
    else:
        result["decision"] = "QUALIFIED_CANDIDATES: apply hard gates, then record USE/ADAPT/COMPOSE/BUILD"
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Capability retrieval for: {query}")
        if args.native:
            print("PROJECT_NATIVE_FIRST")
        for item in result["candidates"]:
            print(f"{item['score']:3d}  {item['id']}  {item['name']}  [{item['verification']}]")
            print(f"     {', '.join(item['capabilities'][:3])}")
        print(result["decision"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
