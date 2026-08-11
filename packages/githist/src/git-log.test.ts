import { describe, expect, it } from "vitest";

import { gitLogArgs, parseGitLog } from "./git-log.js";

// Framing captured from real `git log -z --name-status -M --format=...` output
// against the built fixture repo, written with explicit escapes so it is
// visible rather than invisible whitespace: 0x1e between commits, 0x1f between
// header fields, NUL after the header and after every path — and a newline
// glued to the FIRST status token, which is how git separates the header from
// the file list even under -z. Getting that newline wrong is what this helper
// exists to prevent.
const RS = "\x1e";
const US = "\x1f";
const NUL = "\0";

function record(
  hash: string,
  ts: string,
  email: string,
  ...tokens: string[]
): string {
  const header = `${RS}${hash}${US}${ts}${US}${email}${NUL}`;
  if (tokens.length === 0) return header;
  return `${header}\n${tokens.join(NUL)}${NUL}`;
}

describe("gitLogArgs", () => {
  it("asks for one -M --name-status pass over the window", () => {
    const args = gitLogArgs(
      "2025-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    expect(args).toEqual([
      "log",
      "-M",
      "-z",
      "--name-status",
      "--since=2025-01-01T00:00:00.000Z",
      "--until=2026-01-01T00:00:00.000Z",
      "--format=%x1e%H%x1f%ct%x1f%ae",
    ]);
  });

  it("never passes --follow (banned by AD-13)", () => {
    expect(gitLogArgs("a", "b")).not.toContain("--follow");
  });

  it("keeps merges in the stream, so the repo-wide count stays repo-wide", () => {
    // git prints no file records for a merge, so it attributes to no node —
    // but it is still a commit in the window and must be counted as one.
    expect(gitLogArgs("a", "b")).not.toContain("--no-merges");
  });
});

describe("parseGitLog", () => {
  it("returns an empty list for empty output", () => {
    expect(parseGitLog("")).toEqual([]);
  });

  it("reads header fields and lowercases the author email", () => {
    const [commit] = parseGitLog(
      record(
        "abc123",
        "1751270400",
        "Ben@Fixture.Invalid",
        "M",
        "core/scoring.py",
      ),
    );
    expect(commit).toEqual({
      hash: "abc123",
      committedAt: 1_751_270_400,
      authorEmail: "ben@fixture.invalid",
      changes: [{ status: "M", path: "core/scoring.py" }],
    });
  });

  it("reads a rename record's two paths and keeps the old one", () => {
    const [commit] = parseGitLog(
      record(
        "r1",
        "1743851700",
        "ada@fixture.invalid",
        "R100",
        "core/score.py",
        "core/scoring.py",
      ),
    );
    expect(commit?.changes).toEqual([
      { status: "R", path: "core/scoring.py", oldPath: "core/score.py" },
    ]);
  });

  it("reads a copy record, which also carries two paths", () => {
    const [commit] = parseGitLog(
      record("c1", "1", "a@b.c", "C75", "core/a.py", "core/b.py"),
    );
    expect(commit?.changes).toEqual([
      { status: "C", path: "core/b.py", oldPath: "core/a.py" },
    ]);
  });

  it("keeps single- and two-path records straight in one commit", () => {
    const [commit] = parseGitLog(
      record(
        "mixed",
        "1",
        "a@b.c",
        "M",
        "web/api.ts",
        "R100",
        "core/score.py",
        "core/scoring.py",
        "A",
        "web/new.ts",
      ),
    );
    expect(commit?.changes).toEqual([
      { status: "M", path: "web/api.ts" },
      { status: "R", path: "core/scoring.py", oldPath: "core/score.py" },
      { status: "A", path: "web/new.ts" },
    ]);
  });

  it("splits several commits and keeps git's newest-first order", () => {
    const commits = parseGitLog(
      record("newest", "300", "a@b.c", "M", "a.ts") +
        record("middle", "200", "b@b.c", "M", "b.ts") +
        record("oldest", "100", "c@b.c", "A", "a.ts", "A", "b.ts"),
    );
    expect(commits.map((commit) => commit.hash)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
    expect(commits[2]?.changes).toHaveLength(2);
  });

  it("handles a commit with no file records", () => {
    const commits = parseGitLog(record("empty", "1", "a@b.c"));
    expect(commits).toEqual([
      { hash: "empty", committedAt: 1, authorEmail: "a@b.c", changes: [] },
    ]);
  });

  it("preserves paths containing spaces, quotes and non-ASCII", () => {
    const path = 'web/a b"ć.ts';
    const [commit] = parseGitLog(record("odd", "1", "a@b.c", "M", path));
    expect(commit?.changes[0]?.path).toBe(path);
  });
});
