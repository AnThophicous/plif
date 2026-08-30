# PLIF Code Mode Design

Date: 2026-08-29
Status: Quarantined pending process-isolated implementation
Release target: PLIF 0.5.x security-gated follow-up

## Scope

Code Mode is not currently available. The original prototype added a `run_code`
tool that let the model write one bounded TypeScript program, invoke an
allowlisted SDK of existing tools, combine intermediate results, and return one
curated result to the model. Token caching and compaction changes are outside
this feature.

The intended purpose is to reduce provider round trips while preserving the
existing Container, policy, approval, ownership, redaction, and audit
boundaries. Until those boundaries are proven for generated code, `run_script`
is the supported batching primitive.

## Security gate discovered during audit

The prototype used `worker_threads` plus `node:vm`. That is not a security
boundary: a generated program escaped the VM context to read host process state,
and the worker lifecycle also leaked after a successful result. Node's own
documentation warns that `node:vm` is not a security mechanism. The prototype
was therefore removed from the loop and the public `run_code` spec was removed;
the compatibility function now fails closed with `POLICY_DENIED`.

Re-enable Code Mode only after all of the following are true:

- execution happens in a separate OS process/container governed by the same
  `SandboxJail` policy, never in a worker or VM inside the PLIF host;
- the child receives a minimal, serializable RPC surface and no host handles,
  module loader, environment secrets, or unrestricted filesystem/network access;
- cancellation, timeout, memory, output, source-size, call-count, and child
  process cleanup are tested under success, failure, abort, and crash paths;
- an adversarial escape suite proves that generated code cannot reach host
  process APIs or bypass tool policy; and
- the tool is opt-in behind an explicit trust/policy decision and remains absent
  from prompts and registries until that gate passes.

## Plif prompt contract

The Plif startup prompt composes Workflow and Agenting guidance. The prompt
instructs the agent to:

- turn the user objective into small convergent TODOs;
- define or update a durable Goal when the work has a measurable objective;
- choose `run_script` when several tool operations can be planned together;
- delegate independent work to isolated subagents with staged instructions;
- test and diagnose every meaningful checkpoint;
- review subagent results in the parent lane;
- update the workflow and re-check the Goal after every completed response;
- continue silently while the Goal is incomplete;
- research missing information before asking the user;
- ask the user when research cannot produce reliable information;
- pause for approval when policy requires it;
- deliver only after tests, review, and Goal verification are complete.

This contract applies to the Plif effort only. Other efforts retain their
existing tool and response behavior.

## Runtime architecture

The future `run_code` implementation must execute in a separate process inside
the active sandbox. A worker boundary or `node:vm` context alone is explicitly
insufficient. The child may receive only a generated program, a generated SDK,
a bounded execution context, and the agent's ownership identity over a narrow
serializable protocol.

The SDK contains only tools present in the current tool registry and approved
for the current lane. Every SDK call is routed back through the existing tool
runner, Container authorization, approval broker, redaction, and audit log.
The SDK cannot access Node `fs`, `child_process`, sockets, credentials,
history databases, Container internals, or undeclared tools.

The program contract is:

```text
export default async function main({ tools, workflow, goal }) { ... }
```

`tools` exposes typed wrappers. `workflow` exposes bounded read-only task
state. `goal` exposes bounded read-only Goal state and verification helpers.
The program may branch on results, filter data, use `Promise.all` for
parallel-safe calls, and return JSON-compatible data. It may not mutate the
Workflow or Goal directly; those changes remain controlled by the parent
agent's normal tools.

## Limits and scheduling

Each invocation has limits for source bytes, generated SDK bytes, wall time,
memory, output bytes, total calls, call depth, and concurrent calls. The
scheduler accepts parallel calls only when every selected tool is marked
`parallelSafe`. Effects and terminal operations remain serialized unless the
tool explicitly declares a safe execution policy.

Cancellation propagates from the parent turn to the worker and every active
tool call. A failed call produces a structured error for the program; the
program can handle recoverable failures, while policy denials and approvals
remain authoritative and cannot be swallowed.

## Result and history boundaries

Internal SDK calls, intermediate values, and worker traces do not become
individual model transcript messages. The model receives one bounded
`run_code` result containing status, curated return data, relevant errors, and
execution statistics. Secret values are redacted before result delivery.

The history stores the external `run_code` request and final result. The audit
log stores the Code Mode invocation and one record for each internal tool call,
including policy and approval outcomes. Internal traces remain available only
through protected diagnostics and do not mix parent and child transcripts.

## Workflow and subagents

The Workflow is visible in the Activity panel, not in the ordinary transcript.
The parent may send a bounded staged task to a forked subagent. The child gets
its own Workflow view, history, tools, terminals, queue, Goal context, and
read-only memory snapshot. Child events never enter the parent transcript.

The parent can mark completed TODOs, merge bounded child results into its own
workflow state, and continue the same child with follow-up input. A child
cannot write memories or mutate the parent's workflow.

## Automatic continuation

After `response.done`, the Plif loop verifies the durable Goal. If the Goal is
not complete and no approval or missing-information question is pending, it
starts the next workflow request without a user-facing progress message. The
loop continues through planning, delegation, execution, testing, review, and
Goal verification until completion or an explicit user cancellation.

The existing runtime safety budgets, cancellation path, policy denials, and
provider failure handling remain active as internal protection against an
unbounded or unsafe loop.

## Errors and approvals

Compilation errors, runtime errors, timeouts, output limits, and tool failures
are returned as typed Code Mode results with the failed operation and bounded
diagnostic detail. The parent agent decides whether to repair and retry.

Policy approval requests pause the Code Mode execution and surface the normal
PLIF approval prompt. No generated program can approve itself, bypass a deny
rule, authenticate privileged credentials, or use a chat-pasted secret.

## Acceptance criteria

- `run_code` is absent from every current tool registry and prompt; the
  fail-closed compatibility call returns `POLICY_DENIED`.
- A future process-isolated implementation can call multiple allowlisted tools
  and return one structured result only after the security gate above passes.
- Parallel-safe calls run concurrently; unsafe calls are serialized.
- A tool denial or approval crosses the same Container and audit boundaries as
  a direct model tool call.
- Internal calls do not pollute the model transcript or parent/child history.
- Output, memory, source, call count, and time limits are enforced.
- Cancellation stops the worker and all active calls.
- Plif Workflow and Agenting prompts trigger decomposition, testing, and
  silent Goal continuation.
- The Activity panel shows workflow progress without adding transcript noise.
- Missing information is researched first and becomes a user question only
  after reliable research fails.
