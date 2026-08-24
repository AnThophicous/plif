# PLIF Cybersecurity Assessment Matrix

Use this reference selectively after identifying the project type. It is a
routing aid, not a substitute for tracing the real code path.

## Project classification

| Evidence | Likely surface | First checks |
| --- | --- | --- |
| index.html, React/Vue/Svelte routes, browser bundle | Website/frontend | XSS, DOM sinks, auth state, CSP, storage, CORS, supply chain |
| HTTP routes, controllers, OpenAPI, GraphQL, RPC | API/backend | authz/BOLA, validation, injection, SSRF, rate limits, errors, secrets |
| package.json bin, CLI entry point, terminal I/O | CLI/package | shell and path boundaries, subprocesses, config permissions, logs, update flow |
| Android/iOS project, exported components, deep links | Mobile | local storage, auth tokens, TLS, deep links, exported surfaces, backups |
| Electron/Tauri/native executable | Desktop | IPC, filesystem, protocol handlers, updater/signatures, privilege boundaries |
| Dockerfile, Helm, Terraform, CI workflows | Infrastructure | least privilege, secrets, network exposure, provenance, artifact permissions |
| Queue consumers, cron, workers, ETL | Worker/data service | message auth, deserialization, replay, tenant isolation, data minimization |
| Library/package metadata and publish workflow | Supply chain | lockfile, lifecycle scripts, tarball contents, provenance, token scope |
| Tool-calling agent, prompt router, memory, model provider | AI system | prompt injection, tool authorization, context poisoning, secret leakage, approvals, autonomy |

## Safe test modes

### Static-only

Use when authorization is absent or the target is unknown. Inspect source,
configuration, lockfiles, tests, history, and build artifacts. Do not send
network requests to a target.

### Local verification

Use localhost, disposable containers, mock identities, synthetic records, and
fixtures. Test one hypothesis at a time. Keep payloads harmless and reversible.

### Staging assessment

Require named staging hosts, test accounts/data, rate limits, allowed paths,
prohibited actions, and a stop condition. Avoid destructive writes, brute force,
large crawls, data export, persistence, or bypassing real users.

### Production validation

Default to passive or explicitly approved canary checks. Do not probe
production just because it is reachable. Stop immediately on unexpected data,
impact, authentication anomalies, elevated error rates, or scope ambiguity.

## Report quality bar

A useful finding connects:

~~~text
attacker-controlled input
  -> vulnerable boundary
  -> reachable sink
  -> concrete impact
  -> smallest safe proof
  -> tested remediation
~~~

If one link is missing, label it as an unverified hypothesis rather than a
confirmed vulnerability.

## AI security routing

For AI systems, map the boundary between user content, retrieved content,
conversation memory, model instructions, tools, credentials, and external
systems. Check:

- prompt and context injection from untrusted content;
- tool permissions and approval gates;
- secret exposure through prompts, logs, memory, or tool results;
- tenant/session isolation and context poisoning;
- excessive autonomy, unsafe fallbacks, and provider/model confusion.

Use local fixtures and synthetic tool responses unless active testing is
explicitly authorized for a named environment.
