// Story 4.1, AC-1 and AC-2: the bundle is exactly two files, and the viewer
// half of it is measured against ADR-0004's gzipped budget.
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BUNDLE_CONTENTS,
  DEFAULT_BUNDLE_DIR,
  VIEWER_GZIP_BUDGET_BYTES,
  assembleBundle,
  describeViewerSize,
  formatBytes,
  measureViewer,
} from "./bundle.js";
import { run } from "./cli.js";
import { StageError } from "./errors.js";
import { createSilentReporter } from "./progress.js";
import {
  FIXTURE_ANCHOR,
  FIXTURE_WINDOW_DAYS,
  ensureFixtureRepo,
  fixtureRepo,
  git,
  makeTempDir,
  removeAll,
} from "./test-support.js";

const temps: string[] = [];
afterEach(() => removeAll(temps));

beforeAll(() => ensureFixtureRepo());

/** A stand-in for the built viewer: one self-contained file, as ADR-0004 has it. */
function fakeVizDist(bytes = "<!doctype html><p>viewer</p>"): string {
  const dist = makeTempDir(temps, "gitnebula-vizdist-");
  writeFileSync(join(dist, "index.html"), bytes, "utf8");
  return dist;
}

async function build(argv: readonly string[], vizDist: string) {
  const cwd = makeTempDir(temps, "gitnebula-build-");
  const chunks: string[] = [];
  const code = await run(["build", ...argv], {
    cwd,
    vizDist,
    reporter: createSilentReporter(),
    write: (chunk) => chunks.push(chunk),
  });
  return { code, cwd, output: chunks.join("") };
}

describe("gitnebula build — the bundle is exactly two files (AC-1)", () => {
  it("writes index.html and analysis.json, and nothing else", async () => {
    const result = await build(
      [
        fixtureRepo,
        "--window-anchor",
        FIXTURE_ANCHOR,
        "--window-days",
        String(FIXTURE_WINDOW_DAYS),
      ],
      fakeVizDist(),
    );

    expect(result.code).toBe(0);
    const outDir = join(result.cwd, DEFAULT_BUNDLE_DIR);
    expect(readdirSync(outDir).sort()).toEqual([...BUNDLE_CONTENTS].sort());
  });

  it("puts the bundle where -o says", async () => {
    const result = await build(
      [fixtureRepo, "-o", "site", "--window-anchor", FIXTURE_ANCHOR],
      fakeVizDist(),
    );

    expect(result.code).toBe(0);
    expect(existsSync(join(result.cwd, "site", "index.html"))).toBe(true);
    expect(existsSync(join(result.cwd, "site", "analysis.json"))).toBe(true);
  });

  it("writes the sibling analysis.json the viewer fetches (AD-12)", async () => {
    const result = await build([fixtureRepo], fakeVizDist());
    const document = JSON.parse(
      readFileSync(
        join(result.cwd, DEFAULT_BUNDLE_DIR, "analysis.json"),
        "utf8",
      ),
    ) as { schemaVersion: string };

    expect(document.schemaVersion).toMatch(/^\d+\.\d+$/);
  });

  it("prints the gzipped viewer size against the budget (AC-2)", async () => {
    const result = await build([fixtureRepo], fakeVizDist());
    expect(result.output).toContain("viewer assets:");
    expect(result.output).toContain("gzipped of 2.00 MB budget");
  });

  it("names the fix when the viewer has not been built", async () => {
    const cwd = makeTempDir(temps, "gitnebula-build-");
    const chunks: string[] = [];
    const code = await run(["build", fixtureRepo], {
      cwd,
      // No dist anywhere: an empty directory is not a built viewer.
      vizDist: makeTempDir(temps, "gitnebula-empty-"),
      reporter: createSilentReporter(),
      write: (chunk) => chunks.push(chunk),
    });

    expect(code).toBe(1);
    expect(chunks.join("")).toContain("the viewer has not been built");
    expect(chunks.join("")).toContain("pnpm build");
  });

  it("refuses a viewer dist that is not one self-contained file", () => {
    const dist = fakeVizDist();
    // What a regression in the single-file Vite plugin looks like on disk.
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "assets", "index.js"), "boom", "utf8");
    const outDir = makeTempDir(temps, "gitnebula-out-");
    writeFileSync(join(outDir, "analysis.json"), "{}", "utf8");

    expect(() => assembleBundle(dist, outDir)).toThrow(StageError);
    expect(() => assembleBundle(dist, outDir)).toThrow(
      /a bundle is exactly analysis\.json \+ index\.html/,
    );
  });
});

