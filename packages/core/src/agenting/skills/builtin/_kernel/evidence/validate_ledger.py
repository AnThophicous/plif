#!/usr/bin/env python3
"""Evidence Ledger validator - canonical rules from _kernel/evidence/ledger.md.

Usage: validate_ledger.py <evidence.jsonl|file.json> | --selftest
Exit 0 = valid, 1 = errors found, 2 = usage error.
"""
import json
import re
import sys

STATES = {"VERIFIED", "INFERRED", "ASSUMED", "UNKNOWN", "CONTRADICTED", "STALE"}
PROV_KINDS = {"code", "config", "test", "runtime", "web", "user", "model-inference", "artifact"}
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?")


def _req(rec, idx):
    errs = []
    for f in ("id", "claim", "state", "provenance", "captured_at"):
        if not rec.get(f) and f != "provenance":
            errs.append(f"[{idx}] missing required field: {f}")
    if not isinstance(rec.get("provenance"), list) or not rec["provenance"]:
        errs.append(f"[{idx}] provenance must be a non-empty array")
    else:
        for p in rec["provenance"]:
            if not isinstance(p, dict) or p.get("kind") not in PROV_KINDS or not p.get("ref"):
                errs.append(f"[{idx}] provenance entries need kind in {sorted(PROV_KINDS)} and ref")
                break
    if rec.get("state") not in STATES:
        errs.append(f"[{idx}] invalid state: {rec.get('state')!r}")
    if rec.get("captured_at") and not ISO_RE.match(str(rec["captured_at"])):
        errs.append(f"[{idx}] captured_at is not ISO-like")
    if rec.get("state") == "VERIFIED" and not rec.get("verification_method"):
        errs.append(f"[{idx}] VERIFIED requires verification_method")
    if rec.get("state") == "CONTRADICTED" and not rec.get("contradicts"):
        errs.append(f"[{idx}] CONTRADICTED requires contradicts[]")
    return errs


def validate(records):
    errs = []
    ids = {}
    for i, rec in enumerate(records):
        errs += _req(rec, i)
        rid = rec.get("id")
        if rid:
            if rid in ids:
                errs.append(f"[{i}] duplicate id: {rid}")
            ids[rid] = set(rec.get("contradicts", []))
    for rid, cons in ids.items():
        for other in cons:
            if other not in ids:
                errs.append(f"{rid} contradicts unknown id {other}")
            elif rid not in ids[other]:
                errs.append(f"contradiction asymmetry: {rid}->{other} but {other} does not list {rid}")
    return errs


def _load(path):
    text = open(path, encoding="utf-8").read()
    if path.endswith(".jsonl"):
        return [json.loads(l) for l in text.splitlines() if l.strip()]
    data = json.loads(text)
    return data if isinstance(data, list) else [data]


def selftest():
    ok = [
        {"id": "ev-1", "claim": "login uses HttpOnly cookie",
         "state": "VERIFIED", "verification_method": "code read src/auth/session.ts#L41",
         "provenance": [{"kind": "code", "ref": "src/auth/session.ts#L41"}],
         "captured_at": "2026-08-26T12:00:00Z", "contradicts": ["ev-2"]},
        {"id": "ev-2", "claim": "claims session instead", "state": "CONTRADICTED",
         "contradicts": ["ev-1"], "provenance": [{"kind": "config", "ref": "docs/auth.md"}],
         "captured_at": "2026-08-26T12:00:00Z"},
        {"id": "ev-3", "claim": "ev-1 source mutated", "state": "STALE",
         "stale_if": ["sha:src/auth/session.ts"],
         "provenance": [{"kind": "artifact", "ref": ".plif/artifacts/t1/evidence.jsonl"}],
         "captured_at": "2026-08-27T09:00:00Z"},
    ]
    dup = {"id": "z", "claim": "second z later", "state": "UNKNOWN",
           "provenance": [{"kind": "model-inference", "ref": "chat"}],
           "captured_at": "2026-08-26T00:00:00Z"}
    bad = [
        {"id": "x", "claim": "no method", "state": "VERIFIED",
         "provenance": [{"kind": "user", "ref": "chat"}], "captured_at": "2026-08-26T00:00Z"},
        dict(ok[0]),
        dict(dup),
        dup,
        {"id": "y", "claim": "", "state": "MAYBE", "provenance": [],
         "captured_at": "not-a-date"},
    ]
    e_ok, e_bad = validate(ok), validate(bad)
    checks = {
        "valid_sample_passes": not e_ok,
        "ver_requires_method_flagged": any("VERIFIED requires" in m for m in e_bad),
        "duplicate_id_flagged": any("duplicate id" in m for m in e_bad),
        "invalid_state_flagged": any("invalid state" in m for m in e_bad),
    }
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    try:
        records = _load(sys.argv[1])
    except Exception as exc:  # noqa: BLE001
        print(f"LOAD ERROR: {exc}")
        sys.exit(1)
    errs = validate(records)
    if errs:
        print("EVIDENCE LEDGER INVALID")
        for e in errs:
            print("-", e)
        sys.exit(1)
    print(f"OK: {len(records)} evidence records valid")
