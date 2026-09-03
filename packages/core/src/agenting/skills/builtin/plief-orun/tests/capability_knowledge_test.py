#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    data = json.loads((ROOT / "knowledge" / "capabilities.json").read_text(encoding="utf-8-sig"))
    expansion = json.loads((ROOT / "knowledge" / "capabilities-expansion.json").read_text(encoding="utf-8-sig"))
    domains = json.loads((ROOT / "knowledge" / "capability-domains.json").read_text(encoding="utf-8-sig"))["domains"]
    graph = json.loads((ROOT / "knowledge" / "capability-graph.json").read_text(encoding="utf-8-sig"))
    expansion_graph = json.loads((ROOT / "knowledge" / "capability-graph-expansion.json").read_text(encoding="utf-8-sig"))
    records = data["capabilities"] + expansion["capabilities"]
    curated = [r for r in expansion["capabilities"] if "catalog_item_id" not in r]
    catalog_records = [r for r in expansion["capabilities"] if "catalog_item_id" in r]
    required = {"id", "name", "canonical_source", "official_docs", "capabilities", "limitations", "framework_support", "SSR_constraints", "accessibility_characteristics", "performance_characteristics", "source_evidence", "confidence", "last_verified", "volatility"}
    assert len(records) >= 150, f"expected material capability breadth, got {len(records)}"
    assert len({r["id"] for r in records}) == len(records)
    assert len({re.sub(r"[^a-z0-9]+", "", r["name"].lower()) for r in records}) == len(records), "duplicate semantic capability names"
    assert len(curated) >= 80 and len(catalog_records) >= 70, "expansion lost curated depth or catalog coverage"
    assert len(expansion["source_registry"]) >= 40, "official source registry is unexpectedly thin"
    for record in records:
        assert required <= set(record), f"{record['id']} missing fields"
        assert len(record["capabilities"]) >= 2 and len(record["limitations"]) >= 1
        assert record["official_docs"].startswith("http") and record["source_evidence"]
        assert all(e["url"].startswith("http") and len(e["claim"]) >= 20 for e in record["source_evidence"])
        assert len(record["best_for"]) >= 2 and len(record["avoid_when"]) >= 2
    domain_ids = {d["id"] for d in domains}
    for record in curated:
        assert {"selection_rule", "avoid_rule", "domain_owner", "evidence_requirements", "freshness", "tags"} <= set(record)
        assert record["domain_owner"] in domain_ids
    for record in catalog_records:
        assert record["catalog_snapshot"]["id"] == record["catalog_item_id"]
        assert record["confidence"] == "LOW" and record["freshness"] == "VERIFY_REQUIRED_BEFORE_USE"
    ids = {r["id"] for r in records}
    assert all(cid in ids for d in domains for cid in d["candidate_item_ids"]), "domain has dangling candidate"
    expansion_ids = {r["id"] for r in expansion["capabilities"]}
    assert all(cid in expansion_ids for refs in expansion["domain_candidates"].values() for cid in refs)
    graph_ids = {node["id"] for node in graph["nodes"]} | {node["id"] for node in expansion_graph["nodes"]}
    all_edges = graph["edges"] + expansion_graph["edges"]
    assert all(edge["from"] in graph_ids and edge["to"] in graph_ids for edge in all_edges)
    assert len(all_edges) >= 300 and len(expansion_graph["edges"]) >= 250
    script = ROOT / "scripts" / "query_capabilities.py"
    result = subprocess.run([sys.executable, str(script), "accessible sortable data table", "--framework", "React", "--json"], capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    assert payload["pipeline"][:3] == ["NEED", "CAPABILITY", "CANDIDATES"]
    assert payload["candidates"] and any(c["id"] == "tanstack-table" for c in payload["candidates"])
    result = subprocess.run([sys.executable, str(script), "interactive 3d product scene", "--json"], capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    assert payload["candidates"] and payload["decision"].startswith("VERIFY_REQUIRED")
    assert payload["related_capabilities"] and payload["graph_edges_considered"]
    result = subprocess.run([sys.executable, str(script), "unknown internal primitive", "--native", "--json"], capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    assert payload["native_first"] and payload["decision"].startswith("PROJECT_NATIVE_FIRST")
    print(f"OK: {len(data['capabilities'])} baseline + {len(curated)} curated + {len(catalog_records)} catalog records, {len(domains)} domains, {len(all_edges)} graph edges")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
