import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Config, ScanResult, ScannedNode } from "@gitnebula/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RawChange, RawCommit } from "./git-log.js";
import { analysisWindow, analyze, computeGitResult } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const buildScript = join(repoRoot, "test-fixtures", "build-fixture-repo.sh");
const fixtureRepo = join(
  repoRoot,
  "test-fixtures",
  ".generated",
  "history-repo",
);

// AD-13: the window is pinned, never read from the clock. The fixture's
// crafted history puts the 2024 commits outside it and the 2025 commits in.
const PINNED_CONFIG: Config = {
  windowAnchor: "2026-01-01T00:00:00Z",
  windowDays: 365,
  excludes: [],
  layers: {},
  hotspotThreshold: 0.5,
};

// ---------------------------------------------------------------- helpers --

function node(
  id: string,
  kind: ScannedNode["kind"],
  parent: string | null,
): ScannedNode {
  return { id, kind, parent, path: id, layer: "other", loc: 10 };
}

function scanOf(...nodes: ScannedNode[]): ScanResult {
  return {
    nodes,
    stats: {
      files: nodes.filter((n) => n.kind === "file").length,
      loc: 0,
      languages: {},
    },
    warnings: [],
  };
}

function commit(
  hash: string,
  committedAt: number,
  authorEmail: string,
  ...changes: RawChange[]
): RawCommit {
  return { hash, committedAt, authorEmail, changes };
}

const touch = (path: string): RawChange => ({ status: "M", path });

/** The fixture repo's tree as the scanner would see it (AD-13 universe). */
function fixtureScan(): ScanResult {
  return scanOf(
    node("core/", "module", null),
    node("core/scoring.py", "file", "core/"),
    node("legacy/", "module", null),
    node("legacy/old.ts", "file", "legacy/"),
    node("web/", "module", null),
    node("web/api.ts", "file", "web/"),
  );
}

// ------------------------------------------------------------------ window --

