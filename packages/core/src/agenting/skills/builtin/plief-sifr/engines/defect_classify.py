#!/usr/bin/env python3
"""Defect classifier - dedupe/group symptoms, propose owners, anti-thrash guard.

Usage:
  defect_classify.py observations.jsonl|json [--out FILE]
  defect_classify.py guard --history history.json [--selftest]

Observed defect record fields: {symptom, occurrences?, owner?, note?, viewports?}
Owner enum fixed: PRODUCT STRUCTURE DESIGN_DNA TOKEN COMPONENT STATE
                  RESPONSIVE ACCESSIBILITY PERFORMANCE CONTENT
The script proposes/mechanizes; human judgment overrides accepted guesses.
"""
import argparse
import json
import re
import sys

OWNERS = ["PRODUCT", "STRUCTURE", "DESIGN_DNA", "TOKEN", "COMPONENT",
          "STATE", "RESPONSIVE", "ACCESSIBILITY", "PERFORMANCE", "CONTENT"]

LOOKUP = [
    (r"\b(focus|keyboard|aria|screen.?reader|announce)\b", "ACCESSIBILITY"),
    (r"\bcontrast\b|\bunreadable text\b|\bgrey.?on.?grey\b", "TOKEN"),
    (r"page[- ]level.*scroll|\bh[- ]?scroll\b|horizontal overflow page", "RESPONSIVE"),
    (r"\b(modal|sheet|drawer)\b.*(overflow|break)", "STRUCTURE"),
    (r"\b(loading|stale|racing|double[- ]submit|resurrect)\b", "STATE"),
    (r"\b(slow|jank|lcp|hydration|bundle size)\b", "PERFORMANCE"),
    (r"identical radius|glass everywhere|provider look|generic (ui|layout)|icon family mix",
     "DESIGN_DNA"),
    (r"\b(typo|wrong copy|placeholder content|lorem)\b", "CONTENT"),
]


