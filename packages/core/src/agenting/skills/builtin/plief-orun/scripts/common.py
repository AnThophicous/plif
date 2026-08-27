from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def load_json(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))

def dump_json(rel, data):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

def ids(records):
    return [r["id"] for r in records]
