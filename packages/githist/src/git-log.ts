// The one place githist spawns git — its single declared side effect (AD-3).
// Everything downstream of `readGitLog` is pure and testable without a
// repository.

import { spawn } from "node:child_process";

/** A file touched by a commit, as `--name-status` reports it. */
export interface RawChange {
  /** Single-letter status: `A`, `M`, `D`, `R`, `C`, `T`, `U`. */
  readonly status: string;
  /** Path after the change — the new name for a rename or copy. */
  readonly path: string;
  /** Path before the change; present only for renames and copies. */
  readonly oldPath?: string;
}

/** One commit of the analysis window, newest first. */
export interface RawCommit {
  readonly hash: string;
  /** Committer instant, unix seconds (see DECISIONS D2). */
  readonly committedAt: number;
  /** Lowercased committer-recorded author email — the author identity (D4). */
  readonly authorEmail: string;
  readonly changes: readonly RawChange[];
}

// Record and field separators. `git log -z` NUL-terminates every path and the
// header, so NUL cannot delimit commits; 0x1e/0x1f are the ASCII separators
// reserved for exactly this and can never appear in a hash, a unix timestamp
// or an email address. The commit message is deliberately not requested, so
// no user-controlled text reaches the header.
//
// A *path*, though, may legally contain 0x1e — POSIX forbids only NUL and `/`.
// So the record separator is never searched for across the stream: the stream
// is split on NUL, and a leading 0x1e is only ever tested at a position where
// a header may begin. Path tokens are consumed positionally and never
// inspected, which is what makes such a filename harmless.
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";
const LOG_FORMAT = `%x1e%H%x1f%ct%x1f%ae`;

/** Statuses that carry a second path (rename, copy). */
const TWO_PATH_STATUS = /^[RC]/;

/**
 * The exact argument list handed to git. Exported so the story README and the
 * tests quote one definition rather than two.
 *
 * `--follow` is deliberately absent and is banned by AD-13: it only works for
 * a single path, so following renames with it costs one git process per file
 * (thousands on a real repo) and it cannot observe co-change at all, since a
 * per-file log never shows which files moved together. `-M` gives the same
 * rename information inline, in the one pass this analyzer is allowed.
 *
 * `--no-merges` is deliberately absent too. Merges must stay in the stream
 * because `GitResult.commits` is contractually the repo-wide count and
 * `lastCommitAt` the newest instant in the window — on a merge-based workflow,
 * filtering them would undercount and could report a stale last-changed
 * instant. Their *file* records are another matter: git prints none for a
 * merge, and that is correct, since a merge's content already arrived through
 * the commits being merged. So a merge counts once, repo-wide, and attributes
 * to no node.
 *
 * The lower bound is `--since-as-filter`, not `--since`, whenever git supports
 * it. `--since` is a traversal *cutoff*: git stops walking when it meets a
 * commit older than the bound, so on a history whose dates are not monotonic —
 * clock skew, a rebase, an import — an in-window ancestor behind an
 * older-dated descendant is never visited at all. That is silent data loss, not
 * a slow path. `--since-as-filter` walks the reachable history and applies the
 * bound as a filter. `--until` needs no equivalent: it skips newer commits
 * without halting the walk.
 *
 * @param sinceAsFilter false selects the `--since` spelling, for the git
 * versions before 2.37 that do not know the filtering one. `readGitLog` only
 * falls back to it after git rejects the flag.
 */
export function gitLogArgs(
  sinceIso: string,
  untilIso: string,
  sinceAsFilter = true,
): string[] {
  return [
    "log",
    "-M",
    "-z",
    "--name-status",
    sinceAsFilter ? `--since-as-filter=${sinceIso}` : `--since=${sinceIso}`,
    `--until=${untilIso}`,
    `--format=${LOG_FORMAT}`,
  ];
}

/**
 * Parses the raw `git log` stream.
 *
 * `-z` makes the stream a flat sequence of NUL-terminated tokens, so the parse
 * is a small state machine over them rather than a search for delimiters: a
 * token is read as a commit header only where one may legally begin — at the
 * start, or after a change's paths have been consumed. Everywhere else the
 * token is a path, taken by position and never examined. That is what keeps a
 * filename containing the record separator (or a newline, or a quote) from
 * being mistaken for a new commit.
 */
