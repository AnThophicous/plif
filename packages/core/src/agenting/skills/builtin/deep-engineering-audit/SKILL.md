---
name: deep-engineering-audit
description: Execute an adversarial audit for code, migrations, configuration, infrastructure, plans, deployments, and other changes where mistakes are expensive.
---
# Deep engineering audit

Use when the user asks for a deep, production-grade, adversarial, or thorough
review, or when auth, migration, data loss, public APIs, or irreversible changes
make failure expensive.

Keep builder and breaker mindsets separate. Run these phases in order:

1. **Think:** inspect real source, configs, tests, callers, and constraints.
2. **Plan:** define acceptance criteria, assumptions, failure modes, files, and
   blast radius before mutation.
3. **Work:** make the smallest focused change and keep a change log.
4. **Structural review:** reread every changed line against contracts and callers.
5. **Test:** cover malformed input, boundaries, retries, cancellation, repeated
   execution, and the reported regression.
6. **Adversarial review:** attack trust boundaries, authorization, secrets,
   silent failures, state, timing, concurrency, and compatibility.
7. **Complete:** resolve blockers and major findings or document accepted risk.

Every finding needs severity, exact location, scenario, impact, and fix
direction. Never call a change complete because it compiles or worked once;
rerun verification after the final edit and report only commands actually run.

