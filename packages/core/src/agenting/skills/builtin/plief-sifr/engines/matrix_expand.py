#!/usr/bin/env python3
"""Responsive matrix expander - contract -> representative render steps + coverage gaps.

Usage: matrix_expand.py <responsive-contract-or-experience-ir.json> [--out FILE] [--selftest]

Rules (modules/responsive.md):
  * widths = union of viewport_matrix_hint + every region's verify_at
  * textual promises like "same as 1024" / "== 1024" force the referenced width into
    the matrix with a promise:<key>@<region> reason, even when unlisted
  * states default to populated + one-risky-state (+ long-content by default,
    states_extra appended)
  * coverage report lists any region.verify_at width x base-state pair not covered
"""
import argparse
import json
import re
import sys

BASE_STATES = ["populated", "one-risky-state"]
PROMISE_RE = re.compile(r"same\s+as\s+(\d{3,4})|==\s*(\d{3,4})")


def _rc(data):
    return data.get("responsive_contract") if isinstance(data.get("responsive_contract"), dict) else data


def expand(data):
    rc = _rc(data)
    regions = rc.get("regions") or []
    if not regions:
        raise ValueError("responsive_contract.regions empty/missing")

    widths = set(int(w) for w in rc.get("viewport_matrix_hint", []) or [])
    promises = []
    for reg in regions:
        for w in reg.get("verify_at") or []:
            widths.add(int(w))
        for key in ("mid_1024", "mid_768"):
            val = reg.get(key)
            if isinstance(val, str):
                m = PROMISE_RE.search(val)
                if m:
                    ref_w = int(m.group(1) or m.group(2))
                    promises.append((reg.get("region"), key, ref_w))
                    widths.add(ref_w)

    risky = rc.get("risky_states") or [BASE_STATES[1]]
    states = [BASE_STATES[0]] + list(risky)
    states += list(rc.get("states_extra", []))
    if rc.get("long_content_relevant", True):
        states.append("long-content")
    states = list(dict.fromkeys(states))

    promise_widths = {w for _, _, w in promises}
    steps = []
    for w in sorted(widths):
        for s in states:
            reasons = ["contracted"] if w not in promise_widths else ["promise-injected"]
            steps.append({"viewport": w, "state": s,
                          "reason": "+".join(reasons + [f"via:{k}@{r}"
                                                        for r, k, pw in promises
                                                        if pw == w])})
    seen = {(s["viewport"], s["state"]) for s in steps}
    return steps


def coverage(steps, data):
    rc = _rc(data)
    covered = {(s["viewport"], s["state"]) for s in steps}
    gaps = []
    for reg in rc.get("regions") or []:
        for w in reg.get("verify_at") or []:
            for stt in BASE_STATES:
                if (int(w), stt) not in covered:
                    gaps.append({"region": reg.get("region"),
                                 "viewport": int(w), "state": stt})
    return gaps


def selftest():
    contract = {"schema_version": 1, "regions": [
        {"region": "nav+hero", "wide": "full", "narrow_390": "stack",
         "mid_1024": "same as 1280", "verify_at": [1440]},
        {"region": "filters+table", "wide": "side-by-side", "narrow_390": "sheet",
         "verify_at": [1024, 900, 768, 390]}]}
    steps = expand(contract)
    pairs = {(s["viewport"], s["state"]) for s in steps}
    gaps = coverage(steps, contract)
    checks = {
        "promise_width_1280_injected": any(s["viewport"] == 1280
                                           and "promise-injected" in s["reason"]
                                           for s in steps),
        "all_declared_widths_present": all(any(p[0] == w for p in pairs)
                                           for w in (1440, 1024, 900, 768, 390)),
        "no_duplicate_pairs": len(pairs) == len(steps),
        "long_content_default_on": any(s[1] == "long-content" for s in pairs),
        "coverage_gaps_empty_here": gaps == [],
    }
    fake_gap_input = {"regions": [{"region": "y", "verify_at": [777]}]}
    gaps2 = coverage([], fake_gap_input)
    checks["coverage_gap_detected_when_unbacked"] = bool(gaps2)
    print(json.dumps({"steps": len(steps), "checks": checks}, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("contract", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if not args.contract:
        print(__doc__)
        sys.exit(2)
    data = json.load(open(args.contract, encoding="utf-8"))
    steps = expand(data)
    payload = {"render_steps": steps, "coverage_gaps": coverage(steps, data),
               "note": "execute rendered inspection per step via browser.render when "
                       "available; resolve coverage_gaps before verification exit "
                       "(modules/responsive.md)"}
    if args.out:
        json.dump(payload, open(args.out, "w", encoding="utf-8"), indent=2)
    else:
        print(json.dumps(payload, indent=2))
    sys.exit(0 if not payload["coverage_gaps"] else 1)
