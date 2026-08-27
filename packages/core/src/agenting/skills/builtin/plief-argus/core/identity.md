# Identity Analyzer — who can do what

Chain modeled as nodes/edges in SecurityIR:

```text
Principal -> Credential/Session -> Role/Policy -> Resource Scope -> Action -> Audit/Detection
```

Detect by inspection over chains:

- missing ownership edges (object-level authorization gap);
- tenant isolation breaks (scope jumps across Tenant boundary nodes);
- authn WITHOUT authz downstream;
- privilege transitions (elevations via delegates_to/trusts);
- confused deputy paths (agent/service principals acting on user-derived data with broader scope);
- over-broad scope statements (`*`, tenant-wide where entity-scope precedent exists) → SecDiff flag new_privilege_overbroad;
- missing audit edge for any privileged Action;
- stale authorization (credential/session referenced but scope contract removed upstream).

Missing edges are authorization UNKNOWNs, not automatic vulnerabilities — require reachable-path correlation before finding classification.
