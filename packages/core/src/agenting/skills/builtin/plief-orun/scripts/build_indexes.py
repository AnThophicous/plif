#!/usr/bin/env python3
from common import load_json, dump_json
import re

items = load_json("catalogs/items.json")["items"]
concepts = load_json("catalogs/concepts.json")["concepts"]

def tokens(*parts):
    text = " ".join(str(p) for p in parts if p)
    return sorted(set(re.findall(r"[a-z0-9][a-z0-9+.#/-]*", text.lower())))

by_term = {}
by_source = {}
by_tag = {}

for i in items:
    by_source.setdefault(i["source"], []).append(i["id"])
    for t in i.get("tags", []):
        by_tag.setdefault(t.lower(), []).append(i["id"])
    ts = tokens(i["canonical_name"], i.get("slug"), i.get("category"), i.get("description"), *(i.get("aliases") or []), *(i.get("tags") or []))
    for t in ts:
        by_term.setdefault(t, []).append(i["id"])

concept_terms = {}
for c in concepts:
    for t in tokens(c["name"], *(c.get("intent_terms") or []), *(c.get("dimensions") or [])):
        concept_terms.setdefault(t, []).append(c["id"])

for d in (by_term, by_source, by_tag, concept_terms):
    for k, v in d.items():
        d[k] = sorted(set(v))

dump_json("indexes/items-by-term.json", by_term)
dump_json("indexes/items-by-source.json", by_source)
dump_json("indexes/items-by-tag.json", by_tag)
dump_json("indexes/concepts-by-term.json", concept_terms)
print("Indexes rebuilt.")
