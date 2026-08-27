# Repo Cartographer — service spec

One reusable map of the target repository, built once and reused by every consumer. Ends repeated stack rediscovery.

## INPUT

- workspace root
- `--depth fast|standard` (fast: manifests + tsconfig + routes existence; standard adds conventions/tests/CI/dependencies detail)

## STATE / CACHE

`.plif/artifacts/repository-map.json` with:
`meta{repo_fingerprint, built_at, depth}`.
Fingerprint = sha256 over sorted relative paths + sizes. Cache invalidation is a MECHANISM: consumers compare fingerprints; divergence → rebuild or mark stale.

## OUTPUT

Sections (each with `confidence` and `evidence` notes; heuristics tagged INFERRED):

```text
stack_profile      {language(s), framework candidates + versions, package_manager+lockfile,
                    typescript?, build tooling}
packages           workspace/package units detected
entry_points       script bin entries, main fields, obvious server/app entries
routes             route dirs/files when detectable (next app|pages, routers)
styling_system     token/theme files found, css strategy hints (tailwind config etc.)
component_inventory top-level counts by extension/dir pattern
data_stores        orm/db config candidates
external_integrations http client configs, webhook-ish references (INFERRED)
tests_owners       test dirs/files layout by scope
conventions        import style hint, module dir policy (INFERRED only if cheap)
```

## ALGORITHM

Static mechanical scan only. Nothing is VERIFIED without file evidence. Monorepos: iterate workspace globs into submaps (`packages[]`). Partial results allowed with `coverage_note`.

## CONSUMERS

Sifr implementation/forensics, Argus discovery pre-stage, Galileu env-search, deep-review blast radius, investigate context step.

## FAILURE BEHAVIOR

Unreadable/empty root → return `{error}` with reasons; never fabricate sections. Nondeterministic bundler repos → partial map + coverage note.

## SELFTEST

`cartography.py --selftest` builds a synthetic mini-repo in a temp dir, runs the scanner twice, asserts stable fingerprint and expected sections. See eval XS-07.
