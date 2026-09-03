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
# Memory — layered knowledge without context flooding

Orun stores knowledge in layers:

1. `catalogs/` and `indexes/` preserve the existing source/item/concept cache;
2. `knowledge/capability-domains.json` maps user needs to capability classes;
3. `knowledge/capability-graph.json` stores candidate, alternative, composition,
   requirement and verification relationships;
4. `knowledge/capabilities.json` stores normalized evidence-bearing records.

Load layer 2 first, retrieve a small graph neighborhood, then read only the
records needed for the decision. Do not preload all source profiles. The local
index is cache evidence; official current sources remain authoritative for
volatile APIs, compatibility, package names, licensing and browser behavior.

## Record hygiene

Every normalized capability keeps useful negatives: limitations, avoid-when,
known conflicts, SSR constraints, accessibility and performance characteristics.
Unknown is valid. A record with only a name, adjectives or a copied demo is not
eligible for ranking.
