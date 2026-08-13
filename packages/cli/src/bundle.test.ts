// Story 4.1, AC-1 and AC-2: the bundle is exactly two files, and the viewer
// half of it is measured against ADR-0004's gzipped budget.
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BUNDLE_CONTENTS,
  DEFAULT_BUNDLE_DIR,
  VIEWER_GZIP_BUDGET_BYTES,
  assembleBundle,
  describeViewerSize,
  formatBytes,
  isAnalysisFresh,
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

describe("gitnebula build — reusing a fresh analysis.json (AC-1)", () => {
  it("skips the analysis when the file is newer than HEAD, and says so", async () => {
    const dist = fakeVizDist();
    const first = await build([fixtureRepo], dist);
    const outDir = join(first.cwd, DEFAULT_BUNDLE_DIR);
    // A marker the pipeline would overwrite. Surviving the second run is the
    // proof that the analysis really was skipped, rather than re-run to an
    // identical result.
    writeFileSync(join(outDir, "analysis.json"), '{"schemaVersion":"1.0"}\n');

    const chunks: string[] = [];
    const code = await run(["build", fixtureRepo, "-o", outDir], {
      cwd: first.cwd,
      vizDist: dist,
      reporter: createSilentReporter(),
      write: (chunk) => chunks.push(chunk),
    });

    expect(code).toBe(0);
    expect(readFileSync(join(outDir, "analysis.json"), "utf8")).toBe(
      '{"schemaVersion":"1.0"}\n',
    );
  });

  it("re-analyzes under --force", async () => {
    const dist = fakeVizDist();
    const first = await build([fixtureRepo], dist);
    const outDir = join(first.cwd, DEFAULT_BUNDLE_DIR);
    writeFileSync(join(outDir, "analysis.json"), '{"schemaVersion":"1.0"}\n');

    const code = await run(["build", fixtureRepo, "-o", outDir, "--force"], {
      cwd: first.cwd,
      vizDist: dist,
      reporter: createSilentReporter(),
      write: () => {},
    });

    expect(code).toBe(0);
    expect(readFileSync(join(outDir, "analysis.json"), "utf8")).not.toBe(
      '{"schemaVersion":"1.0"}\n',
    );
  });
});

describe("isAnalysisFresh — measured against HEAD, not the clock", () => {
  it("is false when the file does not exist", () => {
    const dir = makeTempDir(temps, "gitnebula-fresh-");
    expect(isAnalysisFresh(join(dir, "analysis.json"), fixtureRepo)).toBe(
      false,
    );
  });

  it("is false for a file written before HEAD was committed", () => {
    // A repository committed *now*, and a file stamped well before it: the
    // ordering is what the check reads, so it is set explicitly rather than
    // left to how fast the test machine is.
    const repo = makeTempDir(temps, "gitnebula-repo-");
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "T");
    writeFileSync(join(repo, "a.txt"), "a", "utf8");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "first");

    const stale = join(makeTempDir(temps, "gitnebula-out-"), "analysis.json");
    writeFileSync(stale, "{}", "utf8");
    const longAgo = new Date("2000-01-01T00:00:00Z");
    utimesSync(stale, longAgo, longAgo);

    expect(isAnalysisFresh(stale, repo)).toBe(false);
  });

  it("is true for a file written after HEAD was committed", () => {
    const dir = makeTempDir(temps, "gitnebula-out-");
    const path = join(dir, "analysis.json");
    writeFileSync(path, "{}", "utf8");
    // The fixture repository's commits are pinned in the past (AD-14), so
    // anything written now is newer than its HEAD.
    expect(isAnalysisFresh(path, fixtureRepo)).toBe(true);
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
