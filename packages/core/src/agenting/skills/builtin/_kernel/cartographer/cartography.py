#!/usr/bin/env python3
"""Repo Cartographer scanner. Spec: _kernel/cartographer/spec.md

Usage:
  cartography.py <root> [--out FILE] [--depth fast|standard] [--selftest]
Stdlib-only; static mechanical scan; heuristics tagged INFERRED.
"""
import argparse
import hashlib
import json
import os
import sys
import tempfile

SKIP_DIRS = {"node_modules", ".git", "dist", "build", "coverage", "__pycache__", ".next", "vendor"}

FRAMEWORK_HINTS = {
    "react": ("react",), "vue": ("vue",), "svelte": ("svelte",),
    "angular": ("@angular/core",), "next.js": ("next",),
    "vite": ("vite",), "express": ("express",), "fastapi": ("fastapi",),
    "django": ("django",), "flask": ("flask",), "tailwindcss": ("tailwindcss",),
}

LOCKFILES = {"package-lock.json": "npm", "yarn.lock": "yarn", "pnpm-lock.yaml": "pnpm",
             "bun.lockb": "bun", "poetry.lock": "poetry", "Pipfile.lock": "pipenv"}


def walk(root):
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel = os.path.relpath(dirpath, root)
        for fn in filenames:
            p = os.path.join(rel, fn) if rel != "." else fn
            files.append(p.replace("\\", "/"))
    return sorted(files)


def fingerprint(files_with_size):
    h = hashlib.sha256()
    for rel, size in files_with_size:
        h.update(f"{rel}:{size}\n".encode())
    return h.hexdigest()


def classify(files, root):
    fl = set(files)

    def has(p):
        return p in fl

    stack = {"languages": [], "frameworks": [], "package_manager": None,
             "lockfile": None, "typescript": None, "build_tooling": [], "_inferred": []}
    pkg = os.path.join(root, "package.json")
    if has("package.json") or os.path.exists(pkg):
        try:
            data = json.load(open(pkg, encoding="utf-8"))
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
            langs = {"javascript"}
            stack["typescript"] = has("tsconfig.json")
            if stack["typescript"]:
                langs.add("typescript")
            stack["languages"] = sorted(langs)
            stack["_inferred"].append("framework detection INFERRED from dependency names")
            for name, hints in FRAMEWORK_HINTS.items():
                if any(h in deps for h in hints):
                    ver = next((deps[h] for h in hints if h in deps), None)
                    stack["frameworks"].append({"name": name, "version_hint": ver,
                                                "confidence": "INFERRED"})
                    if name == "typescript":
                        stack["languages"] = sorted(set(stack["languages"]) | {"typescript"})
            for script in ("vite.config.ts", "webpack.config.js", "rspack.config.ts"):
                if has(script):
                    stack["build_tooling"].append(script)
        except Exception as exc:  # noqa: BLE001
            stack["_inferred"].append(f"package.json unreadable: {exc}")
    if has("requirements.txt") or has("pyproject.toml"):
        stack["languages"].append("python")
        for fw, sig in (("fastapi", "fastapi"), ("django", "django"), ("flask", "flask")):
            txt = ""
            for cand in ("requirements.txt",):
                if has(cand):
                    txt = open(os.path.join(root, cand), encoding="utf-8", errors="ignore").read().lower()
            if sig in txt:
                stack["frameworks"].append({"name": fw, "confidence": "INFERRED"})
    for lock, pm in LOCKFILES.items():
        if has(lock):
            stack["lockfile"], stack["package_manager"] = lock, pm
            break

    styling = {"token_files": [], "strategy_hints": [], "confidence": "INFERRED"}
    for f in files:
        base = os.path.basename(f).lower()
        if "token" in base and base.endswith((".css", ".scss", ".ts", ".js")):
            styling["token_files"].append(f)
        if base == "tailwind.config.js" or base == "tailwind.config.ts":
            styling["strategy_hints"].append("tailwind")
    tests = {"dirs": sorted({f.split("/")[0] for f in files
                             if f.split("/")[0] in ("tests", "test", "__tests__", "src/tests")})}
    routes = []
    if has("app") and isinstance(stack.get("_dir_flags"), dict):
        pass
    # cheap route directory heuristics
    top_dirs = {f.split("/")[0] for f in files}
    if "app" in top_dirs and any(f.startswith(("app/",)) for f in files):
        routes.append({"type": "app-router-dir", "confidence": "INFERRED"})
    if "pages" in top_dirs:
        routes.append({"type": "pages-router-dir", "confidence": "INFERRED"})
    ci = {"by_extension": {}, "top_level_dirs": sorted(top_dirs)[:20]}
    exts = {}
    for f in files:
        _, ext = os.path.splitext(f)
        if ext:
            exts[ext] = exts.get(ext, 0) + 1
    ci["by_extension"] = dict(sorted(exts.items(), key=lambda kv: -kv[1])[:10])
    return stack, styling, tests, routes, ci


