#!/usr/bin/env python3
"""Eval runner - orchestrates available evaluation layers honestly.

Usage: run_evals.py [<root>] [--out report.json]

Layers implemented here:
  E0 packaging       package_conformance.py
  E1 artifact mech   every tool exposing --selftest
  E2..E6 behavioral  REQUIRE a host adapter (env PLIEF_EVAL_ADAPTER=<command>).
                     Without one they are reported RUNTIME_EVAL_NOT_EXECUTED -
                     never simulated, never silently passed.
"""
import argparse
import glob
import json
import os
import subprocess
import sys
from datetime import datetime

PY = sys.executable


def discover_selftests(root):
    hits = []
    patterns = ["/engines/*.py", "/tools/*.py", "/scripts/*.py"]
    for skill_dir in next(os.walk(root))[1]:
        if skill_dir.startswith("_"):
            continue
        base = os.path.join(root, skill_dir)
        for pat in patterns:
            for path in glob.glob(base + pat):
                try:
                    if "--selftest" in open(path, encoding="utf-8", errors="ignore").read():
                        hits.append(path)
                except OSError:
                    pass
    for sub in ("evidence", "cartographer", "change-impact", "scripts"):
        for path in glob.glob(os.path.join(root, "_kernel", sub, "*.py")):
            if os.path.basename(path).startswith("run_"):
                continue
            try:
                if "--selftest" in open(path, encoding="utf-8", errors="ignore").read():
                    hits.append(path)
            except OSError:
                pass
    return sorted(set(hits))


def run_one(script, root):
    proc = subprocess.run([PY, script, "--selftest"], cwd=root,
                          capture_output=True, text=True, timeout=120)
    ok = proc.returncode == 0
    tail = (proc.stdout.strip().splitlines() or [""])
    err_tail = (proc.stderr.strip().splitlines() or [""])
    return {"script": os.path.relpath(script, root).replace("\\", "/"),
            "status": "PASS" if ok else "FAIL",
            "summary": tail[-1][:200],
            "stderr_last": err_tail[-1][:200]}


def count_behavioral_cases(root):
    cases = []
    for pattern in ("*/evals/cases/*.json",):
        for path in glob.glob(os.path.join(root, pattern)):
            try:
                data = json.load(open(path, encoding="utf-8-sig"))
            except Exception:  # noqa: BLE001
                continue
            recs = data.get("cases", data) if isinstance(data, dict) else data
            if isinstance(recs, list):
                cases.extend(recs)
            elif isinstance(data, dict) and isinstance(data.get("cases"), list):
                cases.extend(data["cases"])
    crit = sum(1 for c in cases if isinstance(c, dict) and c.get("critical"))
    return len(cases), crit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default=".")
    ap.add_argument("--out", default=os.path.join("_kernel", "reports", "run_evals.json"))
    args = ap.parse_args()
    root = args.root

    report = {"generated_at": datetime.now().isoformat(timespec="seconds"),
              "root": os.path.abspath(root), "layers": {}}

    conf = subprocess.run([PY, os.path.join("_kernel", "scripts", "package_conformance.py"), root],
                          cwd=root, capture_output=True, text=True, timeout=180)
    try:
        parsed = json.loads(conf.stdout)
    except Exception:  # noqa: BLE001
        parsed = {"status": "RUNNER_ERROR", "raw": conf.stdout[-500:], "stderr": conf.stderr[-300:]}
    report["layers"]["E0_packaging"] = {
        "status": parsed.get("status"),
        "packages_checked": parsed.get("packages_checked", []),
        "eval_cases_found": parsed.get("eval_cases_found"),
        "errors": parsed.get("errors", []),
    }

    st_results = [run_one(s, root) for s in discover_selftests(root)]
    report["layers"]["E1_artifact_mechanics"] = {
        "executed": len(st_results),
        "pass": sum(1 for r in st_results if r["status"] == "PASS"),
        "results": st_results,
    }

    adapter = os.environ.get("PLIEF_EVAL_ADAPTER")
    if adapter:
        proc = subprocess.run(adapter, shell=True, cwd=root, capture_output=True, text=True,
                              timeout=600)
        report["layers"]["E2_E6_behavioral"] = {
            "adapter": adapter, "exit_code": proc.returncode,
            "stdout_tail": proc.stdout[-2000:], "status":
            "PASS" if proc.returncode == 0 else "FAIL"}
    else:
        n_total, n_crit = count_behavioral_cases(root)
        report["layers"]["E2_E6_behavioral"] = {
            "status": "RUNTIME_EVAL_NOT_EXECUTED",
            "reason": "no host adapter provided (env PLIEF_EVAL_ADAPTER unset)",
            "behavioral_cases_declared": n_total,
            "critical_cases_declared": n_crit,
            "note": "declared critical evals are release-blocking once executed; "
                    "non-execution is recorded, never assumed-passed"}

    layers_flat = [report["layers"]["E0_packaging"]["status"]] \
        + [r["status"] for r in st_results] \
        + ([report["layers"]["E2_E6_behavioral"]["status"]] if adapter else [])
    failing = sum(1 for s in layers_flat if s not in ("PASS", "CONFORMANT"))
    report["aggregate"] = {"hard_failures": failing,
                           "behavioral_execution": "host" if adapter else "not-executed"}
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    json.dump(report, open(args.out, "w", encoding="utf-8"), indent=2)

    e0 = report["layers"]["E0_packaging"]["status"]
    fails = [r for r in st_results if r["status"] == "FAIL"]
    print(f"E0 {e0} | E1 {report['layers']['E1_artifact_mechanics']['pass']}/"
          f"{report['layers']['E1_artifact_mechanics']['executed']} | "
          f"E2-E6 {report['layers']['E2_E6_behavioral']['status']}")
    for f in fails:
        print(f"FAIL {f['script']}: {f.get('summary')} / {f.get('stderr_last')}")
    for e in report["layers"]["E0_packaging"].get("errors", []):
        print(f"CONF-ERR {e}")
    sys.exit(0 if (not fails and e0 == "CONFORMANT") else 1)


if __name__ == "__main__":
    main()
