# Update Knowledge

`DISCOVER → FETCH → PARSE → NORMALIZE → COMPARE → UPDATE → VALIDATE → REINDEX`

## Collector routing
Choose archetype first:
- shadcn-registry
- npm
- github
- docs
- gallery
- marketplace
- runtime
- agent-skill

Use source-specific overrides only for irregularities.

## Persistence
Update canonical files only from evidence.
Store exact evidence URLs and check date.
Do not copy large proprietary/premium payloads into the catalog.
Run:
- schema validation
- duplicate detection
- freshness checks
- index rebuild
- acceptance smoke tests

When a source changed identity, record lineage rather than overwriting history.
