#!/usr/bin/env python3
"""Deterministic, selective retrieval for Sifr's design research corpus."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9][a-z0-9+#/-]*", text.lower()) if len(t) > 2}


def load() -> dict:
    """Load the baseline plus the expansion shard without changing the prompt shape."""
    base = json.loads((ROOT / "knowledge" / "design-concepts.json").read_text(encoding="utf-8-sig"))
    expansion = json.loads((ROOT / "knowledge" / "design-concepts-expansion.json").read_text(encoding="utf-8-sig"))
    base_ids = {record["id"] for record in base["concepts"]}
    expansion_ids = {record["id"] for record in expansion["concepts"]}
    if base_ids & expansion_ids:
        raise ValueError(f"design corpus id collision: {sorted(base_ids & expansion_ids)}")
    coverage_map = dict(base.get("coverage_map", {}))
    coverage_map.update(expansion.get("coverage_map", {}))
    return {
        **base,
        "version": f"{base['version']}+{expansion['version']}",
        "coverage": sorted(set(base.get("coverage", [])) | set(expansion.get("coverage", []))),
        "coverage_map": coverage_map,
        "concepts": base["concepts"] + expansion["concepts"],
        "source_registry": expansion.get("source_registry", []),
    }


def score(record: dict, query_terms: set[str]) -> tuple[int, list[str]]:
    weighted = {
        "canonical_name": 8, "aliases": 7, "category": 3,
        "core_principles": 4, "product_fit": 4, "good_use_cases": 4,
        "content_fit": 3, "visual_grammar": 2, "implementation_implications": 2,
        "common_cliches": 1, "tension_with": 1,
    }
    hits: list[str] = []
    total = 0
    for field, weight in weighted.items():
        value = record.get(field, [])
        hay = " ".join(value) if isinstance(value, list) else str(value)
        hay_tokens = tokens(hay)
        field_hits = sorted(t for t in query_terms if t in hay_tokens)
        if field_hits:
            total += weight * len(field_hits)
            hits.extend(f"{field}:{t}" for t in field_hits[:3])
    return total, hits[:8]


def main() -> int:
    parser = argparse.ArgumentParser(description="Retrieve only the Sifr design concepts relevant to an intent.")
    parser.add_argument("query", nargs="+", help="product/job/content/style intent")
    parser.add_argument("--top-k", type=int, default=4)
    parser.add_argument("--json", action="store_true", help="emit a machine-readable compact result")
    parser.add_argument("--full", action="store_true", help="include complete records; use only for targeted deep dives")
    args = parser.parse_args()
    query = " ".join(args.query).strip()
    if not query:
        parser.error("query cannot be empty")
    corpus = load()
    query_terms = tokens(query)
    ranked = []
    for record in corpus["concepts"]:
        value, reasons = score(record, query_terms)
        if value:
            ranked.append((value, record["id"], reasons, record))
    ranked.sort(key=lambda x: (-x[0], x[1]))
    selected = ranked[: max(1, min(args.top_k, 8))]
    selected_ids = {record["id"] for _, _, _, record in selected}
    related_ids: list[str] = []
    for _, _, _, record in selected:
        for relation in record.get("compatible_concepts", []) + record.get("tension_with", []):
            if relation not in selected_ids and relation not in related_ids:
                related_ids.append(relation)
    response = {
        "query": query,
        "retrieval": "selective",
        "corpus_version": corpus["version"],
        "context_budget": {"max_concepts": 4, "max_reference_objects": 8},
        "matches": [],
        "related_concepts": related_ids[:6],
        "unmatched_terms": sorted(t for t in query_terms if not any(t in tokens(str(r)) for _, _, _, r in ranked)),
        "routing": "SIFR_SYNTHESIZES_EXPERIENCE; ORUN_QUALIFIES_EXTERNAL_RUNTIME_CAPABILITIES",
    }
    for value, _, reasons, record in selected:
        if args.full:
            item = dict(record)
        else:
            item = {
                "id": record["id"],
                "canonical_name": record["canonical_name"],
                "category": record["category"],
                "core_principles": record["core_principles"],
                "visual_grammar": record["visual_grammar"],
                "product_fit": record["product_fit"],
                "good_use_cases": record["good_use_cases"],
                "bad_use_cases": record["bad_use_cases"],
                "tension_with": record["tension_with"],
                "implementation_implications": record["implementation_implications"],
                "evidence": record["evidence"],
                "confidence": record["confidence"],
                "last_verified": record["last_verified"],
            }
        item["score"] = value
        item["match_reasons"] = reasons
        response["matches"].append(item)
    if not response["matches"]:
        response["decision"] = "NO_MATCH: formulate a product-causal thesis without inventing a style record"
    elif len(response["matches"]) > 1:
        response["decision"] = "SYNTHESIS_REQUIRED: choose one dominant grammar and bound supporting concepts"
    else:
        response["decision"] = "SINGLE_CONCEPT_REVIEW: still write product cause and counter-default"
    if args.json:
        print(json.dumps(response, ensure_ascii=False, indent=2))
    else:
        print(f"Selective retrieval for: {query}")
        for item in response["matches"]:
            print(f"{item['score']:3d}  {item['id']}  {item['canonical_name']}")
            print(f"     reasons: {', '.join(item['match_reasons'])}")
        print(response["decision"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
