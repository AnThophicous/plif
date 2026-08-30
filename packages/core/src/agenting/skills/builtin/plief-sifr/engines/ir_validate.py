#!/usr/bin/env python3
"""ExperienceIR validator. Spec: plief-sifr/kernel/experience-state.md.

Usage: ir_validate.py <experience-ir.json> [--dna design-dna.json]
                      [--strict-visual] [--selftest]
Exit 0 valid / 1 errors / 2 usage. Structural only: art-direction judgment
remains with Sifr and rendered verification.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

PF_KEYS = [
    "who", "job", "primary_action", "density", "frequency",
    "risk_level", "device_profile", "surface_type", "success_state",
]
DNA_KEYS = [
    "geometry_law", "spacing_rhythm", "container_law", "radius_law",
    "border_law", "elevation_law", "type_roles", "chroma_budget",
    "icon_family", "motion_character", "signature_move", "counter_default",
]
STRICT_DNA_KEYS = [
    "direction", "tone", "density", "experience_archetype", "visual_thesis",
    "composition_law", "material_light_law", "asset_world",
]
MEDIA_KEYS = [
    "id", "role", "medium", "purpose", "source", "loading",
    "accessibility", "performance", "fallback",
]
MOTION_KEYS = ["purpose", "hierarchy", "sequences", "reduced_motion"]
SEQUENCE_KEYS = [
    "id", "trigger", "purpose", "beats", "interruption", "settlement",
    "reduced_motion",
]
NUM_RE = re.compile(r"(kb|ms)$")


def _missing(obj, keys):
    return [key for key in keys if key not in obj]


def validate(ir):
    errs = []

    def add(message):
        errs.append(message)

    if ir.get("schema_version") != 1:
        add("schema_version must be 1")

    pf = ir.get("product_frame") or {}
    for key in PF_KEYS:
        if key not in pf:
            add(f"product_frame.{key} missing (null allowed)")

    ia = ir.get("information_architecture")
    if not isinstance(ia, dict):
        add("information_architecture section required")
    else:
        obligations = ia.get("info_obligations")
        needed = (
            "must_see_before_action", "must_remain_visible", "reveal_on_demand",
        )
        if not isinstance(obligations, dict) or any(
            key not in obligations for key in needed
        ):
            add(f"info_obligations must contain {needed}")

    components = ir.get("component_graph") or []
    component_ids = set()
    for component in components:
        cid = component.get("component") or component.get("id")
        if not cid:
            add("component_graph entry without component/id")
        elif cid in component_ids:
            add(f"duplicate component_graph id {cid}")
        component_ids.add(cid)
        source = str(component.get("source", ""))
        contract_ref = component.get("contract_ref") or ""
        if not isinstance(component.get("contract"), dict):
            if contract_ref and contract_ref.endswith(".json"):
                if not os.path.exists(contract_ref):
                    add(f"component '{cid}' contract file not found: {contract_ref}")
        is_transplant = source == "transplant" or source.startswith("transplant:")
        if is_transplant and not component.get("invariant"):
            add(f"transplant component '{cid}' needs invariant statement")
        if source == "transplant" and not component.get("source_record_ref"):
            add(f"transplant component '{cid}' needs source_record_ref")

    interaction_graph = ir.get("interaction_graph") or []
    for transition in interaction_graph:
        states = set(transition.get("states", []))
        next_state = transition.get("next_state") or (
            transition.get("transition") or {}
        ).get("next_state")
        if states and next_state and next_state not in states:
            add(f"interaction transition to undeclared state '{next_state}'")
        if not transition.get("event"):
            add("interaction entry without event")

    motion = ir.get("motion")
    if motion is not None:
        if not isinstance(motion, dict):
            add("motion must be an object")
        else:
            missing = _missing(motion, MOTION_KEYS)
            if missing:
                add(f"motion missing fields: {', '.join(missing)}")
            for sequence in motion.get("sequences", []) or []:
                if not isinstance(sequence, dict):
                    add("motion sequence must be an object")
                    continue
                seq_missing = _missing(sequence, SEQUENCE_KEYS)
                if seq_missing:
                    add(
                        f"motion sequence '{sequence.get('id', '?')}' missing: "
                        + ", ".join(seq_missing)
                    )

    media_contracts = ir.get("media_contracts")
    if media_contracts is not None:
        if not isinstance(media_contracts, list):
            add("media_contracts must be an array")
        else:
            media_ids = set()
            for media in media_contracts:
                if not isinstance(media, dict):
                    add("media_contract entry must be an object")
                    continue
                missing = _missing(media, MEDIA_KEYS)
                if missing:
                    add(
                        f"media '{media.get('id', '?')}' missing: "
                        + ", ".join(missing)
                    )
                mid = media.get("id")
                if mid in media_ids:
                    add(f"duplicate media_contract id {mid}")
                if mid:
                    media_ids.add(mid)
                medium = media.get("medium")
                if medium == "video":
                    policy = media.get("video_policy")
                    if not isinstance(policy, dict):
                        add(f"video media '{mid}' needs video_policy")
                    else:
                        if policy.get("autoplay") and not policy.get("muted"):
                            add(f"video media '{mid}' cannot autoplay with audio")
                        if policy.get("ambient") is False and not policy.get("controls"):
                            add(f"content-bearing video media '{mid}' needs controls")
                if medium in {"shader", "3d"}:
                    if not isinstance(media.get("runtime"), dict):
                        add(f"{medium} media '{mid}' needs runtime contract")
                    fallback = media.get("fallback") or {}
                    if not fallback.get("non_gpu"):
                        add(f"{medium} media '{mid}' needs non-GPU fallback")
                    performance = media.get("performance") or {}
                    for field in ("frame_budget_ms", "dpr_cap", "offscreen_pause"):
                        if field not in performance:
                            add(f"{medium} media '{mid}' performance.{field} missing")

    responsive = ir.get("responsive_contract") or {}
    for region in responsive.get("regions", []) or []:
        if not region.get("region"):
            add("responsive region without name")
        widths = region.get("verify_at") or []
        if not widths or not all(isinstance(width, int) and width > 0 for width in widths):
            add(f"region '{region.get('region')}' needs integer widths in verify_at")
        wide = str(region.get("wide", ""))
        narrow = str(region.get("narrow_390", ""))
        middle = [width for width in widths if 700 <= width <= 1100]
        if wide and narrow and wide != narrow and not middle:
            add(
                f"region '{region.get('region')}' changes composition but declares no "
                "intermediate width (700-1100) - unreachable transformation proof"
            )

    perf_budget = ir.get("perf_budget") or {}
    for key, value in perf_budget.items():
        if value is None:
            continue
        if NUM_RE.search(key) and (
            not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0
        ):
            add(f"perf_budget.{key} must be a non-negative number or null")
    for key in ("initial_js_kb", "animation_cap_ms", "gpu_frame_ms"):
        value = perf_budget.get(key)
        if value is not None and isinstance(value, (int, float)) and not isinstance(value, bool):
            if value <= 0:
                add(f"perf_budget.{key} must be positive when declared")
    max_dpr = perf_budget.get("max_dpr")
    if max_dpr is not None and (
        not isinstance(max_dpr, (int, float))
        or isinstance(max_dpr, bool)
        or max_dpr <= 0
    ):
        add("perf_budget.max_dpr must be a positive number or null")

    if not isinstance(ir.get("accessibility_contract"), dict):
        add("accessibility_contract object required")
    return errs


def validate_dna(dna, strict=False):
    keys = DNA_KEYS + (STRICT_DNA_KEYS if strict else [])
    errs = [f"dna.{key} missing" for key in keys if key not in dna]
    type_roles = dna.get("type_roles")
    if type_roles is not None and not isinstance(type_roles, list):
        errs.append("dna.type_roles must be a list")
    thesis = dna.get("visual_thesis")
    if strict and (not isinstance(thesis, str) or len(thesis.strip()) < 12):
        errs.append("dna.visual_thesis must be a specific non-empty thesis")
    return errs


def validate_schema_integrity():
    """Check local schema dialect declarations, IDs and resolvable internal refs."""
    schema_dir = Path(__file__).resolve().parent.parent / "schemas"
    schemas = {}
    errs = []
    for path in schema_dir.glob("*.json"):
        try:
            schema = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as exc:
            errs.append(f"schema {path.name} unreadable: {exc}")
            continue
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            errs.append(f"schema {path.name} must declare JSON Schema draft 2020-12")
        schema_id = schema.get("$id")
        if not schema_id:
            errs.append(f"schema {path.name} missing $id")
        elif schema_id in schemas:
            errs.append(f"duplicate schema $id {schema_id}")
        else:
            schemas[schema_id] = (path, schema)

    def refs(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key == "$ref" and isinstance(value, str):
                    yield value
                else:
                    yield from refs(value)
        elif isinstance(node, list):
            for value in node:
                yield from refs(value)

    for _, (path, schema) in schemas.items():
        for ref in refs(schema):
            target = ref.split("#", 1)[0]
            if not target or target.startswith(("http://", "https://")):
                continue
            if target.startswith(("./", "../")):
                if not (path.parent / target).resolve().exists():
                    errs.append(f"schema {path.name} unresolved relative $ref {ref}")
            elif target not in schemas:
                errs.append(f"schema {path.name} unresolved internal $ref {ref}")
    return errs


def _sample_ir(**overrides):
    ir = {
        "schema_version": 1,
        "product_frame": {key: None for key in PF_KEYS},
        "information_architecture": {
            "navigation_model": "persistent-global",
            "info_obligations": {
                "must_see_before_action": [],
                "must_remain_visible": [],
                "reveal_on_demand": [],
            },
        },
        "component_graph": [
            {
                "component": "nav",
                "source": "native",
                "contract": {"variant_axes": ["intent"]},
            }
        ],
        "interaction_graph": [
            {"states": ["idle", "open"], "event": "click", "next_state": "open"}
        ],
        "responsive_contract": {
            "regions": [
                {
                    "region": "filters+table",
                    "wide": "side-by-side",
                    "narrow_390": "stacked",
                    "verify_at": [1024, 900, 768, 390],
                    "ownership": "table owns h-overflow",
                }
            ]
        },
        "perf_budget": {"initial_js_kb": 170, "animation_cap_ms": 16},
        "accessibility_contract": {"reduced_motion": True},
    }
    ir.update(overrides)
    return ir


def _valid_media(medium="image"):
    media = {
        "id": "hero-media",
        "role": "identity",
        "medium": medium,
        "purpose": "make the product material legible",
        "source": {"provenance": "project", "license_status": "project-owned"},
        "loading": {"priority": "critical", "dimensions_reserved": True},
        "accessibility": {"equivalent": "poster", "reduced_motion": "static"},
        "performance": {},
        "fallback": {"failure": "poster", "unsupported": "poster"},
    }
    if medium == "video":
        media["video_policy"] = {
            "ambient": True,
            "autoplay": True,
            "muted": True,
            "controls": False,
        }
    if medium in {"shader", "3d"}:
        media["runtime"] = {"engine": "verified-engine"}
        media["fallback"]["non_gpu"] = "static poster"
        media["performance"] = {
            "frame_budget_ms": 16.7,
            "dpr_cap": 2,
            "offscreen_pause": True,
        }
    return media


def selftest():
    checks = {
        "valid_sample_passes": not validate(_sample_ir()),
        "a11y_object_required": bool(validate(_sample_ir(accessibility_contract=None))),
        "transition_outside_states": bool(
            validate(
                _sample_ir(
                    interaction_graph=[
                        {"states": ["idle"], "event": "x", "next_state": "ghost"}
                    ]
                )
            )
        ),
        "no_mid_width_on_change": bool(
            validate(
                _sample_ir(
                    responsive_contract={
                        "regions": [
                            {
                                "region": "r",
                                "wide": "grid",
                                "narrow_390": "stack",
                                "verify_at": [1440, 390],
                            }
                        ]
                    }
                )
            )
        ),
        "bad_perf_number": bool(
            validate(_sample_ir(perf_budget={"initial_js_kb": "big"}))
        ),
        "transplant_needs_invariant": bool(
            validate(
                _sample_ir(
                    component_graph=[
                        {"component": "c", "source": "transplant:rec-1"}
                    ]
                )
            )
        ),
        "structured_transplant_needs_record_ref": bool(
            validate(
                _sample_ir(
                    component_graph=[
                        {
                            "component": "c",
                            "source": "transplant",
                            "invariant": "preserve compact command transition",
                        }
                    ]
                )
            )
        ),
        "valid_video_contract_passes": not validate(
            _sample_ir(media_contracts=[_valid_media("video")])
        ),
        "gpu_fallback_required": bool(
            validate(
                _sample_ir(
                    media_contracts=[
                        {
                            **_valid_media("shader"),
                            "fallback": {"failure": "blank", "unsupported": "blank"},
                        }
                    ]
                )
            )
        ),
        "autoplay_audio_rejected": bool(
            validate(
                _sample_ir(
                    media_contracts=[
                        {
                            **_valid_media("video"),
                            "video_policy": {
                                "ambient": True,
                                "autoplay": True,
                                "muted": False,
                                "controls": False,
                            },
                        }
                    ]
                )
            )
        ),
        "valid_motion_contract_passes": not validate(
            _sample_ir(
                motion={
                    "purpose": "preserve spatial continuity",
                    "hierarchy": {
                        "signature_sequence": None,
                        "recurring_motifs": ["shared-axis"],
                        "microfeedback": ["selection settlement"],
                    },
                    "sequences": [
                        {
                            "id": "open-detail",
                            "trigger": "select row",
                            "purpose": "keep object identity",
                            "beats": ["acknowledge", "travel", "settle"],
                            "interruption": "reverse from current value",
                            "settlement": "detail focused",
                            "reduced_motion": "instant replace plus focus",
                        }
                    ],
                    "reduced_motion": "remove spatial travel",
                }
            )
        ),
        "strict_dna_requires_art_direction": bool(
            validate_dna({key: None for key in DNA_KEYS}, strict=True)
        ),
        "strict_dna_complete_passes": not validate_dna(
            {
                **{key: "defined" for key in DNA_KEYS},
                **{key: "defined" for key in STRICT_DNA_KEYS},
                "density": "balanced",
                "type_roles": ["body"],
                "visual_thesis": "Operational urgency shapes a decisive visual path.",
            },
            strict=True,
        ),
        "schema_dialect_and_refs_valid": not validate_schema_integrity(),
    }
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ir", nargs="?")
    parser.add_argument("--dna")
    parser.add_argument("--strict-visual", action="store_true")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if not args.ir:
        print(__doc__)
        sys.exit(2)
    if args.strict_visual and not args.dna:
        print("--strict-visual requires --dna")
        sys.exit(2)

    with open(args.ir, encoding="utf-8") as handle:
        data = json.load(handle)
    errs = validate(data)
    if args.dna:
        with open(args.dna, encoding="utf-8") as handle:
            dna = json.load(handle)
        errs += validate_dna(dna, strict=args.strict_visual)
    if errs:
        print("EXPERIENCE IR INVALID")
        print("\n".join("- " + error for error in errs))
        sys.exit(1)
    suffix = "+ strict DNA" if args.strict_visual else "+ DNA" if args.dna else ""
    print(f"OK: experience IR {suffix} valid".replace("  ", " "))


if __name__ == "__main__":
    main()
