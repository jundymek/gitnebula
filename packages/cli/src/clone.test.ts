// AC-4/AC-5. The "remote" is a local repository addressed as `file://`, which
// is a real git transport — git ignores `--shallow-since` for a plain local
// path, so a bare path would exercise the fallback and call it the shallow
// case. Nothing here reaches the network (AD-8): the failure cases point at a
// closed loopback port.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  TEMP_PREFIX,
  cloneRepository,
  isRemoteTarget,
  windowStart,
  type Checkout,
} from "./clone.js";
import { StageError } from "./errors.js";
import { git, makeTempDir, removeAll } from "./test-support.js";

const temps: string[] = [];
const checkouts: Checkout[] = [];

afterEach(() => {
  while (checkouts.length > 0) (checkouts.pop() as Checkout).dispose();
  removeAll(temps);
});

/**
 * A URL git can actually clone from, with one commit far outside any sane
 * analysis window and one inside it. The gap is the point: a clone that
 * fetches both did not honour `--shallow-since`.
 */
function makeOriginUrl(): string {
  const dir = join(makeTempDir(temps, "gitnebula-origin-"), "origin");
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "fixture@example.invalid");
  git(dir, "config", "user.name", "Fixture");

  writeFileSync(join(dir, "README.md"), "# origin\n");
  git(dir, "add", ".");
  commitAt(dir, "chore: ancient", ANCIENT_COMMIT_DATE);

  writeFileSync(join(dir, "second.txt"), "second\n");
  git(dir, "add", ".");
  commitAt(dir, "chore: recent", RECENT_COMMIT_DATE);

  return `file://${dir}`;
}

/** Well before any window this test uses. */
const ANCIENT_COMMIT_DATE = "2015-01-01T00:00:00Z";
/** Inside the 90-day window measured back from {@link CLONE_NOW}. */
const RECENT_COMMIT_DATE = "2026-08-01T00:00:00Z";
const CLONE_NOW = Date.parse("2026-08-13T00:00:00Z");

/** `git commit` with both dates pinned — `--shallow-since` reads the committer date. */
function commitAt(cwd: string, subject: string, date: string): void {
  execFileSync("git", ["commit", "-q", "-m", subject], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Names of the clone temp directories currently in the system temp dir. */
function cloneTemps(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX));
}

describe("a URL is told apart from a path (AC-4)", () => {
  const cwd = process.cwd();

  it("recognises schemes and scp-style specs", () => {
    expect(isRemoteTarget("https://github.com/owner/thing", cwd)).toBe(true);
    expect(isRemoteTarget("git@github.com:owner/thing.git", cwd)).toBe(true);
    expect(isRemoteTarget("github.com/owner/thing", cwd)).toBe(true);
  });

  it("treats anything that exists on disk as a path", () => {
    const dir = makeTempDir(temps, "gitnebula-target-");
    mkdirSync(join(dir, "example.com"));

    expect(isRemoteTarget(".", cwd)).toBe(false);
    expect(isRemoteTarget("packages/cli", cwd)).toBe(false);
    expect(isRemoteTarget("example.com", dir)).toBe(false);
  });
});

describe("the shallow clone and its temp directory (AC-4)", () => {
  it("clones into a temp dir the caller can analyze, then dispose", async () => {
    const checkout = await cloneRepository(makeOriginUrl(), {
      windowDays: 90,
      now: () => CLONE_NOW,
    });
    checkouts.push(checkout);

    expect(checkout.shallow).toBe(true);
    expect(existsSync(join(checkout.root, "second.txt"))).toBe(true);
    // The window covers the recent commit only, so the 2015 one is grafted
    // away — the whole reason to pass `--shallow-since` at all (FR-2).
    expect(git(checkout.root, "rev-parse", "--is-shallow-repository")).toBe(
      "true",
    );
    expect(git(checkout.root, "rev-list", "--count", "HEAD")).toBe("1");

    checkout.dispose();
    expect(existsSync(checkout.root)).toBe(false);
  });

  it("asks git for exactly the analysis window", async () => {
    const calls: string[][] = [];
    const checkout = await cloneRepository("https://example.invalid/x.git", {
      windowDays: 30,
      now: () => CLONE_NOW,
      gitClone: async (args) => {
        calls.push([...args]);
        mkdirSync(args[args.length - 1] as string, { recursive: true });
      },
    });
    checkouts.push(checkout);

    expect(calls[0]).toContain("--shallow-since=2026-07-14T00:00:00.000Z");
    expect(windowStart(30, () => CLONE_NOW)).toBe("2026-07-14T00:00:00.000Z");
  });

  it("falls back to a full clone when the shallow one is refused", async () => {
    const attempts: string[][] = [];
    const checkout = await cloneRepository("https://example.invalid/x.git", {
      windowDays: 90,
      gitClone: async (args) => {
        attempts.push([...args]);
        if (attempts.length === 1)
          throw new Error("Server does not support --shallow-since");
        mkdirSync(args[args.length - 1] as string, { recursive: true });
      },
    });
    checkouts.push(checkout);

    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.some((arg) => arg.startsWith("--shallow-since"))).toBe(
      false,
    );
    expect(checkout.shallow).toBe(false);
  });

  it("removes the temp directory when the run fails after the clone", async () => {
    const before = cloneTemps();
    const checkout = await cloneRepository(makeOriginUrl(), { windowDays: 90 });

    // What `run`'s `finally` does when the pipeline throws.
    checkout.dispose();

    expect(cloneTemps()).toEqual(before);
    expect(existsSync(checkout.root)).toBe(false);
  });

  it("is safe to dispose twice", async () => {
    const checkout = await cloneRepository(makeOriginUrl(), { windowDays: 90 });
    checkout.dispose();
    expect(() => checkout.dispose()).not.toThrow();
  });
});

describe("an unreachable URL aborts in the AD-7 shape (AC-5)", () => {
  it("names the URL, suggests the remedy, and leaves no temp dir", async () => {
    const before = cloneTemps();
    // Loopback, port 1: refused immediately, so the test neither waits on a
    // DNS timeout nor touches the network (AD-8).
    const url = "http://127.0.0.1:1/nothing.git";

    const attempt = cloneRepository(url, { windowDays: 90 });
    await expect(attempt).rejects.toThrow(StageError);
    await expect(attempt).rejects.toThrow(
      `clone: cannot clone ${url} — check the URL or your network`,
    );
    expect(cloneTemps()).toEqual(before);
  });

  it("quotes the shallow attempt's git output as the underlying cause", async () => {
    const attempt = cloneRepository("https://example.invalid/x.git", {
      windowDays: 90,
      gitClone: async (args) => {
        throw new Error(
          args.some((arg) => arg.startsWith("--shallow-since"))
            ? "shallow failure"
            : "full failure",
        );
      },
    });

    await expect(attempt).rejects.toMatchObject({
      stage: "clone",
      underlying: expect.objectContaining({ message: "shallow failure" }),
    });
  });
});
