import { classifyBackgroundDangerousInvocation } from '../execution/shell-safety.js';

/** Compatibility wrapper for callers that expect a reason string. */
export function classifyDangerousCommand(argv: readonly string[]): string | null {
  return classifyBackgroundDangerousInvocation(argv)?.reason ?? null;
}
