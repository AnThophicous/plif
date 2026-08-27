#!/usr/bin/env python3
from common import load_json
import sys, re

q = " ".join(sys.argv[1:]).strip().lower()
if not q:
    raise SystemExit("usage: query_catalog.py <intent terms>")

items = load_json("catalogs/items.json")["items"]
concepts = load_json("catalogs/concepts.json")["concepts"]

terms = set(re.findall(r"[a-z0-9][a-z0-9+.#/-]*", q))
ranked = []
for i in items:
    hay = " ".join([
        i.get("canonical_name",""), i.get("slug") or "", i.get("category") or "",
        " ".join(i.get("aliases") or []), " ".join(i.get("tags") or [])
    ]).lower()
    score = sum(1 for t in terms if t in hay)
    if score:
        ranked.append((score, i["id"], i["canonical_name"], i["source"]))

for score, iid, name, src in sorted(ranked, reverse=True)[:20]:
    print(f"{score:2d}  {iid:34s}  {src:18s}  {name}")
