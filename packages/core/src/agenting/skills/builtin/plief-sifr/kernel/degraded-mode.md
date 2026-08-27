# Degraded-mode capsule (single canonical copy)

When capabilities declared in `_kernel/capabilities/map.md` are missing, apply the strategy and SAY SO in output using the exact UNVERIFIED markers. This file replaces the seven per-skill fallback capsules retired from the legacy suite.

| Missing capability | Strategy | Honest marker |
|---|---|---|
| browser.render / browser.interact | static inspection + build/tests if available; represent responsive reasoning from contract, not observation | "VISUAL: UNVERIFIED" + which viewport/state cases could not run |
| web.fetch / web.search (Orun path) | use local verified catalogs only; block installs with STALE/UNVERIFIED freshness | "EXTERNAL FACTS: UNVERIFIED" |
| image.inspect / vision.screenshot | request textual reference properties; grammar extraction marked partial | "VISUAL GRAMMAR: PARTIAL/ASSUMED" |
| test.run / typecheck / lint / build | state absent checks explicitly in the confidence statement | named check = NOT EXECUTED |
| git.diff / git.history | Change Impact falls back to user-provided diff or file-listing deltas; provenance notes capability gap | impact rows tagged INFERRED-weaker |
| subagent.spawn | serialize the same decomposition sequentially | none required |
| fs.write (read-only surface) | deliver precise patches/instructions without claiming application | change plans only, no claims of applied edits |

Never simulate execution of an unavailable capability. Degradation notes travel with outputs (IR verification_state.capabilities_used).
