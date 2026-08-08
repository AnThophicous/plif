/**
 * Every failure the core raises is a PlifError with a stable machine-readable
 * code. The CLI renders `code` as a dim tag next to the message, and the audit
 * log indexes on it, so codes are part of the public contract — rename with care.
 */
export type PlifErrorCode =
  // container lifecycle
  | 'CONTAINER_NOT_FOUND'
  | 'CONTAINER_EXISTS'
  | 'CONTAINER_BAD_STATE'
  | 'CONTAINER_LIMIT_REACHED'
  // images and layers
  | 'IMAGE_NOT_FOUND'
  | 'IMAGE_EXISTS'
  | 'LAYER_CORRUPT'
  | 'MANIFEST_INVALID'
  // filesystem jail
  | 'PATH_ESCAPE'
  | 'PATH_NOT_FOUND'
  | 'PATH_NOT_A_FILE'
  | 'PATH_NOT_A_DIRECTORY'
  | 'MOUNT_READONLY'
  | 'MOUNT_CONFLICT'
  // policy and permission
  | 'POLICY_DENIED'
  | 'POLICY_INVALID'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_DENIED'
  | 'APPROVAL_TIMEOUT'
  // resource governance
  | 'QUOTA_DISK'
  | 'QUOTA_MEMORY'
  | 'QUOTA_PROCESSES'
  | 'QUOTA_WALL_CLOCK'
  | 'QUOTA_OUTPUT'
  // execution
  | 'EXEC_FAILED'
  | 'EXEC_TIMEOUT'
  | 'EXEC_KILLED'
  | 'SANDBOX_UNAVAILABLE'
  | 'SANDBOX_DEGRADED'
  // model provider
  | 'MODEL_AUTH'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_RATE_LIMIT'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_TIMEOUT'
  | 'MODEL_ERROR'
  | 'MODEL_NOT_CONFIGURED'
  // language server
  | 'LSP_UNAVAILABLE'
  // reaching something outside the machine: a marketplace, a registry
  | 'NETWORK_ERROR'
  // generic
  | 'INVALID_ARGUMENT'
  | 'INTERNAL';

export interface PlifErrorOptions {
  /** Structured detail rendered under the message and stored in the audit log. */
  readonly detail?: Record<string, unknown>;
  /** Underlying error, preserved for stack traces. */
  readonly cause?: unknown;
  /**
   * A short, imperative hint shown to the developer in the CLI.
   * Write it as the next action to take, not as a restatement of the problem.
   */
  readonly hint?: string;
}

export class PlifError extends Error {
  readonly code: PlifErrorCode;
  readonly detail: Record<string, unknown>;
  readonly hint: string | undefined;

  constructor(code: PlifErrorCode, message: string, options: PlifErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PlifError';
    this.code = code;
    this.detail = options.detail ?? {};
    this.hint = options.hint;
  }

  /** Serialisable shape for the audit log and for crossing a process boundary. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      detail: this.detail,
      ...(this.hint ? { hint: this.hint } : {}),
    };
  }

  static is(value: unknown): value is PlifError {
    return value instanceof PlifError;
  }

  /** True when the failure came from the policy layer refusing an action. */
  static isDenial(value: unknown): boolean {
    return (
      PlifError.is(value) &&
      (value.code === 'POLICY_DENIED' ||
        value.code === 'APPROVAL_DENIED' ||
        value.code === 'APPROVAL_TIMEOUT' ||
        value.code === 'PATH_ESCAPE' ||
        value.code === 'MOUNT_READONLY')
    );
  }

  /** True when retrying the same action could plausibly succeed. */
  static isTransient(value: unknown): boolean {
    return (
      PlifError.is(value) &&
      (value.code === 'EXEC_TIMEOUT' ||
        value.code === 'QUOTA_WALL_CLOCK' ||
        value.code === 'CONTAINER_LIMIT_REACHED' ||
        // A rate limit or a 5xx clears on its own; a bad key or a missing model
        // never does, so those stay out of this list however tempting.
        value.code === 'MODEL_RATE_LIMIT' ||
        value.code === 'MODEL_UNAVAILABLE' ||
        value.code === 'MODEL_TIMEOUT')
    );
  }
}

/** Narrow an unknown thrown value into a PlifError, wrapping anything foreign. */
export function toPlifError(value: unknown, fallbackCode: PlifErrorCode = 'INTERNAL'): PlifError {
  if (PlifError.is(value)) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new PlifError(fallbackCode, message, { cause: value });
}
