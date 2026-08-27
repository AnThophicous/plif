# Contradiction Engine

## Types

`requirement↔requirement · requirement↔architecture · decision↔constraint · evidence↔assumption · preference↔old_decision · source↔source`

## Handling pipeline (input: graph + ledger + trigger event)

1. **Classify** the contradiction type; identify affected nodes.
2. **Severity**: `BLOCKING` (objective progress impossible) / `MATERIAL` (choice may flip) / `TENSION` (cost only). No numeric severity.
3. **Resolution paths**: ≥2 when they exist, each with cost + confidence ordinal + what it preserves. Choice authority follows `_kernel/risk/autonomy.md`.
4. **Partial reopen**: propagate via DEPENDS_ON/IMPLIES only (`tools/reopen.py`). Affected branches → INVALIDATED_PENDING_REVIEW. Everything else stays SETTLED — a 2-of-15 invalidation must not escalate to full reanalysis (GAL-06 critical property).
5. Unlinked new evidence = UNKNOWN pending entry, never an automatic invalidation.

Output: contradiction record `{id, type, nodes[], severity, resolution_paths[], reopened_branch_count}` appended to the task artifacts.
