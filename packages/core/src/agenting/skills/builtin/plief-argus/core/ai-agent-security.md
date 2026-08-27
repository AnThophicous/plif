# AI / Agent Security — graph-level model

Applies whenever `meta.ai_system: true`. All seven AI node kinds REQUIRED.

## Content/authority flow to draw

```text
SystemInstructions ← separates from → UserContent
UntrustedContent (web pages, files, emails, tool results, other tenants)
   --retrieves/receives--> Retrieval --feeds--> Memory / ModelBoundary
ModelBoundary --invokes--> ToolAuthorization --grants--> Actions on ExternalSystems
HumanApproval gates irreversible/high-impact ToolAuthorization edges
```

## Threat → edge pattern triggers

| threat | trigger |
|---|---|
| direct/indirect prompt injection | UntrustedContent reaches ModelBoundary with no HumanApproval/mitigation control between |
| retrieval poisoning | UntrustedContent → Memory edge lacking validation Control |
| memory poisoning across sessions/tenants | Memory lacks scope ownership edges |
| instruction/data confusion | SystemInstructions and UntrustedContent share an undifferentiated ingestion DataFlow |
| tool confused deputy | ToolAuthorization edge grants actions derived from user content w/o approval_of user principal |
| excess authority / stale authz | grants scope broader than the invoking Principal's scope |
| cross-session leak | Memory/shared context crossing session boundary without Control |
| secret propagation | secret-class Asset flows into prompts/logs/memory/tool params |
| untrusted tool result trusted | tool-result DataFlow bypassing validation to privileged Action |
| irreversible autonomous action | high-impact action without HumanApproval + kill-switch |

## Standing invariant

**Authorization exists OUTSIDE the model.** Text never grants capability. The IR lint mechanically flags any `ModelBoundary --grants--> Privilege`. Every material agent action needs provenance back to an authenticated authorization decision — never to a prompt sentence.
