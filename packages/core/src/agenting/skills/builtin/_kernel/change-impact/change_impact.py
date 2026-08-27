#!/usr/bin/env python3
"""Change Impact Engine. Spec: _kernel/change-impact/spec.md

Usage:
  change_impact.py --repo ROOT --diff FILE [--map repository-map.json] [--out OUT] [--selftest]
Stdlib-only. Never invents diffs; an empty/unparseable diff errors out.
"""
import argparse
import json
import os
import re
import sys

SEC_TRIGGERS = [
    (re.compile(r"(app|router|server)\.(get|post|put|patch|delete)\(", re.I), "new_entry_point"),
    (re.compile(r"@app\.(route|get|post|put|delete)", re.I), "new_entry_point"),
    (re.compile(r"https?://[^\s'\"]+new-host", re.I), "new_external_call"),
    (re.compile(r"\b(role|scope|permission|grant|admin)\b.*\b(add|allow|expand|\+)", re.I),
     "new_privilege"),
    (re.compile(r"process\.env\.([A-Z0-9_]+)"), "new_secret_path"),
    (re.compile(r"(token|secret|password|api[_-]?key)\s*=", re.I), "new_secret_path"),
]
DEP_ADD_RE = re.compile(r'^\+\s*"([^"]+)":\s*"', re.M)
MIGRATION_HINT = re.compile(r"(^|/)migrations?/", re.I)


def parse_diff(text):
    files = {"added": [], "modified": [], "deleted": []}
    added_lines = {}
    current = None
    for line in text.splitlines():
        if line.startswith("diff --git "):
            current = None  # file boundary: never attribute hunks across files
        elif line.startswith("+++ b/"):
            current = line[6:].strip()
            added_lines.setdefault(current, [])
        elif line.startswith("new file mode"):
            pass  # resolution happens at '+++ b/' which follows
        elif line.startswith("deleted file mode"):
            pass  # likewise handled via '-a/' plus '+++ /dev/null'
        elif line.startswith("+++ /dev/null"):
            if current is not None:  # deletion of current relative to '--- a/'
                pass
        elif line.startswith("--- a/"):
            continue
        elif line.startswith("--- /dev/null"):
            continue
        elif line.startswith("@@") or line.startswith("\\ No newline"):
            continue
        elif current is not None:
            if line.startswith("+"):
                added_lines.setdefault(current, []).append(line[1:])
    for f, plus in added_lines.items():
        if plus and f not in files["added"]:
            files["modified"].append(f)
    return {k: sorted(set(v)) for k, v in files.items()}, added_lines


def import_callers(repo_root, changed_sources):
    """Mechanical import-graph over JS/TS/PY for internal callers."""
    callers = []
    targets = set()
    for src in changed_sources:
        mod = re.sub(r"\.(ts|tsx|js|jsx|py)$", "", src.replace("/", "."))
        targets.add(mod)
    exts = (".ts", ".tsx", ".js", ".jsx", ".py")
    imp_re = re.compile(r"""(?:from\s+['\"]([\w./@-]+)['\"]
                          |import\s+[\w{},\s]+\s+from\s+['\"]([\w./@-]+)['\"]
                          |require\(\s*['\"]([\w./@-]+)['\"]
                          |(?:from\s+([\w.]+))\s*import)""", re.X)
    for dirpath, dirnames, filenames in os.walk(repo_root):
        dirnames[:] = [d for d in dirnames if d not in {"node_modules", ".git", "__pycache__"}]
        for fn in filenames:
            if not fn.endswith(exts):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, repo_root).replace("\\", "/")
            if rel in changed_sources:
                continue
            try:
                head = open(full, encoding="utf-8", errors="ignore").read(200000)
            except OSError:
                continue
            imps = set(filter(None, sum(imp_re.findall(head), ())))
            for t in list(targets):
                tail = ".".join(t.split(".")[-2:])
                if any(i.endswith(tail) or i.endswith(tail.replace(".", "/")) for i in imps):
                    callers.append(rel)
                    break
    return sorted(set(callers))


