/**
 * The vocabulary of the Plif container model.
 *
 * The mental model is deliberately Docker-shaped so it transfers: an **image**
 * is an immutable, content-addressed stack of **layers**; a **container** is a
 * running instance of an image plus one writable layer on top; **mounts** graft
 * host directories into the container's virtual filesystem. What differs is
 * that all of it lives inside our process rather than in a daemon, and the
 * isolation boundary is enforced by the host OS primitives in @plif/sandbox.
 */

/** Lowercase hex sha256, no algorithm prefix. */
export type Digest = string;

/** An identifier the user types: container name or 12-char short id. */
export type Ref = string;

// ---------------------------------------------------------------------------
// Layers and images
// ---------------------------------------------------------------------------

/**
 * A layer is an immutable directory of file changes, content-addressed by the
 * digest of its manifest. Layers are shared: two containers built from the same
 * image reference the same on-disk layer directories and never copy them.
 */
export interface Layer {
  readonly digest: Digest;
  /** Human label, e.g. "node-22-toolchain". Not unique, not part of the digest. */
  readonly name: string;
  /** Bytes of unique content this layer adds. */
  readonly size: number;
  readonly createdAt: string;
  /** Files this layer adds or replaces, keyed by container-absolute path. */
  readonly entries: readonly LayerEntry[];
}

export interface LayerEntry {
  /** Container-absolute POSIX path, e.g. "/project/src/index.ts". */
  readonly path: string;
  readonly kind: 'file' | 'directory' | 'symlink' | 'whiteout';
  readonly size: number;
  /** Digest of the file content; absent for directories and whiteouts. */
  readonly digest?: Digest;
  /** Target path, for symlinks only. */
  readonly target?: string;
  /** POSIX-style mode; advisory on Windows, enforced on Linux. */
  readonly mode: number;
}

/**
 * The default runtime shape baked into an image. A container may narrow these
 * but never widen them — an image that declares no network cannot be run with
 * network enabled, which is what makes an image a meaningful trust unit.
 */
export interface ImageConfig {
  readonly workdir: string;
  readonly env: Readonly<Record<string, string>>;
  /** Argv prefix prepended to every exec, e.g. ["pwsh", "-NoProfile", "-Command"]. */
  readonly entrypoint: readonly string[];
  /** The ceiling on what containers from this image may be granted. */
  readonly capabilities: CapabilitySet;
  readonly limits: ResourceLimits;
}