def build_map(root, depth="standard"):
    files = walk(root)
    withsize = [(f, os.path.getsize(os.path.join(root, f))) for f in files]
    stack, styling, tests, routes, ci = classify(files, root)
    ext_integrations = [f for f in files if f.endswith((".env.example",))
                        or ("docker-compose" in os.path.basename(f))]
    store_candidates = [f for f in files
                        if f.endswith((".db", ".sqlite"))
                        or os.path.basename(f) in ("schema.prisma",)]
    m = {
        "schema_version": 1,
        "meta": {"repo_fingerprint": fingerprint(withsize),
                 "built_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                 "depth": depth, "coverage_note":
                 "standard static scan; dynamic runtime not covered" if depth == "standard"
                 else "fast scan"},
        "stack_profile": stack,
        "packages": [{"path": d, "confidence": "INFERRED"}
                     for d in {os.path.dirname(f) for f in files
                               if f.endswith("package.json") and os.path.dirname(f)}],
        "entry_points": [], "routes": routes,
        "styling_system": styling,
        "component_inventory": ci,
        "data_stores": [{"ref": f, "confidence": "INFERRED"} for f in store_candidates],
        "external_integrations": [{"ref": f, "confidence": "INFERRED"} for f in ext_integrations],
        "tests_owners": tests,
        "conventions": {},
    }
    return m


def selftest():
    with tempfile.TemporaryDirectory() as td:
        for path, content in (
            ("package.json", '{"dependencies":{"react":"19","next":"15"}}'),
            ("tsconfig.json", "{}"),
            ("app/page.tsx", "export default function P(){return <div/>}"),
            ("src/styles/tokens.css", ":root{}"),
            ("package-lock.json", "{}"),
            ("src/ui/button.tsx", "import React from 'react';"),
        ):
            full = os.path.join(td, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            open(full, "w", encoding="utf-8").write(content)
        m1, m2 = build_map(td), build_map(td)
        checks = {
            "stable_fingerprint": m1["meta"]["repo_fingerprint"] == m2["meta"]["repo_fingerprint"],
            "react_inferred": any(f["name"] == "react" for f in m1["stack_profile"]["frameworks"]),
            "next_inferred": any(f["name"] == "next.js" for f in m1["stack_profile"]["frameworks"]),
            "npm_pm": m1["stack_profile"]["package_manager"] == "npm",
            "tokens_found": bool(m1["styling_system"]["token_files"]),
            "tsx_counted": m1["component_inventory"]["by_extension"].get(".tsx", 0) >= 2,
        }
        print(json.dumps(checks, indent=2))
        return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--depth", default="standard", choices=["fast", "standard"])
    args = ap.parse_args()
    if not args.root:
        print(__doc__)
        sys.exit(2)
    mapping = build_map(args.root, args.depth)
    out = args.out or os.path.join(args.root, ".plif", "artifacts", "repository-map.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(mapping, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"WROTE {out} fingerprint={mapping['meta']['repo_fingerprint'][:12]}...")
