#!/usr/bin/env python3
"""Packaging conformance - E0 eval layer for the PLI'EF tree.

Usage: package_conformance.py [<root>] [--config FILE] [--strict]
Checks manifests, reference resolution, schema parse-ability, no-silent-shared-
fallback, banned phrase budgets, eval case integrity. Exit 0 = conformant.
"""
import argparse
import fnmatch
import json
import os
import re
import sys

DEFAULT_CONFIG = {
    "package_marker": "SKILL.md",
    "required_manifest_fields": ["name", "slug", "version", "artifacts"],
    "artifact_subfields": ["produced", "consumed"],
    "banned_phrases": [
        {"phrase": "standalone core capsule", "max_global": 1},
    ],
    # retired family brand tokens; word-boundary regex, case-insensitive.
    # files containing the exemption marker (retired-name quote) are allowed,
    # e.g. skill-creator quoting the ban itself
    "banned_tokens": ["\\bspyx\\b", "\\bdme\\b", "\\bspynx\\b"],
    "banned_token_exempt_marker": "(retired-name quote)",
    # mentions of the retired shared contract are legal only under these prefixes
    "shared_contract_prefixes": ["shared/", "legacy/"],
    "shared_contract_files": ["CORE_CONTRACT.md", "DESIGN_LANGUAGE_ATLAS.md"],
    "ignore_link_patterns": ["^https?://", "^mailto:", "^#", "^\\.plif/",
                             "^_backup", "^\\.zip$"],
    "eval_case_required": ["id", "prompt", "must", "must_not", "critical"]
}

MD_LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
PATHLIKE = re.compile(r"`([\w./\\-]+\.(?:md|json|py|mjs|js))`")


def load_config(root):
    cfg_file = os.path.join(root, "_kernel", "conformance.config.json")
    if os.path.exists(cfg_file):
        return {**DEFAULT_CONFIG, **json.load(open(cfg_file, encoding="utf-8-sig"))}
    return dict(DEFAULT_CONFIG)


def iter_packages(root, marker):
    out = []
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if not os.path.isdir(full):
            continue
        if os.path.exists(os.path.join(full, marker)):
            out.append(entry)
    return out


def rel_resolve(base_dir, link):
    link = link.split("#")[0]
    p = os.path.normpath(os.path.join(base_dir, link))
    return p


def check_package(pkg_name, pkg_root, root, cfg, errs):
    mf = os.path.join(pkg_root, "manifest.json")
    if not os.path.exists(mf):
        errs.append(f"{pkg_name}: missing manifest.json")
        return []
    try:
        man = json.load(open(mf, encoding="utf-8-sig"))
    except Exception as exc:  # noqa: BLE001
        errs.append(f"{pkg_name}: manifest unparseable ({exc})")
        return []
    for f in cfg["required_manifest_fields"]:
        if f not in man:
            errs.append(f"{pkg_name}.manifest: missing required field '{f}'")
    arts = man.get("artifacts") or {}
    for f in cfg["artifact_subfields"]:
        if f not in arts:
            errs.append(f"{pkg_name}.manifest.artifacts: missing '{f}'")

    ref_errs = []
    for dirpath, dirnames, filenames in os.walk(pkg_root):
        dirnames[:] = [d for d in dirnames if d not in {"node_modules", "__pycache__"}]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel_pkg = os.path.relpath(full, pkg_root).replace("\\", "/")
            text = open(full, encoding="utf-8", errors="ignore").read()

            links = MD_LINK.findall(text)
            if fn.endswith(".md"):
                for link in links:
                    if any(re.search(p, link) for p in cfg["ignore_link_patterns"]):
                        continue
                    target = rel_resolve(os.path.dirname(full), link.replace("/", os.sep))
                    if not os.path.exists(target):
                        ref_errs.append(f"{pkg_name}:{rel_pkg} broken md link -> {link}")

                if any(s in text.lower() for s in cfg["shared_contract_files"]):
                    if not any(rel_pkg.startswith(pref) for pref in ("../shared/",)):
                        inside_shared = os.path.relpath(full, root).replace("\\", "/").startswith("shared/")
                        # retired pointer packages no longer exist as facades; only
                        # shared/ itself may legitimately name the legacy files
                        is_facade = "/legacy/" in full
                        if not inside_shared and not is_facade and "historical" not in text[:400].lower():
                            for token in cfg["shared_contract_files"]:
                                if token in text and "`" + token + "`" in text:
                                    ref_errs.append(
                                        f"{pkg_name}:{rel_pkg} references shared/{token} "
                                        "without 'historical' marker (silent fallback risk)")
    # declared schemas must parse
    for sch in man.get("schemas", []) or []:
        sp = os.path.join(pkg_root, sch.replace("/", os.sep))
        if not os.path.exists(sp):
            ref_errs.append(f"{pkg_name}: declared schema missing: {sch}")
        elif sch.endswith(".json"):
            try:
                json.load(open(sp, encoding="utf-8-sig"))
            except Exception as exc:  # noqa: BLE001
                ref_errs.append(f"{pkg_name}: schema {sch} unparseable ({exc})")
    errs += ref_errs
    return ref_errs


