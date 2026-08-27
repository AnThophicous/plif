# Collectors

Collectors are adapters by **source archetype**, not one universal crawler.

A source may combine archetypes (e.g. `shadcn-registry+github`).
Implement generic collectors first, then add source overrides only where structure differs.

Collector output is untrusted until normalized, compared and validated.
Never persist premium source payloads.
