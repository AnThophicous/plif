#!/usr/bin/env python3
from common import load_json
from pathlib import Path
import sys

VALID_STATUS = {"VERIFIED_CURRENT","VERIFIED_BUT_VERSION_UNKNOWN","STALE","UNVERIFIED","DEPRECATED","REMOVED"}
VALID_CONF = {"HIGH","MEDIUM","LOW"}
VALID_REL = {"implements","depends_on","requires","alternative_to","compatible_with","conflicts_with","extends","belongs_to","succeeded_by","legacy_of","inspired_by"}

errors = []

sources = load_json("catalogs/sources.json")["sources"]
items = load_json("catalogs/items.json")["items"]
concepts = load_json("catalogs/concepts.json")["concepts"]
rels = load_json("catalogs/relationships.json")["relationships"]

def unique(label, records):
    seen = set()
    for r in records:
        rid = r.get("id")
        if not rid:
            errors.append(f"{label}: missing id")
        elif rid in seen:
            errors.append(f"{label}: duplicate id {rid}")
        seen.add(rid)
    return seen

source_ids = unique("source", sources)
item_ids = unique("item", items)
concept_ids = unique("concept", concepts)

for s in sources:
    if s.get("verification_status") not in VALID_STATUS:
        errors.append(f"source {s.get('id')}: invalid verification_status")
    if s.get("confidence") not in VALID_CONF:
        errors.append(f"source {s.get('id')}: invalid confidence")
    if not s.get("official_source"):
        errors.append(f"source {s.get('id')}: official_source missing")
    if not s.get("evidence"):
        errors.append(f"source {s.get('id')}: evidence empty")

for i in items:
    if i.get("source") not in source_ids:
        errors.append(f"item {i.get('id')}: unknown source {i.get('source')}")
    if i.get("verification_status") not in VALID_STATUS:
        errors.append(f"item {i.get('id')}: invalid verification_status")
    if i.get("confidence") not in VALID_CONF:
        errors.append(f"item {i.get('id')}: invalid confidence")
    if i.get("install") and i.get("confidence") == "LOW":
        errors.append(f"item {i.get('id')}: executable install command with LOW confidence")

all_nodes = source_ids | item_ids | concept_ids | {"coss-ui-lineage","motion","threejs","rive","bklit-ui"}
for r in rels:
    if r.get("type") not in VALID_REL:
        errors.append(f"relationship: invalid type {r.get('type')}")
    if r.get("from") not in all_nodes:
        errors.append(f"relationship: unknown from {r.get('from')}")
    if r.get("to") not in all_nodes:
        errors.append(f"relationship: unknown to {r.get('to')}")

for c in concepts:
    for iid in c.get("implementation_ids", []):
        if iid not in item_ids:
            errors.append(f"concept {c.get('id')}: unknown implementation {iid}")

if errors:
    print("VALIDATION FAILED")
    for e in errors:
        print("-", e)
    sys.exit(1)

print(f"OK: {len(sources)} sources, {len(items)} items, {len(concepts)} concepts, {len(rels)} relationships")
