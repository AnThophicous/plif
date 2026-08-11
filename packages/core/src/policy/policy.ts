/**
 * The permission engine.
 *
 * Capabilities (in types.ts) answer "may this container ever do X?". Policy
 * answers the finer question: "may it do X to *this* target, right now?" Every
 * privileged action in the core routes through `PolicyEngine.evaluate` before
 * it happens, and the decision — including who or what made it — is what the
 * audit log records.
 *
 * Three outcomes, and the middle one is the interesting one:
 *
 *   allow  proceed silently
 *   ask    stop and put the question to the human, with enough context to answer
 *   deny   refuse, with a reason the agent can read and adapt to
 *
 * `ask` is what makes an autonomous loop tolerable to run unattended-ish: the
 * agent keeps momentum on everything routine and only interrupts for the
 * handful of actions a developer actually wants to see.
 */

import { PlifError } from '../errors.js';
import { classifyHardDeniedInvocation } from '../execution/shell-safety.js';
import { isPathInside } from '../fs/vpath.js';

export type PolicyAction =
  | 'fs.read'
  | 'fs.write'
  | 'fs.delete'
  | 'exec'
  | 'net.connect'
  /**
   * Running a subagent on a model that bills.
   *
   * The only action here whose cost is money rather than access. A free model
   * never reaches this — asking permission to spend nothing is the kind of
   * prompt that teaches people to stop reading prompts.
   */
  | 'model.spawn'
  | 'container.spawn'
  | 'container.commit';

export type Decision = 'allow' | 'ask' | 'deny';

/**
 * Trust tiers, and the isolation each demands. The runtime refuses to run a
 * tier on a backend weaker than its floor — that check is the reason the
 * portable backend cannot host anything but `trusted` work.
 */
export type TrustTier =
  /** Code the developer wrote or vetted. Runs on any backend. */
  | 'trusted'
  /** Code from a dependency or a template. Needs at least job-level confinement. */
  | 'semi-trusted'
  /** Code the model generated or fetched. Needs namespace or microVM isolation. */
  | 'untrusted';

export interface PolicyRequest {
  readonly action: PolicyAction;
  /**
   * What is being acted on: a container path for fs.*, an argv[0] for exec,
   * a "host:port" for net.connect.
   */
  readonly target: string;
  /** Full argv, for exec requests. Rules can match on the whole command line. */
  readonly argv?: readonly string[];
  /** The agent's stated reason. Shown verbatim on approval prompts. */
  readonly reason?: string;
  readonly containerId: string;
}

export interface PolicyRule {
  /** Shown in `plif policy explain` and in the audit log. Make it readable. */
  readonly name: string;
  readonly actions: readonly PolicyAction[] | '*';
  /**
   * Glob-ish matcher against `target`. `*` matches within a segment, `**`
   * across segments. Omit to match every target.
   */
  readonly match?: string;
  /** Regex against the joined argv. Only meaningful for exec. */
  readonly argvPattern?: string;
  readonly decision: Decision;
  /** Why this rule exists. Surfaced when it is the one that denied something. */
  readonly rationale?: string;
}

export interface PolicyDocument {
  /** Applied when no rule matches. Default `ask` — never silently `allow`. */
  readonly fallback: Decision;
  readonly trust: TrustTier;
  readonly rules: readonly PolicyRule[];
  /** Hosts reachable when the `network` capability is on. Empty = none. */
  readonly networkAllowlist: readonly string[];
}

export interface PolicyVerdict {
  readonly decision: Decision;
  /** The rule that decided, or null when the fallback did. */
  readonly rule: PolicyRule | null;
  readonly reason: string;
}

