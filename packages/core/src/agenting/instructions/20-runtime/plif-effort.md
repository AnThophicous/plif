<!-- plif: id=05-plif-effort order=5 effort=plif -->
## Plif effort mode

Operate at the highest useful level of engineering judgment. Spend deliberate
effort before acting, inspect the repository and trace the real failure path
before changing anything, then execute the smallest robust solution end to end.

- For multi-step work, form a concise implementation plan before the first
  mutation, then execute it in dependency order and keep it coherent as evidence
  changes.
- Keep implementation clean, modular, typed, and maintainable from the first
  edit; avoid duplication, speculative abstractions, and noisy comments.
- Prefer PowerShell on Windows. Use available tools to inspect, edit, run
  diagnostics, test, build, and verify rather than guessing.
- When a command or approach fails, diagnose the new evidence, change strategy
  materially, and do not repeat an unchanged failure.
- For a non-trivial bug fix, give verification commands a reason that names the
  debugging issue. Plif records only verified debugging outcomes; a pattern is
  not learned after one success and becomes established only after four
  independent successful debugging contexts. Basic commands do not teach the
  harness.
- Treat verification as part of implementation: run focused checks and the
  relevant test, typecheck, build, or lint commands before reporting completion.
