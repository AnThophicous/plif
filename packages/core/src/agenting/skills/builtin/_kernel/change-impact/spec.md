# Change Impact Engine — service spec

Diff → classified blast radius → concrete verification obligations. Fed to review/security/frontend flows so obligation computation is not improvised per skill.

## INPUT

- unified diff (file; git.diff capability produces it — absent capability must be declared, engine never invents diffs)
- repository-map.json (context for classification)
- optional current ExperienceIR / SecurityIR refs

## OUTPUT (`change-impact.json`)

```text
affected_components            paths/components touched + import-graph callers where derivable
affected_contracts             IR/artifact sections impacted
affected_tests                 test files expected to change/run
security_impact_candidates     one or more of:
        new_entry_point | new_external_call | new_privilege | expanded_scope |
        new_data_flow_crossing_boundary | new_dependency | new_secret_path |
        weakened_control | removed_invariant
frontend_impact                surface ids (UI files changed → render matrix obligation)
migration_needed               bool + why
blast_radius                   local | feature | system-wide
rollback_complexity            trivial | easy | costly | destructive
verification_obligations       [{kind:"render_matrix"|"sec_diff"|"update_tests"|"integration_run", detail}]
```

## ALGORITHM

1. Parse diff headers → added/modified/deleted per path (+ dependency hunk lines from lockfile/manifest diffs).
2. Classify via repository-map + path patterns (migrations/, auth middleware, controllers/routes, config/env).
3. Import graph: mechanical parse of `import/from/require` in changed JS/TS/PY sources restricted to repo-relative modules → callers of changed modules are affected.
4. Human-facing impact beyond mechanical derivability is INFERRED-labeled; no fake precision.

## FAILURE BEHAVIOR

Empty/unparseable diff → error out (never an empty-pass report). Missing map → run Cartographer first (obligation noted).

## EVAL

Embedded selftest exercises route addition, dependency addition, secret-path candidate, migration rollback classification. Cross-skill: XS-02.
