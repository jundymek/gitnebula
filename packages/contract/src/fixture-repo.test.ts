import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const buildScript = join(repoRoot, "test-fixtures", "build-fixture-repo.sh");
const generatedRepo = join(
  repoRoot,
  "test-fixtures",
  ".generated",
  "history-repo",
);

// Fixture tests pin the analysis window to this anchor (AD-13); the crafted
// history deliberately places some commits outside it.
const WINDOW_ANCHOR = Date.parse("2026-01-01T00:00:00Z");
const WINDOW_DAYS = 365;
const WINDOW_START = WINDOW_ANCHOR - WINDOW_DAYS * 86_400_000;

interface FixtureCommit {
  hash: string;
  author: string;
  authoredAt: number;
  /** name-status entries, e.g. `M\tweb/api.ts` or `R100\told\tnew`. */
  changes: string[];
}

// The builder prints the HEAD hash as its last line (AD-14).
function buildAndGetHead(): string {
  const output = execFileSync("sh", [buildScript], { encoding: "utf8" });
  const lines = output.trim().split("\n");
  return lines[lines.length - 1] ?? "";
}

// A NUL record separator is used because --name-status puts a blank line
// between the header and the file list, so blank lines cannot delimit commits.
function readHistory(): FixtureCommit[] {
  const raw = execFileSync(
    "git",
    [
      "-C",
      generatedRepo,
      "log",
      "--name-status",
      "--find-renames",
      "--format=%x00%H|%an|%aI",
    ],
    { encoding: "utf8" },
  );

  return raw
    .split("\0")
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [header = "", ...rest] = record.trim().split("\n");
      const [hash = "", author = "", authoredAt = ""] = header.split("|");
      return {
        hash,
        author,
        authoredAt: Date.parse(authoredAt),
        changes: rest.filter((line) => line.trim().length > 0),
      };
    });
}

function commitsTouching(history: FixtureCommit[], path: string) {
  return history.filter((commit) =>
    commit.changes.some((change) => change.split("\t").includes(path)),
  );
}

describe("fixture repo builder (AD-14)", () => {
  it("produces identical commit hashes across two builds", () => {
    const first = buildAndGetHead();
    const second = buildAndGetHead();
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    expect(second).toBe(first);
  });

  it("records a rename with content preserved", () => {
    buildAndGetHead();
    const renames = readHistory().flatMap((commit) =>
      commit.changes.filter((change) => change.startsWith("R")),
    );
    expect(renames).toContain("R100\tcore/score.py\tcore/scoring.py");
  });

  it("contains a multi-file commit as a co-change source", () => {
    buildAndGetHead();
    const multiFile = readHistory().filter(
      (commit) => commit.changes.length > 1,
    );
    expect(multiFile.length).toBeGreaterThan(0);
  });

  it("has a file touched by three distinct authors", () => {
    buildAndGetHead();
    const authors = new Set(
      commitsTouching(readHistory(), "web/api.ts").map(
        (commit) => commit.author,
      ),
    );
    expect(authors).toEqual(
      new Set(["Ada Fixture", "Ben Fixture", "Cara Fixture"]),
    );
  });

  it("has a file whose only commits predate the analysis window", () => {
    buildAndGetHead();
    const legacy = commitsTouching(readHistory(), "legacy/old.ts");
    expect(legacy.length).toBeGreaterThan(0);
    for (const commit of legacy) {
      expect(commit.authoredAt).toBeLessThan(WINDOW_START);
    }
  });

  it("mixes Python and TypeScript files", () => {
    buildAndGetHead();
    const paths = new Set(
      readHistory().flatMap((commit) =>
        commit.changes.flatMap((change) => change.split("\t").slice(1)),
      ),
    );
    expect([...paths].some((path) => path.endsWith(".py"))).toBe(true);
    expect([...paths].some((path) => path.endsWith(".ts"))).toBe(true);
  });
});
