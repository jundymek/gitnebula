// FR-3 / AD-7: the terminal always tells you which stage is running and how
// long it took. Within-stage counts arrive through AD-3's `onProgress`.
//
// Everything is written to stderr so a caller can redirect the pipeline's
// human output without touching whatever it does with stdout. The stream, the
// TTY flag and the clock are injectable — the tests assert on the exact lines.
import { StageError, describeThrown } from "./errors.js";

/** AD-3's fire-and-forget progress callback. */
export type OnProgress = (done: number, total: number) => void;

export interface Reporter {
  /** A line printed before the pipeline starts, e.g. the AD-10 llm notice. */
  notice(message: string): void;
  /** A non-fatal, counted drop surfaced in the summary (AD-7). */
  warn(message: string): void;
  /**
   * Runs one pipeline stage between a start line and an end line carrying the
   * elapsed time. A thrown value that is not already a `StageError` is wrapped
   * in one named after this stage.
   */
  runStage<T>(
    name: string,
    run: (onProgress: OnProgress) => Promise<T>,
  ): Promise<T>;
  /** The closing line, printed after the file is written. */
  finish(message: string): void;
}

export interface ReporterOptions {
  readonly write?: (chunk: string) => void;
  /** When true, within-stage counts rewrite one line instead of stacking. */
  readonly isTty?: boolean;
  /** Injectable clock; cli is exempt from the AD-4 ban, its tests are not. */
  readonly now?: () => number;
}

/** Formats a duration the way the stage end lines do: `0.42s`, `1m 03.5s`. */
export function formatElapsed(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds - minutes * 60).toFixed(1)}s`;
}

export function createReporter(options: ReporterOptions = {}): Reporter {
  const write =
    options.write ?? ((chunk: string) => void process.stderr.write(chunk));
  const isTty = options.isTty ?? Boolean(process.stderr.isTTY);
  const now = options.now ?? (() => Date.now());

  // With two stages in flight (deps ∥ githist) a rewritten line would be
  // fought over by both, so counts fall back to plain lines while they
  // overlap. Those are decile-stepped, or a 2,000-file scan prints 2,000 times.
  let active = 0;
  let dirtyLine = false;

  const line = (text: string): void => {
    if (dirtyLine) {
      write("\n");
      dirtyLine = false;
    }
    write(`${text}\n`);
  };

  return {
    notice(message) {
      line(message);
    },

    warn(message) {
      line(`  ! ${message}`);
    },

    finish(message) {
      line(message);
    },

    async runStage(name, run) {
      const started = now();
      line(`▸ ${name}`);
      active += 1;

      let lastDecile = -1;
      const onProgress: OnProgress = (done, total) => {
        if (total <= 0) return;
        const text = `  ${name} ${done}/${total}`;
        if (active > 1 || !isTty) {
          const decile = Math.floor((done / total) * 10);
          if (decile === lastDecile) return;
          lastDecile = decile;
          line(text);
          return;
        }
        write(`\r${text}`);
        dirtyLine = true;
      };

      try {
        const result = await run(onProgress);
        line(`✔ ${name} (${formatElapsed(now() - started)})`);
        return result;
      } catch (error) {
        line(`✖ ${name} (${formatElapsed(now() - started)})`);
        if (error instanceof StageError) throw error;
        throw new StageError(
          name,
          describeThrown(error),
          "check the stage's inputs and re-run; if this persists it is a gitnebula bug — please report it",
          { underlying: error },
        );
      } finally {
        active -= 1;
      }
    },
  };
}

/** A reporter that prints nothing — used by tests and by non-interactive callers. */
export function createSilentReporter(): Reporter {
  return createReporter({ write: () => {}, isTty: false });
}