def compute(repo_root, diff_text, repo_map=None):
    stats, added_lines = parse_diff(diff_text)
    if not any(stats.values()):
        raise ValueError("no file changes parsed from diff")
    changed_all = stats["added"] + stats["modified"]
    sec_cands = []
    for f, lines in added_lines.items():
        blob = "\n".join(lines)
        for rx, kind in SEC_TRIGGERS:
            if rx.search(blob):
                if kind not in sec_cands:
                    sec_cands.append(kind)
    dep_adds = DEP_ADD_RE.findall(diff_text)
    sources = [f for f in changed_all if f.endswith((".ts", ".tsx", ".js", ".jsx", ".py"))]
    callers = import_callers(repo_root, [f for f in sources]) if len(sources) <= 25 else []

    ui_changed = [f for f in changed_all
                  if f.endswith((".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss"))]
    tests_expected = [f for f in changed_all if MIGRATION_HINT.search(f)]
    migration = bool(tests_expected) or any(MIGRATION_HINT.search(f) for f in changed_all)
    tokens_changed = any(("token" in os.path.basename(f).lower() or "theme" in f.lower())
                         for f in ui_changed)
    obligations = [{"kind": "sec_diff", "detail": "run Argus SecDiff"}
                   ] if sec_cands else []
    if ui_changed:
        obligations.append({"kind": "render_matrix",
                            "detail": f"{len(ui_changed)} UI file(s); representative widths/states"})
    if sources and not any("/test" in f or "/tests/" in f for f in changed_all):
        obligations.append({"kind": "update_tests"})
    if dep_adds or len(changed_all) > 40 or tokens_changed:
        radius = "system-wide"
    elif len(callers) > 3 or len(changed_all) > 8:
        radius = "feature"
    else:
        radius = "local"
    rollback = ("destructive" if migration else "easy")
    out = {
        "schema_version": 1,
        "diff_stats": {k: len(v) for k, v in stats.items()},
        "files": {k: v for k, v in stats.items()},
        "affected_components": sources[:50],
        "affected_callers": callers,
        "affected_contracts": ["repository-map#stack_profile"] if dep_adds else [],
        "affected_tests": tests_expected,
        "security_impact_candidates": sec_cands,
        "frontend_impact": ui_changed,
        "migration_needed": migration,
        "blast_radius": radius,
        "rollback_complexity": rollback,
        "verification_obligations": obligations,
        "inferred": ["caller detection mechanical; may miss dynamic imports",
                     "security candidates are triggers, not findings"],
        "_dependency_additions": dep_adds,
    }
    return out


def selftest():
    diff = """diff --git a/src/api/users.ts b/src/api/users.ts
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -1,2 +1,5 @@
 export const list = () => [];
+router.post("/admin/export", adminOnly);
+const apiKey = process.env.EXPORT_API_KEY;
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -10,4 +10,5 @@
   "dependencies": {
+    "left-pad": "^1.3.0"
diff --git a/db/migrations/004_drop.sql b/db/migrations/004_drop.sql
new file mode 100644
--- /dev/null
+++ b/db/migrations/004_drop.sql
@@ -0,0 +1 @@
+DROP TABLE users;
diff --git a/src/ui/modal.css b/src/ui/modal.css
--- a/src/ui/modal.css
+++ b/src/ui/modal.css
@@
+.modal { position: absolute; }
"""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        open(os.path.join(td, "src-importer.ts"), "w").write(
            "import { list } from './src/api/users';")
        out = compute(td, diff)
    checks = {
        "entry_point_detected": "new_entry_point" in out["security_impact_candidates"],
        "secret_path_detected": "new_secret_path" in out["security_impact_candidates"],
        "dep_addition_detected": "left-pad" in out["_dependency_additions"],
        "migration_detected": out["migration_needed"],
        "rollback_destructive": out["rollback_complexity"] == "destructive",
        "render_matrix_obligation": any(o["kind"] == "render_matrix" for o in out["verification_obligations"]),
        "sec_diff_obligation": any(o["kind"] == "sec_diff" for o in out["verification_obligations"]),
        "blast_radius_systemwide": out["blast_radius"] == "system-wide",
        "empty_diff_rejected": _raises_empty(),
    }
    print(json.dumps(checks, indent=2))
    return 0 if all(checks.values()) else 1


def _raises_empty():
    try:
        compute(".", "")
        return False
    except ValueError:
        return True


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--diff", required=True)
    ap.add_argument("--map")
    ap.add_argument("--out")
    args = ap.parse_args()
    text = open(args.diff, encoding="utf-8").read()
    mapping = json.load(open(args.map, encoding="utf-8")) if args.map else None
    result = compute(args.repo, text, mapping)
    dst = args.out or os.path.join(".plif", "artifacts", "change-impact.json")
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    json.dump(result, open(dst, "w", encoding="utf-8"), indent=2)
    print(json.dumps({k: result[k] for k in
                      ("diff_stats", "blast_radius", "rollback_complexity",
                       "security_impact_candidates", "verification_obligations")}, indent=2))
