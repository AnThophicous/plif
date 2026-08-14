import type { Skill } from '../skills.js';

/** Built into the harness so production-sensitive work can be audited without
 * relying on a user's filesystem or a network checkout. */
export const DEEP_ENGINEERING_AUDIT_SKILL: Skill = {
  name: 'deep-engineering-audit',
  description:
    'Execute a sophisticated adversarial audit workflow for engineering work where mistakes are expensive — code changes, migrations, configurations, infrastructure, plans, deployments, and anything that ships to a real system or a real user',
  scope: 'builtin',
  file: '<builtin:deep-engineering-audit>',
  instructions: `Use this when being wrong is expensive. Keep builder and breaker
mindsets separate: first establish ground truth and build the change, then try
to break it as a hostile senior engineer.

Run these phases in order and announce each one:

1. Think — read the actual source, configs, tests and callers. Write acceptance
criteria, explicit assumptions, and the three most realistic failure modes.
2. Plan — make a numbered plan with action, files touched, criteria covered and
blast radius. Get explicit approval before irreversible actions.
3. Work — execute the plan, keep the diff focused, and maintain a change log.
4. Structural review — reread every changed line against the plan. Check
contracts, callers, failure paths, defaults, scope and leftovers.
5. Test — exercise boundaries, malformed input, repeated execution, errors and
the regressions named in the failure map. Report only commands actually run.
6. Adversarial review — independently attack assumptions, untrusted input,
authorization, silent failures, state/timing and design. Every finding needs
severity, exact location, concrete scenario, impact and fix direction.
7. Complete — resolve every blocker and major finding, or name an accepted risk.
8. Deliver — report what changed, verification results, findings and remaining
risk.

Do not call a change complete because it compiles or worked once. If a phase is
not applicable, say why and perform the closest valid substitute. Fix confirmed
findings, rerun the adversarial pass, and stop after three rounds with any
remaining risk explicitly documented.`,
};
