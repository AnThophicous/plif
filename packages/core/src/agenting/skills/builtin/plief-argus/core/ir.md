# SecurityIR — model contract

File `.plif/artifacts/<task-id>/security-ir.json` (schema ../schemas/security-ir.schema.json; validator ../tools/argus_ir_lint.py).

## Node kinds

```text
SystemBoundary  Asset  Principal  Identity  EntryPoint
Component  Service  TrustBoundary  DataFlow  Privilege  Control
Dependency  Threat  AttackPath(ref)  Finding(ref)  Invariant
AI-only: SystemInstructions UserContent UntrustedContent Retrieval
         Memory ModelBoundary ToolAuthorization HumanApproval
```

Node required fields: `id, type, provenance{kind,ref}, confidence(LOW|MED|HIGH), verified(bool)`. AttackPath/Finding nodes may reference artifacts instead of inline detail.

## Edge types

```text
contains crosses accesses protected_by delegates_to trusts
grants requires approval_of mitigates
```

## Hard rules (lint)

1. every endpoint exists; no duplicate node ids;
2. missing provenance/confidence/verified ⇒ lint error (a diagram without evidence is not proof);
3. `meta.ai_system: true` requires all seven AI node kinds present;
4. **authorization-outside-model invariant**: any `grants` edge from `ModelBoundary` to a `Privilege` is a lint error and finding candidate — model output never grants capability;
5. security invariants registry mirrors legacy list verbatim (tenant isolation; secrets absent from logs/errors/traces/prompts/memory/artifacts; privileged actions gated by authn+authz+scope+audit; input validated/bounded/encoded at sinks; no debug data/test creds in releases; dependency/provenance trust; fail-closed; audit sufficiency; AI cannot turn untrusted content into instructions/actions).

Flag every relevant invariant per assessment as preserved/violated/partially-verified/not-applicable/unknown WITH evidence.
