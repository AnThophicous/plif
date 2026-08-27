#!/usr/bin/env python3
from pathlib import Path
import json, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]

required = [
    "SKILL.md","core/brain.md","core/memory.md","core/eyes.md","core/hands.md","core/judge.md",
    "catalogs/sources.json","catalogs/items.json","catalogs/concepts.json","catalogs/relationships.json",
    "rules/source-verification.md","rules/animation-routing.md","workflows/update-knowledge.md"
]
missing = [p for p in required if not (ROOT/p).exists()]
if missing:
    print("Missing:", *missing, sep="\n- ")
    raise SystemExit(1)

skill = (ROOT/"SKILL.md").read_text(encoding="utf-8")
for needle in ["Pli'ef Orun","OFFICIAL SOURCE > LOCAL INDEX > MODEL MEMORY","BRAIN → MEMORY → EYES → HANDS → JUDGE"]:
    if needle not in skill:
        raise SystemExit(f"SKILL.md missing invariant: {needle}")

sources = json.loads((ROOT/"catalogs/sources.json").read_text(encoding="utf-8"))["sources"]
ids = {s["id"] for s in sources}
expected = {
"origin-ui","mvpblocks","shsf-ui","kibo-ui","skiper-ui","magic-ui","bklit-ui","kokonut-ui",
"watermelon-ui","originkit","aceternity-ui","uiverse","motion","animejs","gsap","transitions-dev",
"rive","threejs","img2threejs","getlayers","framer-community","awwwards"
}
if ids != expected:
    raise SystemExit(f"source coverage mismatch: missing={expected-ids}, extra={ids-expected}")

result = subprocess.run([sys.executable, str(ROOT/"scripts/validate_catalog.py")], cwd=str(ROOT/"scripts"), text=True)
if result.returncode:
    raise SystemExit(result.returncode)

print("Pli'ef Orun smoke test: OK")