export function parseGitLog(raw: string): RawCommit[] {
  const commits: RawCommit[] = [];
  const tokens = raw.split("\0");
  let changes: RawChange[] = [];
  let header: {
    hash: string;
    committedAt: number;
    authorEmail: string;
  } | null = null;

  const flush = (): void => {
    if (header !== null) commits.push({ ...header, changes });
    changes = [];
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i] ?? "";

    // Only tested here — a position where a status or a new commit may start.
    if (token.startsWith(RECORD_SEP)) {
      flush();
      const [hash = "", committedAt = "", ...rest] = token
        .slice(RECORD_SEP.length)
        .split(FIELD_SEP);
      header =
        hash.length === 0
          ? null
          : {
              hash,
              committedAt: Number.parseInt(committedAt, 10),
              // The email is the trailing field and is repository-controlled —
              // git lets a commit header carry almost any byte in it, 0x1f
              // included. Rejoining the remainder keeps such an address whole;
              // splitting it would truncate the identity and could merge two
              // distinct authors into one. The hash and timestamp before it are
              // fixed-format and cannot contain the separator.
              authorEmail: rest.join(FIELD_SEP).toLowerCase(),
            };
      i += 1;
      continue;
    }

    // git separates the header from the file list with a newline, which -z
    // leaves glued to the first status token ("\nR100"). Trimming is what
    // makes the first change parse like every other one.
    const status = token.trim();
    if (status.length === 0 || header === null) {
      i += 1;
      continue;
    }

    if (TWO_PATH_STATUS.test(status)) {
      const oldPath = tokens[i + 1];
      const path = tokens[i + 2];
      if (oldPath !== undefined && path !== undefined && path.length > 0) {
        changes.push({ status: status[0] ?? status, path, oldPath });
      }
      i += 3;
    } else {
      const path = tokens[i + 1];
      if (path !== undefined && path.length > 0) {
        changes.push({ status: status[0] ?? status, path });
      }
      i += 2;
    }
  }
  flush();

  return commits;
}

/** git's message when the repository exists but holds no commits yet (D10). */
const EMPTY_REPO = /does not have any commits yet|unknown revision/i;

/** git's complaint about a flag it is too old to know. */
const UNKNOWN_OPTION = /unknown option|unrecognized argument|usage: git log/i;

/**
 * Runs the single log pass over `[sinceIso, untilIso]` and returns its commits,
 * newest first. A repository with no commits yields an empty list; anything
 * else that fails throws with the cause, for cli to wrap in the AD-7 shape.
 *
 * Git older than 2.37 does not know `--since-as-filter`. Rather than probe the
 * version with an extra process on every run, the correct flag is tried first
 * and the older spelling used only if git rejects it — so current git pays
 * nothing, and ancient git still works, with `--since`'s traversal cutoff as
 * the documented cost.
 */
export async function readGitLog(
  repoRoot: string,
  sinceIso: string,
  untilIso: string,
): Promise<RawCommit[]> {
  try {
    return parseGitLog(
      await run("git", ["-C", repoRoot, ...gitLogArgs(sinceIso, untilIso)]),
    );
  } catch (cause) {
    if (!UNKNOWN_OPTION.test(String(cause))) throw cause;
    return parseGitLog(
      await run("git", [
        "-C",
        repoRoot,
        ...gitLogArgs(sinceIso, untilIso, false),
      ]),
    );
  }
}

function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Collected as chunks and joined once: git's output on a large repository
    // is many megabytes, and repeated string concatenation is what makes that
    // slow.
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));

    child.on("error", (cause: NodeJS.ErrnoException) => {
      reject(
        new Error(
          cause.code === "ENOENT"
            ? "git executable not found on PATH"
            : `failed to spawn git: ${cause.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) {
        resolve(Buffer.concat(out).toString("utf8"));
        return;
      }
      if (EMPTY_REPO.test(stderr)) {
        resolve("");
        return;
      }
      reject(
        new Error(
          `git log exited ${code ?? "with a signal"}: ${stderr.trim() || "no output"}`,
        ),
      );
    });
  });
}