export const STRICT_POLICY: PolicyDocument = Object.freeze({
  fallback: 'ask',
  trust: 'untrusted',
  networkAllowlist: [],
  rules: Object.freeze([
    {
      name: 'read-workspace',
      actions: ['fs.read'],
      match: '/**',
      decision: 'allow',
      rationale: 'The agent must be able to read the code it was asked to work on.',
    },
    {
      name: 'write-workspace',
      actions: ['fs.write'],
      match: '/**',
      decision: 'allow',
      rationale: 'Writes land in the container layer and are reviewable before commit.',
    },
    {
      name: 'protect-vcs-metadata',
      actions: ['fs.write', 'fs.delete'],
      match: '/**/.git/**',
      decision: 'deny',
      rationale:
        'Rewriting git internals can destroy history in ways the developer cannot review.',
    },
    {
      name: 'protect-secrets',
      actions: ['fs.read'],
      match: '/**/.env*',
      decision: 'ask',
      rationale: 'Environment files usually hold credentials.',
    },
    {
      name: 'confirm-deletes',
      actions: ['fs.delete'],
      match: '/**',
      decision: 'ask',
      rationale: 'Deletion is the one filesystem action with no undo inside a turn.',
    },
    {
      name: 'read-only-tooling',
      actions: ['exec'],
      argvPattern:
        '^(git (status|diff|log|show|branch|rev-parse|ls-files)|ls|dir|cat|type|node --version|npm ls|tsc --noEmit)\\b',
      decision: 'allow',
      rationale: 'Inspection commands cannot change state, so they need no approval.',
    },
  ]) as readonly PolicyRule[],
});

/** The everyday default: the developer's own machine, their own code. */
export const DEVELOPER_POLICY: PolicyDocument = Object.freeze({
  fallback: 'ask',
  trust: 'trusted',
  networkAllowlist: Object.freeze(['registry.npmjs.org', 'github.com', 'api.anthropic.com']),
  rules: Object.freeze([
    ...STRICT_POLICY.rules,
    {
      name: 'allow-build-tools',
      actions: ['exec'],
      argvPattern: '^(npm|pnpm|yarn|node|npx|tsc|vitest|jest|eslint|prettier|python|pip|cargo|go)\\b',
      decision: 'allow',
      rationale: 'Standard build and test tooling, run inside the container.',
    },
    {
      name: 'confirm-git-writes',
      actions: ['exec'],
      argvPattern: '^git (push|reset --hard|clean|rebase|filter-branch)\\b',
      decision: 'ask',
      rationale: 'These git operations can discard work that is not recoverable.',
    },
  ]) as readonly PolicyRule[],
});

export class PolicyEngine {
  #document: PolicyDocument;

  constructor(document: PolicyDocument = DEVELOPER_POLICY) {
    validate(document);
    this.#document = document;
  }

  get document(): PolicyDocument {
    return this.#document;
  }

  get trust(): TrustTier {
    return this.#document.trust;
  }

  /**
   * Decide a single request.
   *
   * Ordering rule: the *most restrictive* matching decision wins, not the first
   * or the last. Rule files are edited by humans under time pressure, and
   * first-match-wins quietly turns a reordering into a privilege escalation.
   * Making `deny` absorb `allow` means adding a rule can only ever tighten.
   */
  evaluate(request: PolicyRequest): PolicyVerdict {
    if (request.action === 'exec') {
      const blocked = this.#checkExecDenylist(request);
      if (blocked) return blocked;
    }

    let winner: PolicyRule | null = null;
    let decision: Decision | null = null;

    for (const rule of this.#document.rules) {
      if (!ruleApplies(rule, request)) continue;
      if (decision === null || moreRestrictive(rule.decision, decision)) {
        decision = rule.decision;
        winner = rule;
      }
    }

    if (decision === null) {
      return {
        decision: this.#document.fallback,
        rule: null,
        reason: `No rule matched ${request.action} on ${request.target}; policy fallback is "${this.#document.fallback}".`,
      };
    }

    return {
      decision,
      rule: winner,
      reason: winner?.rationale ?? `Matched rule "${winner?.name}".`,
    };
  }

