# PLIF project audit — 2026-08-29

Status: P0/P1 findings corrected in the working tree. P2/P3 items remain
tracked follow-ups. This record deliberately separates verified behavior from
risks that need a different host or a later design.

## Scope and baseline

- Workspace: `C:\Users\Leon\Desktop\Plif`, release line `0.4.0`.
- Baseline failures: `npm run link` stopped at four TypeScript errors in the
  untracked Code Mode prototype; without dependencies, `tsc` and `tsx` were
  unavailable.
- Recovery: `npm ci` restored the workspace; `npm audit --json` reports zero
  vulnerabilities and the dependency tree is loadable.
- Existing dirty-tree edits and the five deleted capture-extension scripts were
  preserved; they predate this audit and are not silently restored.

## P0 — generated Code Mode was not a security boundary (fixed)

Evidence before the fix: the prototype combined a worker thread with
`node:vm`. A generated program escaped the VM context through the host
constructor and read `process.version`; a successful result also left the worker
alive because its message listener was not terminated.

Correction:

- removed Code Mode from the loop registry and CLI prompt/tool advertisement;
- removed the stale `RUN_CODE_SPEC` export;
- retained a compatibility `runCodeMode` entry point that fails closed with
  `POLICY_DENIED` and points callers to `run_script`;
- documented the separate-process/container gate in
  `docs/superpowers/specs/2026-08-29-plif-code-mode-design.md`;
- added `packages/core/test/code-mode.test.ts` as a regression.

Re-enable only after a separate OS process/container, minimal serializable RPC,
resource limits, cancellation/crash cleanup, and an adversarial escape suite
all pass. A worker or VM alone is insufficient.

## P1 — project-local LSP executables ran with host privileges (fixed)

`resolveServer` previously preferred `<workspace>/node_modules/.bin` before
`PATH`. Because `LspClient` spawns the selected command directly, a repository
could control code executed during diagnostics.

Correction:

- project-local discovery is denied by default;
- trusted callers must pass `allowProjectExecutable: true` or set
  `PLIF_ALLOW_PROJECT_LSP=1`;
- relative `PATH` entries are ignored so `.` cannot bypass the gate;
- `packages/core/test/lsp-servers.test.ts` covers denied and explicit opt-in
  resolution;
- README documents the trust decision.

`PATH` installations remain host executables. They are outside the repository
trust boundary and should be treated as administrator-managed dependencies.

## Verification matrix

Verified on Windows 11 / Node `v24.20.0`:

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS — 1,221 passed, 20 skipped, 0 failed |
| Code Mode + LSP focused tests | PASS — 13 tests |
| Sifr `quick_validate.py` | PASS |
| Sifr `ir_validate.py --selftest` | PASS — 14 checks |
| Sifr engine self-tests | PASS — matrix and defect classifiers |
| AJV Draft 2020-12 compile | PASS — 9/9 schemas |
| builtin package conformance | PASS — 12 packages, 0 errors |
| builtin eval runner E0/E1 | PASS — E0 conformant, E1 13/13 |
| behavioral evals E2–E6 | NOT EXECUTED — no `PLIEF_EVAL_ADAPTER` configured |
| `npm audit --json` | PASS — 0 vulnerabilities |
| `npm run link` / `plif version` | PASS — `plif 0.4.0` |

## P2/P3 follow-ups

1. Add CI coverage for the declared Node `>=20.11` floor; CI currently runs
   Node 22 only.
2. Define a compatibility matrix before upgrading stale major versions (Ink,
   React, OpenAI/Anthropic SDKs, koffi, TypeScript); do not bulk-update them
   without provider and terminal regression runs.
3. Add a first-class untrusted-workspace mode that requires OS isolation for
   every host-spawned integration. Windows currently does not kernel-enforce
   filesystem/network blocking, and macOS uses the portable backend.
4. Supply a real host adapter for Sifr E2–E6 behavioral evaluation, including
   rendered viewport/state/media cases; the runner must continue to report
   non-execution honestly until then.
5. Decide whether reviewed npm lifecycle scripts (`esbuild`, `koffi`, `core-js`)
   should be explicitly allowlisted in the install policy and document the
   supply-chain trade-off.

## Review passes

Pass 1 — specification: all requested deliverables have evidence above. The
front-end skill now routes archetypes, art direction, motion, media/3D and
non-generic identity; the code audit has P0/P1 corrections; the isolated copy
is hash-verified. E2–E6 remain explicitly unverified because no host adapter is
configured.

Pass 2 — diff: reviewed the Code Mode, LSP trust gate, prompt/docs, tests and
skill entry/manifest against their callers. `git diff --check` is clean; the
LF→CRLF messages are line-ending warnings only. No unrelated deletion was
restored.

Pass 3 — adversarial: checked VM escape, worker cleanup, project-controlled LSP,
relative PATH bypass, stale `run_code` prompt surfaces, schema `$ref`s, malformed
skill metadata, reduced-motion/media fallbacks and platform sandbox claims. The
remaining exposure is the documented platform limitation, not a hidden pass.