describe("gitnebula build — the bundle stays out of its own map (AC-1)", () => {
  /** A small repository the bundle can be written *into*. */
  function makeRepo(): string {
    const repo = makeTempDir(temps, "gitnebula-repo-");
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "T");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n", "utf8");
    writeFileSync(join(repo, "b.ts"), "export const b = 2;\n", "utf8");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "first");
    return repo;
  }

  function nodeCount(outDir: string): number {
    const document = JSON.parse(
      readFileSync(join(outDir, "analysis.json"), "utf8"),
    ) as { nodes: { path: string }[] };
    return document.nodes.length;
  }

  // Without the self-exclusion, the second run maps the first run's output:
  // the count grows by the bundle's two files every time, and the map acquires
  // an index.html that is the viewer drawing it.
  it("does not grow by its own output on a second run", async () => {
    const repo = makeRepo();
    const dist = fakeVizDist();
    const outDir = join(repo, DEFAULT_BUNDLE_DIR);

    const invoke = (): Promise<number> =>
      run(["build", repo, "-o", outDir], {
        cwd: repo,
        vizDist: dist,
        reporter: createSilentReporter(),
        write: () => {},
      });

    expect(await invoke()).toBe(0);
    const first = nodeCount(outDir);
    expect(await invoke()).toBe(0);

    expect(nodeCount(outDir)).toBe(first);

    const document = JSON.parse(
      readFileSync(join(outDir, "analysis.json"), "utf8"),
    ) as { nodes: { path: string }[] };
    expect(
      document.nodes.filter((node) => node.path.includes(DEFAULT_BUNDLE_DIR)),
    ).toEqual([]);
  });

  it("keeps a nested output directory out too", async () => {
    const repo = makeRepo();
    const dist = fakeVizDist();
    const outDir = join(repo, "docs", "site");

    for (let run_ = 0; run_ < 2; run_ += 1) {
      expect(
        await run(["build", repo, "-o", outDir], {
          cwd: repo,
          vizDist: dist,
          reporter: createSilentReporter(),
          write: () => {},
        }),
      ).toBe(0);
    }

    const document = JSON.parse(
      readFileSync(join(outDir, "analysis.json"), "utf8"),
    ) as { nodes: { path: string }[] };
    expect(
      document.nodes.filter((node) => node.path.startsWith("docs/site")),
    ).toEqual([]);
  });

  // `path.relative` returns `..site` for a directory of that name, and a
  // check for a two-dot *prefix* reads it as an escape. The directory is
  // inside, so dropping its exclusion puts the bundle back in its own map.
  it("excludes an in-repository directory whose name starts with two dots", async () => {
    const repo = makeRepo();
    const dist = fakeVizDist();
    const outDir = join(repo, "..site");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        await run(["build", repo, "-o", outDir], {
          cwd: repo,
          vizDist: dist,
          reporter: createSilentReporter(),
          write: () => {},
        }),
      ).toBe(0);
    }

    const document = JSON.parse(
      readFileSync(join(outDir, "analysis.json"), "utf8"),
    ) as { nodes: { path: string }[] };
    expect(
      document.nodes.filter((node) => node.path.startsWith("..site")),
    ).toEqual([]);
  });

  it("refuses to write the bundle to the repository root", async () => {
    const repo = makeRepo();
    const chunks: string[] = [];
    const code = await run(["build", repo, "-o", repo], {
      cwd: repo,
      vizDist: fakeVizDist(),
      reporter: createSilentReporter(),
      write: (chunk) => chunks.push(chunk),
    });

    expect(code).toBe(1);
    expect(chunks.join("")).toContain(
      "cannot be written to the repository root",
    );
  });

  // An output directory outside the repository has nothing to exclude, and
  // asking for one anyway would silently drop a real directory from the map.
  it("adds no exclusion when the output is outside the repository", async () => {
    const repo = makeRepo();
    const outDir = join(makeTempDir(temps, "gitnebula-out-"), "site");

    expect(
      await run(["build", repo, "-o", outDir], {
        cwd: repo,
        vizDist: fakeVizDist(),
        reporter: createSilentReporter(),
        write: () => {},
      }),
    ).toBe(0);

    const document = JSON.parse(
      readFileSync(join(outDir, "analysis.json"), "utf8"),
    ) as { nodes: { path: string }[] };
    expect(document.nodes.some((node) => node.path === "a.ts")).toBe(true);
  });
});

