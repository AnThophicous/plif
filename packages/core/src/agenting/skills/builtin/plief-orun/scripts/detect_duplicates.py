#!/usr/bin/env python3
from common import load_json
from collections import defaultdict
import re

items = load_json("catalogs/items.json")["items"]

def norm(s):
    return re.sub(r"[^a-z0-9]+","", (s or "").lower())

groups = defaultdict(list)
for i in items:
    groups[norm(i["canonical_name"])].append(i["id"])

dups = {k:v for k,v in groups.items() if k and len(v) > 1}
if not dups:
    print("No exact normalized-name duplicates.")
else:
    print("Potential duplicates:")
    for k,v in sorted(dups.items()):
        print(k, "=>", ", ".join(v))
