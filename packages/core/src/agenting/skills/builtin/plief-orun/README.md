# Pli'ef Orun

**Pli'ef Orun** is a portable agent skill for frontend/UI/motion/3D engineering.

It separates:
- **Brain** — decision engine and risk/autonomy.
- **Memory** — canonical data, concept layer, relationships and compiled indexes.
- **Eyes** — project inspection, external verification and capability detection.
- **Hands** — implementation, adaptation, integration and repair.
- **Judge** — static/runtime/visual/UX/performance verification.

The skill is PLIF-first-class but core behavior is capability-driven and portable to Codex,
Claude Code and similar coding agents.

## Bootstrap data

`catalogs/` contains strategic seed data, not a frozen copy of the internet.
`indexes/` is generated and disposable.
The authoritative order is always:

`OFFICIAL SOURCE > LOCAL INDEX > MODEL MEMORY`

Run:

```bash
python3 scripts/validate_catalog.py
python3 scripts/build_indexes.py
python3 scripts/detect_duplicates.py
python3 scripts/check_freshness.py
python3 tests/smoke_test.py
```

Network checks are explicit:

```bash
python3 scripts/check_links.py
```