describe("gitnebula build — the analysis is never reused (AC-1)", () => {
  // AC-1 permits reusing "a fresh analysis.json". Two rounds of review showed
  // freshness cannot be established from what the emitted document records —
  // no commit hash, no exclusions, no threshold, no configuration
  // fingerprint — and that writing provenance anywhere is barred here: inside
  // the document is a contract change, beside it breaks the two-file rule. So
  // the command analyzes every time, and this is the test that says so.
  it("overwrites an analysis.json that is already sitting in the output", async () => {
    const dist = fakeVizDist();
    const first = await build([fixtureRepo], dist);
    const outDir = join(first.cwd, DEFAULT_BUNDLE_DIR);
    const analysisPath = join(outDir, "analysis.json");

    const marked = JSON.parse(readFileSync(analysisPath, "utf8")) as Record<
      string,
      unknown
    >;
    marked["markedByTheTest"] = true;
    writeFileSync(analysisPath, JSON.stringify(marked), "utf8");

    const code = await run(["build", fixtureRepo, "-o", outDir], {
      cwd: first.cwd,
      vizDist: dist,
      reporter: createSilentReporter(),
      write: () => {},
    });

    expect(code).toBe(0);
    expect(readFileSync(analysisPath, "utf8")).not.toContain("markedByTheTest");
  });

  // The failure this replaced: an output directory is a destination, not a
  // cache keyed on anything, so a reuse rule keyed on age published one
  // repository's map under another's name.
  it("describes the repository it was pointed at, whatever was there before", async () => {
    const dist = fakeVizDist();
    const first = await build([fixtureRepo], dist);
    const outDir = join(first.cwd, DEFAULT_BUNDLE_DIR);

    const other = makeTempDir(temps, "gitnebula-other-");
    git(other, "init", "-q");
    git(other, "config", "user.email", "t@example.com");
    git(other, "config", "user.name", "T");
    writeFileSync(join(other, "a.ts"), "export const a = 1;\n", "utf8");
    git(other, "add", "-A");
    git(other, "commit", "-qm", "first");

    const code = await run(["build", other, "-o", outDir], {
      cwd: first.cwd,
      vizDist: dist,
      reporter: createSilentReporter(),
      write: () => {},
    });

    expect(code).toBe(0);
    const document = JSON.parse(
      readFileSync(join(outDir, "analysis.json"), "utf8"),
    ) as { repo: { name: string } };
    expect(document.repo.name).toBe(basename(other));
  });

  it("honours a --window-days that differs from the previous run", async () => {
    const dist = fakeVizDist();
    const first = await build([fixtureRepo], dist);
    const outDir = join(first.cwd, DEFAULT_BUNDLE_DIR);

    const code = await run(
      ["build", fixtureRepo, "-o", outDir, "--window-days", "30"],
      {
        cwd: first.cwd,
        vizDist: dist,
        reporter: createSilentReporter(),
        write: () => {},
      },
    );

    expect(code).toBe(0);
    const document = JSON.parse(
      readFileSync(join(outDir, "analysis.json"), "utf8"),
    ) as { repo: { analysisWindowDays: number } };
    expect(document.repo.analysisWindowDays).toBe(30);
  });
});

describe("measureViewer — ADR-0004's gzipped budget (AC-2)", () => {
  it("sums the gzipped assets and excludes the data", () => {
    const dir = makeTempDir(temps, "gitnebula-size-");
    writeFileSync(join(dir, "index.html"), "x".repeat(10_000), "utf8");
    // 5 MB of data next door must not count against a 2 MB viewer budget.
    writeFileSync(join(dir, "analysis.json"), "y".repeat(5_000_000), "utf8");

    const size = measureViewer(dir);
    expect(size.files.map((file) => file.name)).toEqual(["index.html"]);
    expect(size.gzipped).toBeLessThan(1000);
    expect(size.withinBudget).toBe(true);
    expect(size.budget).toBe(2 * 1024 * 1024);
  });

  it("reports over budget when the assets exceed it", () => {
    const dir = makeTempDir(temps, "gitnebula-size-");
    // Incompressible bytes: gzip squashes anything patterned down to nothing,
    // and the point is to exceed the budget *after* compression.
    writeFileSync(join(dir, "index.html"), randomBytes(3 * 1024 * 1024));

    const size = measureViewer(dir);
    expect(size.gzipped).toBeGreaterThan(VIEWER_GZIP_BUDGET_BYTES);
    expect(size.withinBudget).toBe(false);
    expect(describeViewerSize(size)).toContain("budget");
  });

  it("formats the number the way the printed line reports it", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(59_174)).toBe("57.8 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.00 MB");
  });
});
