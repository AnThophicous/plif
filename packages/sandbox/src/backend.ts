/**
 * The isolation boundary, expressed as one interface that every OS backend
 * implements.
 *
 * The core never calls `child_process` directly. Everything that creates a
 * process goes through a `SandboxJail`, which means there is exactly one place
 * in the system where OS-level confinement can be forgotten — and it is this
 * file's job to make forgetting impossible.
 */

/**
 * How strong the confinement actually is. This is reported, never assumed:
 * `probe()` tells you what the machine could deliver, and the core refuses to
 * run untrusted work below the level the policy demands.
 */
export type IsolationLevel =
  /** No OS enforcement. Path jailing and policy only. Development use only. */
  | 'none'
  /** Process tree is capped and killable as a unit (Job Object / cgroup v2). */
  | 'job'
  /** The above plus a reduced-privilege security token; host writes are blocked. */
  | 'restricted-token'
  /** Separate kernel namespaces: own PID/mount/net view (Linux). */
  | 'namespace'
  /** Own kernel in a microVM (Firecracker / Hyper-V). Strongest. */
  | 'microvm';

/** Ordered weakest to strongest, for comparison. */
export const ISOLATION_ORDER: readonly IsolationLevel[] = [
  'none',
  'job',
  'restricted-token',
  'namespace',
  'microvm',
];

export function isolationAtLeast(actual: IsolationLevel, required: IsolationLevel): boolean {
  return ISOLATION_ORDER.indexOf(actual) >= ISOLATION_ORDER.indexOf(required);
}

/**
 * What a backend can enforce on this specific machine right now. Anything
 * `false` here is a hole the core must either accept explicitly or refuse to
 * run over — never silently paper over.
 */
export interface SandboxCapabilityReport {
  readonly backend: string;
  readonly platform: NodeJS.Platform;
  readonly isolation: IsolationLevel;
  /** Kill the entire process tree atomically, including orphaned grandchildren. */
  readonly killProcessTree: boolean;
  /** Hard ceiling on committed memory, enforced by the kernel. */
  readonly memoryLimit: boolean;
  /** Hard ceiling on live process count. */
  readonly processLimit: boolean;
  /** CPU throttling. */
  readonly cpuLimit: boolean;
  /** Deny writes outside the jail using OS access control, not path checks. */
  readonly filesystemWriteBlock: boolean;
  /** Deny outbound network at the OS level. */
  readonly networkBlock: boolean;
  /** Per-process CPU/memory accounting for the usage meters. */
  readonly accounting: boolean;
  /**
   * How child output is being decoded to text, e.g. "OEM codepage 850".
   * Surfaced because a wrong answer here quietly corrupts every transcript the
   * agent reads, and the symptom (mojibake) looks like someone else's bug.
   */
  readonly textEncoding: string;
  /** Human-readable reasons any of the above came back false. */
  readonly degradations: readonly string[];
}

export interface JailOptions {
  /** Stable identifier used to name OS objects. Appears in Process Explorer. */
  readonly id: string;
  /** Absolute host path that is the jail's root. Processes start here. */
  readonly root: string;
  readonly memoryBytes: number;
  readonly maxProcesses: number;
  readonly cpuCores: number;
  /** Host paths the jail may write to, beyond `root`. Absolute, normalised. */
  readonly writablePaths: readonly string[];
  /** When false, the backend blocks outbound network for the whole jail. */
  readonly allowNetwork: boolean;
  readonly mounts: readonly SandboxMount[];
}

export interface SandboxMount {
  readonly source: string;
  readonly target: string;
  readonly mode: 'ro' | 'rw';
  readonly mask?: readonly string[];
}

export interface SpawnOptions {
  readonly argv: readonly string[];
  /** Absolute host path. Must resolve inside the jail root or a writable path. */
  readonly cwd: string;
  readonly virtualCwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdin?: string;
  /** Stop collecting output past this many bytes and set `truncated`. */
  readonly maxOutputBytes: number;
  /** Cooperative cancellation from the agent loop. */
  readonly signal?: AbortSignal;
  /**
   * Called as output arrives, before the process exits.
   *
   * Without this the caller only sees output once the command is over, which
   * for anything slower than a second reads as a hang. Chunks are delivered in
   * arrival order and are *not* line-buffered — a consumer that needs whole
   * lines must buffer them itself. Delivery stops once `maxOutputBytes` is hit,
   * matching what ends up in the final result.
   */
  readonly onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

export interface SpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly durationMs: number;
  readonly killedBy?: 'timeout' | 'memory' | 'processes' | 'cancelled';
}

export type TerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';

export interface TerminalOptions {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly virtualCwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly maxOutputBytes: number;
  readonly ownerId?: string;
  readonly sessionId?: string;
  readonly containerId?: string;
}

export interface TerminalOutput {
  readonly stream: 'stdout' | 'stderr';
  readonly chunk: string;
  readonly at: number;
}

export interface SandboxTerminal extends AsyncDisposable {
  readonly id: string;
  readonly ownerId?: string;
  readonly sessionId?: string;
  readonly containerId?: string;
  write(input: string): Promise<void>;
  readAvailable(): Promise<readonly TerminalOutput[]>;
  read(): AsyncGenerator<TerminalOutput>;
  resize(columns: number, rows: number): Promise<void>;
  signal(signal: TerminalSignal): Promise<void>;
  wait(): Promise<SpawnResult>;
  close(): Promise<void>;
}

export interface JailStats {
  readonly peakMemoryBytes: number;
  readonly activeProcesses: number;
  readonly totalProcesses: number;
  readonly cpuMillis: number;
}

/**
 * A live confinement. Holds OS resources, so it must be disposed — the backends
 * tie process-tree termination to disposal, so a leaked jail is a leaked
 * process tree.
 */
export interface SandboxJail extends AsyncDisposable {
  readonly id: string;
  readonly root: string;
  spawn(options: SpawnOptions): Promise<SpawnResult>;
  openTerminal(options: TerminalOptions): Promise<SandboxTerminal>;
  stats(): Promise<JailStats>;
  /** Terminate every process in the jail immediately. Idempotent. */
  kill(reason: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface SandboxBackend {
  readonly id: string;
  /** Cheap, cached, side-effect free. Safe to call at startup. */
  probe(): Promise<SandboxCapabilityReport>;
  createJail(options: JailOptions): Promise<SandboxJail>;
}
