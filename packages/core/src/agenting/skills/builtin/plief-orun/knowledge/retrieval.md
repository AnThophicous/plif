# Orun capability-first retrieval

Orun's knowledge is a local, source-attributed index. It is not a package dump
and it is not permission to install anything. The baseline records, the curated
expansion shard and the catalog-derived discovery shard are separate so the
model receives a small set of capability-relevant records instead of every
library profile.

## Pipeline

```text
NEED → CAPABILITY → CANDIDATES → EVIDENCE → FIT → USE | ADAPT | COMPOSE | BUILD
```

1. Parse the need into capability, constraints, framework/runtime, SSR/client
   boundary, accessibility, performance/bundle budget, license and maintenance
   requirements.
2. Query `scripts/query_capabilities.py`. It searches merged domains first, then
   normalized records and bounded graph neighbors. `--top-k` is capped at eight.
3. Read only the returned records and their source evidence. A candidate name is
   not evidence. The result includes limitations and a verification plan.
4. Apply hard gates before aesthetic ranking: runtime/SSR, license/provenance,
   accessibility, budget, security and project-native compatibility.
5. Record a `SelectionRecord` for a chosen external item. Orun qualifies; Sifr
   selects experience fit when a visual/product decision is material.

## Freshness and honesty

Official documentation is authoritative for current APIs, package names, browser
support and licensing. The local index is a cache. Model memory is a hypothesis.
High-volatility records return `VERIFY_REQUIRED` unless a fresh source check is
explicitly recorded. Unknown is a valid value; do not fill gaps with invented
versions, props, imports, performance numbers or compatibility.

## Context budget

Default output is a compact candidate summary with capability, hard constraints,
tradeoffs, provenance, confidence, graph context and a verification method.
Full records are opt-in with `--full`. Do not preload all source profiles or all
catalog items. Catalog-derived records are always low-confidence discovery
signals until their current source, license and behavior are verified.