def check_banned_phrases(root, cfg, exclude=("legacy",), errs=None):
    counts = {}
    details = []
    banned_paths_by_phrase = {p["phrase"].lower(): p for p in cfg["banned_phrases"]}
    skip_dirs = {"node_modules", "__pycache__", ".git"}
    for dirpath, dirnames, filenames in os.walk(root):
        parts = set(fnmatch.filter(dirpath.replace("\\", "/").split("/"), "*"))
        top = os.path.relpath(dirpath, root).replace("\\", "/").split("/")[0]
        if top.startswith(("_backup", "_pli_ef_vnext")) or os.path.basename(dirpath) in skip_dirs:
            continue
        if len(exclude) and top == "legacy":
            continue
        for fn in filenames:
            if not fn.endswith((".md", ".py", ".mjs")):
                continue
            full = os.path.join(dirpath, fn)
            text = open(full, encoding="utf-8", errors="ignore").read().lower()
            for phrase in banned_paths_by_phrase:
                n = text.count(phrase)
                if n:
                    counts[phrase] = counts.get(phrase, 0) + n
                    details.append(f"{os.path.relpath(full, root)} x{n}")
    errs2 = []
    for p in cfg["banned_phrases"]:
        c = counts.get(p["phrase"].lower(), 0)
        if "max_global" in p and p["max_global"] is not None and c > p["max_global"]:
            errs2.append(f"banned phrase over budget: {p['phrase']!r} {c}>{p['max_global']} "
                         f"in {details}")
    return errs2


def check_eval_cases(root, cfg, errs):
    n = 0
    for dirpath, dirnames, filenames in os.walk(root):
        if "/_backup" in dirpath.replace("\\", "/") or "\\_backup" in dirpath:
            continue
        if os.path.basename(dirpath) != "cases" or os.path.basename(os.path.dirname(dirpath)) != "evals":
            continue
        for fn in filenames:
            if not fn.endswith(".json"):
                continue
            n += 1
            try:
                data = json.load(open(os.path.join(dirpath, fn), encoding="utf-8-sig"))
            except Exception as exc:  # noqa: BLE001
                errs.append(f"eval case unparseable {fn}: {exc}")
                continue
            recs = data.get("cases", data if isinstance(data, list) else [])
            for c in recs if isinstance(recs, list) else []:
                for f in cfg["eval_case_required"]:
                    if f not in c:
                        errs.append(f"eval case {fn}/{c.get('id','?')}: missing field '{f}'")
    return n


def check_banned_tokens(root, cfg):
    errs = []
    pat = re.compile("|".join(cfg["banned_tokens"]), re.I)
    skip = {"node_modules", "__pycache__", ".git"}
    for dirpath, dirnames, filenames in os.walk(root):
        if any(s in dirpath for s in ("_backup", "_pli_ef_vnext")):
            continue
        dirnames[:] = [d for d in dirnames if d not in skip]
        for fn in filenames:
            if not fn.endswith((".md", ".py", ".mjs", ".json", ".html", ".js")):
                continue
            full = os.path.join(dirpath, fn)
            text = open(full, encoding="utf-8", errors="ignore").read()
            if cfg["banned_token_exempt_marker"] in text:
                continue
            for m in pat.finditer(text):
                rel = os.path.relpath(full, root).replace("\\", "/")
                errs.append(f"retired token {m.group(0)!r} at {rel}")
                break
    return errs


def run(root):
    cfg = load_config(root)
    errs = []
    pkgs = iter_packages(root, cfg["package_marker"])
    for name in pkgs:
        check_package(name, os.path.join(root, name), root, cfg, errs)
    errs += check_banned_phrases(root, cfg, errs=errs)
    errs += check_banned_tokens(root, cfg)
    ncases = check_eval_cases(root, cfg, errs)
    return errs, pkgs, ncases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default=".")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()
    errs, pkgs, ncases = run(args.root)
    status = "CONFORMANT" if not errs else "NON-CONFORMANT"
    print(json.dumps({"status": status, "packages_checked": pkgs,
                      "eval_cases_found": ncases, "errors": errs}, indent=2))
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
