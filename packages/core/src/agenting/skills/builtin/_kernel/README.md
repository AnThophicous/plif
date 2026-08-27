# _kernel — PLI'EF Cognitive Core

The shared kernel owns exactly one copy of every cross-skill concept. Flagships reference it; they never restate it.

## Ownership map

| Concept | Canonical file | Consumers |
|---|---|---|
| Evidence states + provenance rules | `evidence/ledger.md` | all flagships |
| Capability taxonomy + degradation protocol | `capabilities/map.md` | all flagships |
| Artifact store paths + versioning | `artifacts/conventions.md` | all flagships |
| Risk-aware autonomy R0–R3 | `risk/autonomy.md` | all flagships |
| RepositoryMap builder | `cartographer/spec.md` + `cartography.py` | Sifr, Argus, Galileu, deep-review, investigate |
| Change Impact Engine | `change-impact/spec.md` + `change_impact.py` | deep-review, Argus SecDiff, Sifr |
| Conformance / eval runner | `scripts/` | release process |

Nothing else belongs here. Module-level judgment stays inside flagship packages.

## Running tooling

```bash
python _kernel/evidence/validate_ledger.py <path> [--selftest]
python _kernel/cartographer/cartography.py <root> --out .plif/artifacts/repository-map.json --depth standard [--selftest]
python _kernel/change-impact/change_impact.py --repo <root> --diff <file> --map .plif/artifacts/repository-map.json --out <out> [--selftest]
python _kernel/scripts/package_conformance.py [<root>] [--strict]
python _kernel/scripts/run_evals.py [<root>]
```

All tooling is stdlib-only, cross-platform, and never fabricates success. `--selftest` embeds fixtures proving the mechanism works without a live repository.