def normalize(symptom):
    s = symptom.lower().strip()
    s = re.sub(r"[^a-z0-9\s.]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    display = s
    # numeric tokens collapse to '#' so viewport/px variants of one defect share a group
    key = re.sub(r"\b\d+(?:\.\d+)?(?:px|%)?\b", "#", s)
    key = re.sub(r"#", "#", re.sub(r"\s+", " ", key)).strip()
    return key, display


def propose_owner(obs, grouped):
    explicit = obs.get("owner")
    if explicit in OWNERS:
        return explicit
    text = obs.get("symptom", "").lower() + " " + str(obs.get("note", "")).lower()
    for rx, owner in LOOKUP:
        if re.search(rx, text):
            return owner
    if grouped or int(obs.get("occurrences", 1)) >= 10:
        return "TOKEN"      # mass repetition across instances = systemic value owner first guess
    return "COMPONENT"


def classify(records):
    groups = {}
    for obs in records:
        key, display = normalize(str(obs.get("symptom")))
        g = groups.setdefault(key, {"symptom_key": key, "display": display,
                                    "occurrences": 0,
                                    "viewports": set(), "evidence": []})
        g["occurrences"] += int(obs.get("occurrences", 1))
        if obs.get("viewports"):
            g["viewports"].update(obs["viewports"])
        if obs.get("note"):
            g["evidence"].append(str(obs["note"])[:120])
    out = []
    for g in groups.values():
        grouped = len(g["viewports"]) > 1 or g["occurrences"] >= 10
        rec = {
            "group_id": "grp-" + re.sub(r"\s+", "-", g["symptom_key"])[:60],
            "symptom": g["display"],
            "occurrences": g["occurrences"],
            "grouped_systemic": grouped,
            "owner_candidate": propose_owner({"owner": None,
                                              "note": " ".join(g["evidence"]),
                                              "symptom": g["display"]}, grouped),
            "viewports": sorted(g["viewports"]),
            "severity_hint": ("critical" if ACCESS_IMPAIR.search(g["display"])
                              else "high" if grouped else "medium"),
        }
        out.append(rec)
    return sorted(out, key=lambda r: -r["occurrences"])


ACCESS_IMPAIR = re.compile(r"unreachable|cannot navigate|focus lost|blocked task")


def repair_guard(history):
    """history: [{group_id, attempt_no:int, owner:str, outcome:'fixed'|'failed'}]"""
    blocked = []
    per_group = {}
    for h in history:
        per_group.setdefault(h["group_id"], []).append(h)
    for gid, rows in per_group.items():
        failed_same_owner = 0
        last_owner = None
        streak_owner = None
        streak_count = 0
        for r in sorted(rows, key=lambda x: x.get("attempt_no", 0)):
            if r.get("outcome") != "fixed":
                if r.get("owner") == streak_owner:
                    streak_count += 1
                else:
                    streak_owner, streak_count = r.get("owner"), 1
                if streak_count >= 2:
                    blocked.append({"group_id": gid,
                                    "blocked_owner": streak_owner,
                                    "rule": ">=2 failed patches same owner/different-attempt cycle",
                                    "requirement": "change strategy/layer; escalate mode"})
    return blocked


def selftest():
    obs = ([{"symptom": "cards have identical radius and elevation everywhere",
             "occurrences": 12, "viewports": ["1440", "390"],
             "note": "twelve cards share one systemic cause"}] +
           [{"symptom": "Focus lost after closing modal", "occurrences": 1}] +
           [{"symptom": "page-level horizontal scroll at 768px", "occurrences": 2},
            {"symptom": "page-level horizontal scroll at 900px", "occurrences": 2}])
    recs = classify(obs)
    cards = next(r for r in recs if "identical radius" in r["symptom"])
    checks = {
        "merged_scroll_group": sum(1 for r in recs
                                   if r["symptom"].startswith("page level")) == 1,
        "mass_repetition_flagged": cards["grouped_systemic"] is True,
        "design_dna_owner_for_cards": cards["owner_candidate"] == "DESIGN_DNA",
        "a11y_owner_for_focus": next(r for r in recs
                                     if "focus lost" in r["symptom"]).get(
                                         "owner_candidate") == "ACCESSIBILITY",
        "fallback_token_when_grouped_unmatched": propose_owner(
            {"symptom": "something odd happens", "occurrences": 50,
             "note": ""}, True) == "TOKEN",
    }
    hist = [{"group_id": "g1", "attempt_no": 1, "owner": "TOKEN", "outcome": "failed"},
            {"group_id": "g1", "attempt_no": 2, "owner": "TOKEN", "outcome": "failed"}]
    blocked = repair_guard(hist)
    checks["repeat_cycle_blocked"] = len(blocked) == 1
    hist_ok = [{"group_id": "g2", "attempt_no": 1, "owner": "TOKEN", "outcome": "failed"},
               {"group_id": "g2", "attempt_no": 2, "owner": "COMPONENT", "outcome": "failed"}]
    checks["different_owner_not_blocked"] = repair_guard(hist_ok) == []
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("input", nargs="?")
    ap.add_argument("--history")
    ap.add_argument("--out")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if args.history:
        hist = json.load(open(args.history, encoding="utf-8"))
        print(json.dumps({"blocked_cycles": repair_guard(hist)}, indent=2))
        sys.exit(0)
    if not args.input:
        print(__doc__)
        sys.exit(2)
    raw = open(args.input, encoding="utf-8").read()
    records = ([json.loads(l) for l in raw.splitlines() if l.strip()]
               if args.input.endswith(".jsonl") else json.loads(raw))
    result = classify(records)
    dst = args.out or ".plif/artifacts/defect-report.json"
    import os
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    json.dump({"schema_version": 1, "groups": result}, open(dst, "w", encoding="utf-8"), indent=2)
    print(f"{len(result)} group(s); repeat-cycle guard not evaluated without --history")