  #checkExecDenylist(request: PolicyRequest): PolicyVerdict | null {
    const dangerous = classifyHardDeniedInvocation(request.argv ?? [request.target]);
    if (!dangerous) return null;
    return {
      decision: 'deny',
      rule: null,
      reason: `"${dangerous.command}" is never permitted inside a container: ${dangerous.reason}.`,
    };
  }

  /** Whether a host is reachable. Subdomains match their allowlisted parent. */
  allowsHost(host: string): boolean {
    const normalized = host.toLowerCase().replace(/:\d+$/, '');
    return this.#document.networkAllowlist.some((allowed) => {
      const target = allowed.toLowerCase();
      return normalized === target || normalized.endsWith('.' + target);
    });
  }

  /** Narrow a policy at runtime. Cannot loosen: used when nesting containers. */
  restrict(overrides: Partial<PolicyDocument>): PolicyEngine {
    const next: PolicyDocument = {
      fallback: overrides.fallback
        ? mostRestrictive(overrides.fallback, this.#document.fallback)
        : this.#document.fallback,
      trust: overrides.trust ?? this.#document.trust,
      rules: [...this.#document.rules, ...(overrides.rules ?? [])],
      networkAllowlist: overrides.networkAllowlist
        ? // Intersection, never union — a child cannot reach a host its parent cannot.
          overrides.networkAllowlist.filter((host) => this.allowsHost(host))
        : this.#document.networkAllowlist,
    };
    return new PolicyEngine(next);
  }
}

const RESTRICTIVENESS: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };

function moreRestrictive(candidate: Decision, current: Decision): boolean {
  return RESTRICTIVENESS[candidate] > RESTRICTIVENESS[current];
}

function mostRestrictive(a: Decision, b: Decision): Decision {
  return RESTRICTIVENESS[a] >= RESTRICTIVENESS[b] ? a : b;
}

function ruleApplies(rule: PolicyRule, request: PolicyRequest): boolean {
  if (rule.actions !== '*' && !rule.actions.includes(request.action)) return false;
  if (rule.match !== undefined && !matchGlob(rule.match, request.target)) return false;
  if (rule.argvPattern !== undefined) {
    const line = (request.argv ?? [request.target]).join(' ');
    if (!new RegExp(rule.argvPattern).test(line)) return false;
  }
  return true;
}

/**
 * Segment-aware glob. `*` stops at `/`, `**` does not.
 *
 * Written by translating to a regex rather than by hand-rolling a matcher,
 * because the subtle bugs in hand-rolled path matchers are exactly the bugs
 * that become path-traversal advisories.
 */
export function matchGlob(pattern: string, target: string): boolean {
  const flags = process.platform === 'win32' ? 'i' : '';

  // A trailing `/**` matches the mount root itself, not only its contents.
  //
  // Without this, the most basic operation there is — listing the root of the
  // mounted project — matches no rule, falls through to the `ask` fallback, and
  // an unattended agent stalls on a permission prompt before doing anything. A
  // trailing `/**` reads as "this subtree", and a subtree includes its root.
  if (pattern.endsWith('/**')) {
    const root = pattern.slice(0, -3);
    if (root && new RegExp(`^${globToRegex(root)}$`, flags).test(target)) return true;
  }

  return new RegExp(`^${globToRegex(pattern)}$`, flags).test(target);
}

/**
 * Translate a glob to a regex.
 *
 * The two-star and one-star cases are swapped out for sentinels first, because
 * replacing `*` before `**` would turn the latter into two single-segment
 * wildcards and quietly stop it crossing directories. The sentinel is a private
 * use codepoint so it cannot occur in a real pattern.
 */
function globToRegex(pattern: string): string {
  const SLASH_STAR = '\uE000';
  const DOUBLE_STAR = '\uE001';

  return pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, SLASH_STAR)
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(new RegExp(SLASH_STAR, 'g'), '(?:.*/)?')
    .replace(new RegExp(DOUBLE_STAR, 'g'), '.*');
}

function validate(document: PolicyDocument): void {
  const names = new Set<string>();
  for (const rule of document.rules) {
    if (names.has(rule.name)) {
      throw new PlifError('POLICY_INVALID', `duplicate policy rule name "${rule.name}"`, {
        detail: { name: rule.name },
        hint: 'Rule names appear in the audit log, so they must be unique.',
      });
    }
    names.add(rule.name);

    if (rule.argvPattern !== undefined) {
      try {
        new RegExp(rule.argvPattern);
      } catch (error) {
        throw new PlifError(
          'POLICY_INVALID',
          `rule "${rule.name}" has an invalid argvPattern`,
          { cause: error, detail: { pattern: rule.argvPattern } },
        );
      }
    }
  }
  void isPathInside;
}
