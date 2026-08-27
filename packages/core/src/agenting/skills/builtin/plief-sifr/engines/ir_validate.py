#!/usr/bin/env python3
"""ExperienceIR validator. Spec: plief-sifr/kernel/experience-state.md.

Usage: ir_validate.py <experience-ir.json> [--dna design-dna.json] [--selftest]
Exit 0 valid / 1 errors / 2 usage. Structural only - semantic judgment stays human/model.
"""
import argparse
import json
import os
import re
import sys

PF_KEYS = ["who", "job", "primary_action", "density", "frequency",
           "risk_level", "device_profile", "surface_type", "success_state"]
DNA_KEYS = ["geometry_law", "spacing_rhythm", "container_law", "radius_law",
            "border_law", "elevation_law", "type_roles", "chroma_budget",
            "icon_family", "motion_character", "signature_move", "counter_default"]
NUM_RE = re.compile(r"(kb|ms)$")


def validate(ir):
    errs = []

    def add(m):
        errs.append(m)

    if ir.get("schema_version") != 1:
        add("schema_version must be 1")
    pf = ir.get("product_frame") or {}
    for k in PF_KEYS:
        if k not in pf:
            add(f"product_frame.{k} missing (null allowed)")
    ia = ir.get("information_architecture")
    if not isinstance(ia, dict):
        add("information_architecture section required")
    else:
        ob = ia.get("info_obligations")
        need = ("must_see_before_action", "must_remain_visible", "reveal_on_demand")
        if not isinstance(ob, dict) or any(k not in ob for k in need):
            add(f"info_obligations must contain {need}")
    comps = ir.get("component_graph") or []
    ids = set()
    for c in comps:
        cid = c.get("component") or c.get("id")
        if not cid:
            add("component_graph entry without component/id")
        elif cid in ids:
            add(f"duplicate component_graph id {cid}")
        ids.add(cid)
        src = str(c.get("source", ""))
        ref = c.get("contract_ref") or ""
        if isinstance(c.get("contract"), dict):
            pass
        elif ref and ref.endswith(".json"):
            if not os.path.exists(ref):
                add(f"component '{cid}' contract file not found: {ref}")
        if src.startswith("transplant:") and not c.get("invariant"):
            add(f"transplant component '{cid}' needs invariant statement")
    igraph = ir.get("interaction_graph") or []
    for t in igraph:
        states = set(t.get("states", []))
        nxt = t.get("next_state") or (t.get("transition") or {}).get("next_state")
        if states and nxt and nxt not in states:
            add(f"interaction transition to undeclared state '{nxt}'")
        if not t.get("event"):
            add("interaction entry without event")
    rc = ir.get("responsive_contract") or {}
    for reg in rc.get("regions", []) or []:
        if not reg.get("region"):
            add("responsive region without name")
        va = reg.get("verify_at") or []
        if not va or not all(isinstance(w, int) and w > 0 for w in va):
            add(f"region '{reg.get('region')}' needs integer widths in verify_at")
        wide, narrow = str(reg.get("wide", "")), str(reg.get("narrow_390", ""))
        mids = [w for w in va if 700 <= w <= 1100]
        if wide and narrow and wide != narrow and not mids:
            add(f"region '{reg.get('region')}' changes composition but declares no intermediate "
                f"width (700-1100) - unreachable transformation proof")
        if "overflow-owner" in str(reg.get("ownership", "")) and not reg.get("ownership"):
            pass
    pb = ir.get("perf_budget") or {}
    for k, v in pb.items():
        if NUM_RE.search(k) and (not isinstance(v, (int, float)) or v <= 0):
            add(f"perf_budget.{k} must be a positive number")
    if "accessibility_contract" not in ir:
        add("accessibility_contract section required")
    return errs


def validate_dna(dna):
    errs = [f"dna.{k} missing" for k in DNA_KEYS if k not in dna]
    tr = dna.get("type_roles")
    if tr is not None and not isinstance(tr, list):
        errs.append("dna.type_roles must be a list")
    return errs


def _sample_ir(**over):
    ir = {
        "schema_version": 1,
        "product_frame": {k: None for k in PF_KEYS},
        "information_architecture": {
            "navigation_model": "persistent-global",
            "info_obligations": {"must_see_before_action": [], "must_remain_visible": [],
                                 "reveal_on_demand": []}},
        "component_graph": [{"component": "nav", "source": "native",
                             "contract": {"variant_axes": ["intent"]}}],
        "interaction_graph": [{"states": ["idle", "open"], "event": "click",
                               "next_state": "open"}],
        "responsive_contract": {
            "regions": [{"region": "filters+table", "wide": "side-by-side",
                         "narrow_390": "stacked",
                         "verify_at": [1024, 900, 768, 390],
                         "ownership": "table owns h-overflow"}]},
        "perf_budget": {"initial_js_kb": 170, "animation_cap_ms": 16},
        "accessibility_contract": {"reduced_motion": True},
    }
    ir.update(over)
    return ir


def selftest():
    good = validate(_sample_ir())
    bad_cases = {
        "missing_a11y_section": validate(_sample_ir(accessibility_contract=None)
                                        ) if False else _broken(),
        "transition_outside_states": validate(_sample_ir(
            interaction_graph=[{"states": ["idle"], "event": "x", "next_state": "ghost"}])),
        "no_mid_width_on_change": validate(_sample_ir(responsive_contract={
            "regions": [{"region": "r", "wide": "grid", "narrow_390": "stack",
                         "verify_at": [1440, 390]}]})),
        "bad_perf_number": validate(_sample_ir(perf_budget={"initial_js_kb": "big"})),
        "transplant_needs_invariant": validate(_sample_ir(component_graph=[
            {"component": "c", "source": "transplant:rec-1"}])),
    }
    broken = bad_cases.pop("missing_a11y_section")
    checks = {"valid_sample_passes": not good, "a11y_required": bool(broken)}
    for k, errs in bad_cases.items():
        checks[k] = bool(errs)
    dna_bad = validate_dna({"signature_move": None})
    checks["dna_missing_keys_flagged"] = bool([e for e in dna_bad if "missing" in e])
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


def _broken():
    ir = _sample_ir()
    del ir["accessibility_contract"]
    return validate(ir)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ir", nargs="?")
    ap.add_argument("--dna")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if not args.ir:
        print(__doc__)
        sys.exit(2)
    data = json.load(open(args.ir, encoding="utf-8"))
    errs = validate(data)
    if args.dna:
        errs += validate_dna(json.load(open(args.dna, encoding="utf-8")))
    if errs:
        print("EXPERIENCE IR INVALID")
        print("\n".join("- " + e for e in errs))
        sys.exit(1)
    print(f"OK: experience IR {'+ DNA ' if args.dna else ''}valid")


if __name__ == "__main__":
    main()
