# Source Verification

## Authority
`official current docs > official repo > official registry > official package metadata > official examples > official source > author-maintained docs > secondary discovery`

## Critical facts
Commands, imports, package names, slugs, props, hooks, plugins, versions, licensing,
premium status and compatibility require evidence before use when stale/unknown.

## Evidence record
Store:
- URL
- authority level
- checked_at
- claim
- status
- optional version/context

## Divergence
When two official sources disagree:
1. identify timestamps/versions;
2. prefer current docs for user-facing API;
3. compare repository/package/registry;
4. record the divergence;
5. never combine APIs from two versions.

## Versionless sources
Use `VERIFIED_BUT_VERSION_UNKNOWN`; do not invent a version number.

## Secondary-only findings
Use `UNVERIFIED` for implementation-critical fields until official evidence is obtained.
