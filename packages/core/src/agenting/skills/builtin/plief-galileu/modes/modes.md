# Modes

Six entry postures, one file for JIT economy:

EXPLORE    Build/extend the DecisionGraph around an objective; ask nothing yet that the ladder cannot answer. Output: graph snapshot + open questions queue.
CHALLENGE  Receive a stated position/plan/diff; construct minimal graph; attack weakest DEPENDS_ON chains and FACT-less constraints; end with ranked questions or explicit "position survives X".
DECIDE     Close OPEN decisions with evidence; emit DecisionRecord artifact (schema); register SELECTS edges; list deferred items.
PREMORTEM  Run core/premortem template over R2/R3 decisions; failure nodes wired into graph.
AUDIT      Re-read stored graphs/ledgers: staleness, unsupported FACTs, SETTLED nodes whose dependencies were later invalidated, PREFERENCE leakage into CONSTRAINT roles, orphan options.
REOPEN     Event-driven partial invalidation via tools/reopen.py with user-visible before/after branch counts; never silently re-opens.

Mode selection is inference from request text + artifacts present; when ambiguous between CHALLENGE and AUDIT, AUDIT first (cheaper, informs).