export interface Image {
  readonly digest: Digest;
  /** "name:tag", e.g. "plif/base:0.1". */
  readonly reference: string;
  readonly createdAt: string;
  /** Ordered lowest-to-highest. Later layers shadow earlier ones. */
  readonly layers: readonly Digest[];
  readonly config: ImageConfig;
  /** Free-form provenance: builder version, source commit, signature. */
  readonly labels: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Capabilities — what a container is permitted to attempt at all
// ---------------------------------------------------------------------------

/**
 * Capabilities are coarse on/off switches checked before the fine-grained
 * policy rules run. They exist so that a whole class of action can be removed
 * from a container's reach without having to reason about rule ordering.
 */
export interface CapabilitySet {
  /** Read files inside the container's virtual filesystem. */
  readonly fsRead: boolean;
  /** Write to the container's writable layer. Never implies host writes. */
  readonly fsWrite: boolean;
  /** Write through a mount marked rw, i.e. mutate real host files. */
  readonly hostWrite: boolean;
  /** Spawn processes via the sandbox backend. */
  readonly exec: boolean;
  /** Outbound network. Which hosts is decided by the policy rules. */
  readonly network: boolean;
  /** Read process environment inherited from the host. */
  readonly envRead: boolean;
  /** Create and control nested child containers. */
  readonly spawnContainers: boolean;
}

export const NO_CAPABILITIES: CapabilitySet = Object.freeze({
  fsRead: false,
  fsWrite: false,
  hostWrite: false,
  exec: false,
  network: false,
  envRead: false,
  spawnContainers: false,
});

/**
 * The default for an agent working in a repository: it can read and write its
 * own layer freely, run processes, but cannot touch host files or the network
 * until a mount or a policy rule says so.
 */
export const DEFAULT_CAPABILITIES: CapabilitySet = Object.freeze({
  fsRead: true,
  fsWrite: true,
  hostWrite: false,
  exec: true,
  network: false,
  envRead: true,
  spawnContainers: false,
});

// ---------------------------------------------------------------------------
// Resource limits
// ---------------------------------------------------------------------------

/**
 * Every limit is enforced somewhere concrete: memory and process count by the
 * OS (Job Object on Windows, cgroup v2 on Linux), disk and output by the core's
 * own accounting, wall clock by a timer that kills the job. A limit of 0 means
 * "deny entirely"; omit the field to inherit the image default.
 */
export interface ResourceLimits {
  /** Peak committed memory across the whole container, in bytes. */
  readonly memoryBytes: number;
  /** Max concurrently live processes, including the shell that launched them. */
  readonly maxProcesses: number;
  /** Total bytes the writable layer may accumulate. */
  readonly diskWriteBytes: number;
  /** Wall clock for a single exec, in milliseconds. */
  readonly execTimeoutMs: number;
  /** Wall clock for the container as a whole, in milliseconds. 0 = unbounded. */
  readonly lifetimeMs: number;
  /** Bytes of stdout+stderr retained per exec before truncation. */
  readonly outputBytes: number;
  /** CPU cap as a fraction of one core; 2 means two full cores. */
  readonly cpuCores: number;
}

export const DEFAULT_LIMITS: ResourceLimits = Object.freeze({
  memoryBytes: 2 * 1024 * 1024 * 1024,
  maxProcesses: 64,
  diskWriteBytes: 512 * 1024 * 1024,
  execTimeoutMs: 120_000,
  lifetimeMs: 0,
  outputBytes: 2 * 1024 * 1024,
  cpuCores: 2,
});

// ---------------------------------------------------------------------------
// Mounts
// ---------------------------------------------------------------------------

/**
 * A mount grafts a real host directory into the container's virtual path space.
 * This is the only way host state enters a container, which makes the mount
 * table the single place to audit when asking "what can this agent reach?".
 */
export interface Mount {
  /** Absolute host path. Resolved and symlink-checked at attach time. */
  readonly source: string;
  /** Container-absolute POSIX path exposed as the process working tree. */
  readonly target: string;
  readonly mode: 'ro' | 'rw';
  /**
   * Paths under `target` that are masked even though they exist on the host.
   * Use for secrets that live inside an otherwise mountable tree (.env, .git/config).
   */
  readonly mask?: readonly string[];
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

/**
 * created → running ⇄ paused → exited → removed
 *
 * `exited` is terminal for execution but the writable layer survives, so it can
 * still be inspected and committed to a new image. `removed` discards it.
 */
export type ContainerState = 'created' | 'running' | 'paused' | 'exited' | 'removed';

export interface ContainerSpec {
  /** Unique, user-facing. Generated from an adjective-noun pair if omitted. */
  readonly name: string;
  /** Image reference or digest this container instantiates. */
  readonly image: string;
  readonly mounts: readonly Mount[];
  /** Narrowing overrides on top of the image config. Cannot widen. */
  readonly capabilities?: Partial<CapabilitySet>;
  readonly limits?: Partial<ResourceLimits>;
  readonly env?: Readonly<Record<string, string>>;
  readonly workdir?: string;
  readonly labels?: Readonly<Record<string, string>>;
}

export interface ContainerStatus {
  readonly state: ContainerState;
  readonly startedAt: string | undefined;
  readonly exitedAt: string | undefined;
  readonly exitCode: number | undefined;
  /** Set when the container was terminated by the core rather than exiting. */
  readonly killedBy: string | undefined;
  readonly usage: ResourceUsage;
}

export interface ResourceUsage {
  readonly peakMemoryBytes: number;
  readonly diskWrittenBytes: number;
  readonly execCount: number;
  readonly liveProcesses: number;
  readonly cpuMillis: number;
}

export const ZERO_USAGE: ResourceUsage = Object.freeze({
  peakMemoryBytes: 0,
  diskWrittenBytes: 0,
  execCount: 0,
  liveProcesses: 0,
  cpuMillis: 0,
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ExecRequest {
  readonly argv: readonly string[];
  /** Container-absolute. Defaults to the container's workdir. */
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly stdin?: string;
  /** Free-text justification recorded in the audit log; shown on approval prompts. */
  readonly reason?: string;
  /**
   * Cancel just this exec. Merged with the container's own abort, so cancelling
   * one command never implies tearing the container down.
   */
  readonly signal?: AbortSignal;
}

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** True when output was cut at the container's `outputBytes` limit. */
  readonly truncated: boolean;
  readonly durationMs: number;
  /** Set when the core killed the process: 'timeout' | 'memory' | 'cancelled'. */
  readonly killedBy?: string;
}
