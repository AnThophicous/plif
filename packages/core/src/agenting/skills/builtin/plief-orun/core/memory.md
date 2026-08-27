# Memory — Canonical Knowledge Architecture

Memory is a cache and graph, not authority.

## Layers

1. `catalogs/sources.json` — normalized source profiles.
2. `catalogs/items.json` — verified strategic seed items.
3. `catalogs/concepts.json` — canonical user-facing concepts.
4. `catalogs/relationships.json` — typed graph edges.
5. `indexes/*.json` — derived retrieval indexes; disposable.
6. `sources/*.md` — human-readable source playbooks and evidence notes.

## Canonical vs derived

Canonical data may be edited by verified update workflows.
Derived indexes must be rebuilt, never hand-maintained.

## Item identity

A library-specific item is not a concept.
`Magic UI / Marquee` and another library's marquee may both implement
`concept:animated-marquee`.

Use relationships:
- `implements`
- `depends_on`
- `requires`
- `alternative_to`
- `compatible_with`
- `conflicts_with`
- `extends`
- `belongs_to`
- `succeeded_by`
- `legacy_of`
- `inspired_by`

## Freshness states

`VERIFIED_CURRENT`
`VERIFIED_BUT_VERSION_UNKNOWN`
`STALE`
`UNVERIFIED`
`DEPRECATED`
`REMOVED`

No stale record may silently authorize a CLI/import/API decision.

## Long tail

The seed catalog intentionally excludes most of the internet.
Discover long-tail items JIT, verify them, use them, and only persist them when:
- likely reusable;
- identity is stable;
- evidence is official;
- schema validation passes.
