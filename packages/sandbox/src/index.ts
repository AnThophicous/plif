export * from './backend.js';
export { Win32Backend } from './win32/backend.js';
export { LinuxBackend } from './linux/backend.js';
export { PortableBackend } from './portable/backend.js';

import type { SandboxBackend, SandboxCapabilityReport } from './backend.js';
import { PortableBackend } from './portable/backend.js';
import { Win32Backend } from './win32/backend.js';
import { LinuxBackend } from './linux/backend.js';

export interface BackendSelection {
  readonly backend: SandboxBackend;
  readonly report: SandboxCapabilityReport;
  /** Backends that were tried and rejected, with the reason. */
  readonly rejected: readonly { id: string; reason: string }[];
}

/**
 * Pick the strongest backend this machine can actually provide.
 *
 * Selection is by probe, never by `process.platform` alone: a Windows box
 * without working FFI must land on the portable backend with its degradations
 * visible, not on a Win32 backend that silently enforces nothing.
 */
export async function selectBackend(): Promise<BackendSelection> {
  const rejected: { id: string; reason: string }[] = [];
  const candidates: SandboxBackend[] = [];

  if (process.platform === 'win32') candidates.push(new Win32Backend());
  if (process.platform === 'linux') candidates.push(new LinuxBackend());
  // Linux namespace and microVM backends slot in here, strongest first.

  for (const backend of candidates) {
    const report = await backend.probe();
    if (report.isolation !== 'none') {
      return { backend, report, rejected };
    }
    rejected.push({
      id: backend.id,
      reason: report.degradations[0] ?? 'probe reported no isolation',
    });
  }

  const fallback = new PortableBackend();
  return { backend: fallback, report: await fallback.probe(), rejected };
}
