#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = json.loads((ROOT / "knowledge" / "design-concepts.json").read_text(encoding="utf-8-sig"))
EXPANSION = json.loads((ROOT / "knowledge" / "design-concepts-expansion.json").read_text(encoding="utf-8-sig"))
SCHEMA = json.loads((ROOT / "knowledge" / "design-concepts.schema.json").read_text(encoding="utf-8-sig"))


def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def main() -> int:
    required = set(SCHEMA["required"])
    concepts = BASE["concepts"] + EXPANSION["concepts"]
    assert len(concepts) >= 100, f"expected material breadth, got {len(concepts)}"
    assert len({c["id"] for c in concepts}) == len(concepts)
    assert len({norm(c["canonical_name"]) for c in concepts}) == len(concepts), "duplicate semantic canonical names"
    aliases = {}
    for concept in BASE["concepts"]:
        for alias in concept["aliases"]:
            aliases.setdefault(norm(alias), set()).add(concept["id"])
    expansion_aliases = {}
    for concept in EXPANSION["concepts"]:
        for alias in concept["aliases"]:
            expansion_aliases.setdefault(norm(alias), set()).add(concept["id"])
            assert norm(alias) not in aliases, f"expansion alias shadows baseline term: {alias}"
    assert all(len(owners) == 1 for owners in expansion_aliases.values()), "ambiguous expansion alias ownership"
    assert "deduplication" in EXPANSION and isinstance(EXPANSION["deduplication"].get("rejected_aliases"), list)
    concept_ids = {c["id"] for c in concepts}
    coverage_map = {**BASE["coverage_map"], **EXPANSION["coverage_map"]}
    assert all(cid in concept_ids for refs in coverage_map.values() for cid in refs), "coverage map has dangling concept"
    assert EXPANSION["coverage_semantics"] == "INDEX_OF_IMPLEMENTED_KNOWLEDGE", "coverage semantics must be explicit"
    expansion_coverage_ids = {cid for refs in EXPANSION["coverage_map"].values() for cid in refs}
    assert expansion_coverage_ids >= {c["id"] for c in EXPANSION["concepts"]}, "coverage omits expansion concept"
    for concept in concepts:
        missing = required - set(concept)
        assert not missing, f"{concept['id']} missing {sorted(missing)}"
        assert len(concept["historical_context"]) >= 40
        for field in ("core_principles", "visual_grammar", "implementation_implications"):
            assert len(concept[field]) >= 2, f"shallow {concept['id']}:{field}"
        assert concept["reference_texts"] and concept["visual_references"]
        for ref in concept["reference_texts"] + concept["visual_references"]:
            assert ref["url"].startswith("http") and ref["demonstrates"]
        assert concept["evidence"] and concept["last_verified"]
    extra = {"selection_rule", "distinguish_from", "modern_translation", "control_rule", "freshness", "tags"}
    for concept in EXPANSION["concepts"]:
        assert extra <= set(concept), f"{concept['id']} missing expansion guidance"
        assert all(len(concept[key]) >= 2 for key in ("selection_rule", "distinguish_from", "modern_translation", "control_rule"))
        assert concept["freshness"] and concept["tags"]
    script = ROOT / "scripts" / "query_design_concepts.py"
    result = subprocess.run([sys.executable, str(script), "data dense incident operations", "--json"], capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    assert payload["retrieval"] == "selective"
    assert payload["matches"]
    assert any("dark-data-dense" == item["id"] for item in payload["matches"])
    result = subprocess.run([sys.executable, str(script), "minimalist editorial landing", "--json"], capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    assert payload["decision"].startswith("SYNTHESIS") or payload["decision"].startswith("SINGLE")
    unique = len({norm(c["canonical_name"]) for c in concepts})
    print(f"OK: {len(concepts)} raw design records, {unique} unique canonical concepts, complete guidance, references and selective retrieval")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