describe("analysisWindow (AD-13)", () => {
  it("derives the window from the anchor, never from the clock", () => {
    expect(analysisWindow(PINNED_CONFIG)).toEqual({
      since: "2025-01-01T00:00:00.000Z",
      until: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rejects an anchor that is not an ISO instant", () => {
    expect(() =>
      analysisWindow({ ...PINNED_CONFIG, windowAnchor: "last tuesday" }),
    ).toThrow(/windowAnchor/);
  });
});

// -------------------------------------------------------------- pure rules --

describe("computeGitResult", () => {
  it("counts commits, authors and the newest instant per file (AC-1)", () => {
    const result = computeGitResult(
      [
        commit("c3", 300, "ada@x.invalid", touch("web/api.ts")),
        commit("c2", 200, "ben@x.invalid", touch("web/api.ts")),
        commit("c1", 100, "ada@x.invalid", touch("web/api.ts")),
      ],
      scanOf(node("web/", "module", null), node("web/api.ts", "file", "web/")),
    );

    expect(result.history["web/api.ts"]).toEqual({
      churn: 1,
      commits: 3,
      authors: 2,
      lastChangedAt: "1970-01-01T00:05:00.000Z",
    });
    expect(result.commits).toBe(3);
    expect(result.lastCommitAt).toBe("1970-01-01T00:05:00.000Z");
  });

  it("counts a module's commits directly, not summed from its files (ADR-0003)", () => {
    const result = computeGitResult(
      [
        commit(
          "c1",
          100,
          "ada@x.invalid",
          touch("core/a.py"),
          touch("core/b.py"),
          touch("core/c.py"),
        ),
      ],
      scanOf(
        node("core/", "module", null),
        node("core/a.py", "file", "core/"),
        node("core/b.py", "file", "core/"),
        node("core/c.py", "file", "core/"),
      ),
    );

    // Three files, one commit each; the module they share saw one commit too.
    expect(result.history["core/"]?.commits).toBe(1);
    expect(result.history["core/a.py"]?.commits).toBe(1);
  });

  it("carries a renamed file's pre-rename counts to its new name (AC-1)", () => {
    const result = computeGitResult(
      [
        commit("c3", 300, "ada@x.invalid", {
          status: "R",
          oldPath: "core/score.py",
          path: "core/scoring.py",
        }),
        commit("c2", 200, "ben@x.invalid", touch("core/score.py")),
        commit("c1", 100, "ada@x.invalid", touch("core/score.py")),
      ],
      scanOf(
        node("core/", "module", null),
        node("core/scoring.py", "file", "core/"),
      ),
    );

    expect(result.history["core/scoring.py"]?.commits).toBe(3);
    expect(result.warnings).toEqual([]);
  });

  it("normalizes churn per kind against that kind's P95 (AC-2)", () => {
    const result = computeGitResult(
      [
        commit("c4", 400, "a@x.invalid", touch("core/a.py")),
        commit("c3", 300, "a@x.invalid", touch("core/a.py")),
        commit("c2", 200, "a@x.invalid", touch("core/a.py"), touch("web/b.ts")),
        commit("c1", 100, "a@x.invalid", touch("core/a.py"), touch("web/b.ts")),
      ],
      scanOf(
        node("core/", "module", null),
        node("core/a.py", "file", "core/"),
        node("web/", "module", null),
        node("web/b.ts", "file", "web/"),
      ),
    );

    // Files: counts 4 and 2, P95 = 4. Modules: the same, independently.
    expect(result.history["core/a.py"]?.churn).toBe(1);
    expect(result.history["web/b.ts"]?.churn).toBe(0.5);
    expect(result.history["core/"]?.churn).toBe(1);
    expect(result.history["web/"]?.churn).toBe(0.5);
  });

  it("gives the only node of its kind churn 1.0 (AC-2)", () => {
    const result = computeGitResult(
      [commit("c1", 100, "a@x.invalid", touch("solo.ts"))],
      scanOf(node("solo.ts", "file", null)),
    );
    expect(result.history["solo.ts"]).toEqual({
      churn: 1,
      commits: 1,
      authors: 1,
      lastChangedAt: "1970-01-01T00:01:40.000Z",
    });
  });

  it("reports zeros and no NaN when the window holds no commits (AC-4)", () => {
    const result = computeGitResult([], fixtureScan());

    expect(result.commits).toBe(0);
    expect(result.lastCommitAt).toBeNull();
    expect(result.cochanges).toEqual([]);
    for (const history of Object.values(result.history)) {
      expect(history).toEqual({
        churn: 0,
        commits: 0,
        authors: 0,
        lastChangedAt: null,
      });
    }
    expect(JSON.stringify(result)).not.toMatch(/null,"churn":null|NaN/);
  });

  it("gives every universe node an entry, touched or not", () => {
    const result = computeGitResult(
      [commit("c1", 100, "a@x.invalid", touch("web/api.ts"))],
      fixtureScan(),
    );
    expect(Object.keys(result.history)).toEqual([
      "core/",
      "core/scoring.py",
      "legacy/",
      "legacy/old.ts",
      "web/",
      "web/api.ts",
    ]);
  });

  it("drops and counts paths outside the scan universe (AC-5, AD-13)", () => {
    const result = computeGitResult(
      [
        commit(
          "c1",
          100,
          "a@x.invalid",
          touch("web/api.ts"),
          touch("node_modules/dep/index.js"),
          touch("deleted.ts"),
        ),
      ],
      scanOf(node("web/", "module", null), node("web/api.ts", "file", "web/")),
    );

    expect(result.warnings).toContainEqual({
      code: "path-outside-universe",
      count: 2,
      detail: "node_modules/dep/index.js",
    });
    expect(result.history["web/api.ts"]?.commits).toBe(1);
    // The dropped paths must not have created co-change pairs either.
    expect(result.cochanges).toEqual([]);
  });

  it("counts a parent module the scan never declared", () => {
    const result = computeGitResult(
      [commit("c1", 100, "a@x.invalid", touch("web/api.ts"))],
      scanOf(node("web/api.ts", "file", "ghost/")),
    );
    expect(result.warnings).toContainEqual({
      code: "unknown-module-parent",
      count: 1,
      detail: "ghost/",
    });
  });

  it("extracts file and module co-change pairs above the threshold (AC-3)", () => {
    const commits = [1, 2, 3].map((i) =>
      commit(
        `c${i}`,
        i * 100,
        "a@x.invalid",
        touch("core/a.py"),
        touch("web/b.ts"),
      ),
    );
    const result = computeGitResult(
      commits,
      scanOf(
        node("core/", "module", null),
        node("core/a.py", "file", "core/"),
        node("web/", "module", null),
        node("web/b.ts", "file", "web/"),
      ),
    );

    expect(result.cochanges).toEqual([
      { a: "core/", b: "web/", count: 3 },
      { a: "core/a.py", b: "web/b.ts", count: 3 },
    ]);
  });

  it("skips commits touching more than 50 files for co-change (AC-3)", () => {
    const paths = Array.from(
      { length: 51 },
      (_, i) => `core/f${String(i).padStart(3, "0")}.ts`,
    );
    const nodes = paths.map((path) => node(path, "file", "core/"));
    const bulk = [1, 2, 3].map((i) =>
      commit(`bulk${i}`, i * 100, "a@x.invalid", ...paths.map(touch)),
    );

    const result = computeGitResult(
      bulk,
      scanOf(node("core/", "module", null), ...nodes),
    );

    expect(result.cochanges).toEqual([]);
    expect(result.warnings).toContainEqual({
      code: "bulk-commit-skipped",
      count: 3,
      detail: "bulk1",
    });
    // The skip is co-change only: the commits still count towards activity.
    expect(result.history["core/f000.ts"]?.commits).toBe(3);
    expect(result.history["core/"]?.commits).toBe(3);
  });

  it("keeps a commit touching exactly 50 files", () => {
    const paths = Array.from(
      { length: 50 },
      (_, i) => `core/f${String(i).padStart(3, "0")}.ts`,
    );
    const nodes = paths.map((path) => node(path, "file", "core/"));
    const commits = [1, 2, 3].map((i) =>
      commit(`c${i}`, i * 100, "a@x.invalid", ...paths.map(touch)),
    );

    const result = computeGitResult(
      commits,
      scanOf(node("core/", "module", null), ...nodes),
    );
    expect(result.cochanges.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it("counts a changeless commit repo-wide but attributes it to no node", () => {
    // A merge (git prints no file records for one) or `commit --allow-empty`.
    const result = computeGitResult(
      [
        commit("merge", 400, "ada@x.invalid"),
        commit("c1", 100, "ada@x.invalid", touch("web/api.ts")),
      ],
      scanOf(node("web/", "module", null), node("web/api.ts", "file", "web/")),
    );

    expect(result.commits).toBe(2);
    // The newest instant in the window is the merge's, even though it changed
    // no file — `lastCommitAt` is repo-wide, unlike a node's lastChangedAt.
    expect(result.lastCommitAt).toBe("1970-01-01T00:06:40.000Z");
    expect(result.history["web/api.ts"]).toEqual({
      churn: 1,
      commits: 1,
      authors: 1,
      lastChangedAt: "1970-01-01T00:01:40.000Z",
    });
    expect(result.warnings).toEqual([]);
  });

  it("reports progress once per commit", () => {
    const seen: Array<[number, number]> = [];
    computeGitResult(
      [
        commit("c2", 200, "a@x.invalid", touch("a.ts")),
        commit("c1", 100, "a@x.invalid", touch("a.ts")),
      ],
      scanOf(node("a.ts", "file", null)),
      (done, total) => seen.push([done, total]),
    );
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

// ------------------------------------------------------- against real git --

describe("analyze against the built fixture repo (AC-6, AD-14)", () => {
  beforeAll(() => {
    execFileSync("sh", [buildScript], { stdio: "ignore" });
  });

  it("matches the committed expected values exactly", async () => {
    const result = await analyze(
      { root: fixtureRepo, scan: fixtureScan() },
      PINNED_CONFIG,
    );

    expect(result).toEqual({
      history: {
        // Four in-window commits: two before the rename, the rename itself,
        // and one after — Ada and Ben. P95 over the two active files is 4.
        "core/": {
          churn: 1,
          commits: 4,
          authors: 2,
          lastChangedAt: "2025-06-30T08:00:00.000Z",
        },
        "core/scoring.py": {
          churn: 1,
          commits: 4,
          authors: 2,
          lastChangedAt: "2025-06-30T08:00:00.000Z",
        },
        // Its only commits are in 2024, outside the pinned window.
        "legacy/": { churn: 0, commits: 0, authors: 0, lastChangedAt: null },
        "legacy/old.ts": {
          churn: 0,
          commits: 0,
          authors: 0,
          lastChangedAt: null,
        },
        "web/": {
          churn: 0.75,
          commits: 3,
          authors: 3,
          lastChangedAt: "2025-05-20T16:45:00.000Z",
        },
        "web/api.ts": {
          churn: 0.75,
          commits: 3,
          authors: 3,
          lastChangedAt: "2025-05-20T16:45:00.000Z",
        },
      },
      // Empty by design: the fixture's only repeated pair
      // (core/scoring.py + web/api.ts) has count 2, under ADR-0005's
      // count >= 3 bound. Co-change is covered by the unit tests above.
      cochanges: [],
      commits: 5,
      lastCommitAt: "2025-06-30T08:00:00.000Z",
      warnings: [],
    });
  });

  it("is byte-identical across runs (AD-4)", async () => {
    const input = { root: fixtureRepo, scan: fixtureScan() };
    const first = await analyze(input, PINNED_CONFIG);
    const second = await analyze(input, PINNED_CONFIG);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("excludes out-of-window history from a shorter window", async () => {
    const result = await analyze(
      { root: fixtureRepo, scan: fixtureScan() },
      { ...PINNED_CONFIG, windowDays: 200 },
    );
    // 200 days before the anchor is 2025-06-15, leaving only the last commit.
    expect(result.commits).toBe(1);
    expect(result.history["web/api.ts"]?.commits).toBe(0);
    expect(result.history["core/scoring.py"]?.commits).toBe(1);
  });

  it("counts history for paths the scan universe excludes", async () => {
    const result = await analyze(
      {
        root: fixtureRepo,
        scan: scanOf(
          node("web/", "module", null),
          node("web/api.ts", "file", "web/"),
        ),
      },
      PINNED_CONFIG,
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "path-outside-universe", count: 4 }),
    );
    expect(result.history["web/api.ts"]?.commits).toBe(3);
  });
});

describe("analyze on repositories with no usable history", () => {
  const temps: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "gitnebula-githist-"));
    temps.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  });

  it("treats a repository with no commits as zero history, not a failure (D10)", async () => {
    const dir = tempDir();
    execFileSync("git", ["init", "--quiet", "--template=", "-b", "main", dir]);

    const result = await analyze(
      { root: dir, scan: fixtureScan() },
      PINNED_CONFIG,
    );
    expect(result.commits).toBe(0);
    expect(result.lastCommitAt).toBeNull();
    expect(result.history["core/scoring.py"]?.churn).toBe(0);
  });

  it("reads a real repository whose filename contains the record separator", async () => {
    // The end-to-end version of the parser's framing test: git will happily
    // track this name, and it must not fracture the commit stream.
    const dir = tempDir();
    const oddName = `od\x1ed.ts`;
    execFileSync("git", ["init", "--quiet", "--template=", "-b", "main", dir]);
    writeFileSync(join(dir, oddName), "export const odd = 1;\n");
    writeFileSync(join(dir, "plain.ts"), "export const plain = 1;\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "--quiet", "-m", "odd name"], {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-05-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2025-05-01T00:00:00Z",
        GIT_AUTHOR_NAME: "Odd",
        GIT_AUTHOR_EMAIL: "odd@fixture.invalid",
        GIT_COMMITTER_NAME: "Odd",
        GIT_COMMITTER_EMAIL: "odd@fixture.invalid",
      },
    });

    const result = await analyze(
      {
        root: dir,
        scan: scanOf(
          node(oddName, "file", null),
          node("plain.ts", "file", null),
        ),
      },
      PINNED_CONFIG,
    );

    expect(result.commits).toBe(1);
    expect(result.history[oddName]?.commits).toBe(1);
    expect(result.history["plain.ts"]?.commits).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("aborts when the path is not a repository (AD-7 stage failure)", async () => {
    await expect(
      analyze({ root: tempDir(), scan: fixtureScan() }, PINNED_CONFIG),
    ).rejects.toThrow(/git log exited/);
  });
});
