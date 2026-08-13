// FR-2 / AD-8: URL mode. `git clone` here is the single sanctioned network
// operation in the entire system — every stage after it reads the temp
// checkout and nothing else.
//
// The clone is shallow by the analysis window, so a five-year repository costs
// the ninety days the run will actually look at. A server that refuses
// `--shallow-since` gets a full clone instead rather than a failed run.
//
// The temp directory is owned by the returned `dispose`, which the caller runs
// in a `finally` — success and failure both clean up (AC-4).
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { StageError } from "./errors.js";

const run = promisify(execFile);

/** The stage name this module aborts under (AD-7). */
export const CLONE_STAGE = "clone";

/** Directory name prefix for the checkout, so a stray temp dir is identifiable. */
export const TEMP_PREFIX = "gitnebula-clone-";

/**
 * Shapes a target has to have before it is even considered remote: a URL
 * scheme, an scp-style `git@host:path`, or a bare `host.tld/path`.
 */
const REMOTE_TARGET =
  /^(?:[a-z][a-z0-9+.-]*:\/\/|git@|[\w.-]+\.[a-z]{2,}[/:])/i;

/**
 * True when `target` should be treated as a remote repository: it looks like
 * one *and* no such path exists locally. Existence wins, because a directory
 * the user can point at is never a URL — `example.com/checkout` and
 * `repo.local/src` are perfectly good directory names.
 */
export function isRemoteTarget(target: string, cwd: string): boolean {
  if (!REMOTE_TARGET.test(target)) return false;
  // A scheme or an scp-style spec is unambiguous; only the host-like form can
  // collide with a directory name.
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/i.test(target)) return true;
  return !existsSync(resolve(cwd, target));
}

export interface CloneOptions {
  /** Analysis window in days; sets `--shallow-since`. */
  readonly windowDays: number;
  /** Instant the window is measured back from. Injectable for tests. */
  readonly now?: () => number;
  /** Test seam for the clone itself. Defaults to running real git. */
  readonly gitClone?: (args: readonly string[]) => Promise<void>;
  /**
   * Directory the checkout is created under. Defaults to the system temp
   * directory, which is what a real run uses.
   *
   * It is injectable so a test can assert on a directory it owns. Asserting
   * that cleanup happened by listing the *shared* temp directory is a race:
   * vitest runs this package's suites in parallel workers, and a neighbour
   * creating or disposing its own checkout between the snapshot and the
   * assertion makes the two listings differ for reasons that have nothing to
   * do with the code under test.
   */
  readonly tempDir?: string;
}

export interface Checkout {
  /** Working tree of the clone — the path the pipeline analyzes. */
  readonly root: string;
  /** Whether the shallow attempt succeeded, for the terminal line. */
  readonly shallow: boolean;
  /** Removes the temp directory. Idempotent; safe in a `finally`. */
  dispose(): void;
}

/**
 * Clones `url` into a fresh temp directory.
 *
 * The temp directory is created before the clone and removed by `dispose`
 * whatever happens — including when the clone itself fails, which is why the
 * failure path removes it before throwing (AC-4, AC-5).
 *
 * @throws {StageError} stage `clone` when neither the shallow nor the full
 * clone succeeds.
 */
export async function cloneRepository(
  url: string,
  options: CloneOptions,
): Promise<Checkout> {
  const parent = mkdtempSync(join(options.tempDir ?? tmpdir(), TEMP_PREFIX));
  const root = join(parent, "repo");

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    rmSync(parent, { recursive: true, force: true });
  };

  const gitClone = options.gitClone ?? defaultGitClone;
  const since = windowStart(
    options.windowDays,
    options.now ?? (() => Date.now()),
  );

  try {
    await gitClone([
      "clone",
      "--quiet",
      `--shallow-since=${since}`,
      "--no-single-branch",
      "--",
      url,
      root,
    ]);
    return { root, shallow: true, dispose };
  } catch (shallowFailure) {
    // FR-2's fallback. Any shallow failure retries as a full clone rather than
    // parsing git's stderr for "server does not support --shallow-since": that
    // text is not a contract, and a doomed second clone costs one round trip
    // while a mis-parse costs the run. See DECISIONS.md §6.
    rmSync(root, { recursive: true, force: true });
    try {
      await gitClone(["clone", "--quiet", "--", url, root]);
      return { root, shallow: false, dispose };
    } catch {
      dispose();
      throw new StageError(
        CLONE_STAGE,
        `cannot clone ${url}`,
        "check the URL or your network",
        { underlying: shallowFailure },
      );
    }
  }
}

/** ISO date `--shallow-since` accepts, `windowDays` before now. */
export function windowStart(windowDays: number, now: () => number): string {
  const start = new Date(now() - windowDays * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

async function defaultGitClone(args: readonly string[]): Promise<void> {
  await run("git", [...args], {
    // Never let git stop on a credential or host-key prompt: an interactive
    // hang is worse than an actionable failure, and this stage is the only
    // one allowed to touch the network at all (AD-8).
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
    },
  });
}
