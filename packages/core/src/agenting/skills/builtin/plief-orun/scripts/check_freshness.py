#!/usr/bin/env python3
from common import load_json
from datetime import date, datetime

today = date.today()
sources = load_json("catalogs/sources.json")["sources"]

# This is a triage signal, not a replacement for source-specific volatility.
for s in sources:
    try:
        checked = datetime.strptime(s["last_verified"], "%Y-%m-%d").date()
        age = (today - checked).days
    except Exception:
        print(f"UNKNOWN {s.get('id')}: invalid last_verified")
        continue
    if s["verification_status"] in {"UNVERIFIED","STALE","DEPRECATED","REMOVED"}:
        print(f"REVIEW {s['id']}: {s['verification_status']} ({age}d)")
    elif age > 90:
        print(f"STALE? {s['id']}: last checked {age}d ago")
    elif age > 30:
        print(f"AGING {s['id']}: last checked {age}d ago")
print("Freshness triage complete.")
