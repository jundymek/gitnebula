// AD-7's abort shape. Per-item failures are collected as counted warnings and
// never reach here; a stage that cannot continue at all throws a StageError,
// which the entry point prints verbatim before exiting non-zero.

/**
 * A stage-level abort, rendered as `«stage»: «cause» — «remedy»` (AD-7).
 *
 * The remedy is not optional by accident: a failure a user cannot act on is
 * the thing this shape exists to prevent.
 */
export class StageError extends Error {
  /** Pipeline stage that failed, e.g. `repo`, `scan`, `deps`, `config`. */
  readonly stage: string;
  /** What went wrong, in the user's terms. */
  readonly cause: string;
  /** What the user can do about it. */
  readonly remedy: string;
  /** The original error, kept for debugging; never printed to the user. */
  readonly underlying: unknown;

  constructor(
    stage: string,
    cause: string,
    remedy: string,
    options?: { readonly underlying?: unknown },
  ) {
    super(`${stage}: ${cause} — ${remedy}`);
    this.name = "StageError";
    this.stage = stage;
    this.cause = cause;
    this.remedy = remedy;
    this.underlying = options?.underlying;
  }
}

/**
 * Narrows an unknown thrown value to its message, for use as a StageError
 * cause. Analyzers may throw anything; the terminal still needs one line.
 */
export function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
