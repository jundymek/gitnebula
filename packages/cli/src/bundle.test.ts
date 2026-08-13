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
import { basename, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BUNDLE_CONTENTS,
  DEFAULT_BUNDLE_DIR,
  VIEWER_GZIP_BUDGET_BYTES,
  assembleBundle,
  assessReuse,
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

describe("gitnebula build — reusing an analysis.json (AC-1)", () => {
  /** A marker the pipeline would overwrite; surviving proves reuse happened. */
  const MARKER = "markedByTheTest";

  /**
   * Adds an extra field to a real emitted document. It has to stay valid JSON
   * that still names its repository and window — the reuse rule reads all
   * three, so a marker that broke any of them would make every case below look
   * like a re-analysis for the wrong reason.
   */
  function mark(path: string): void {
    const document = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    document[MARKER] = true;
    writeFileSync(path, JSON.stringify(document), "utf8");
  }

  it("skips the analysis for the same repository at the same HEAD", async () => {
    const dist = fakeVizDist();
    const first = await build([fixtureRepo], dist);
    const outDir = join(first.cwd, DEFAULT_BUNDLE_DIR);
    mark(join(outDir, "analysis.json"));

    const chunks: string[] = [];
    const code = await run(["build", fixtureRepo, "-o", outDir], {
      cwd: first.cwd,
      vizDist: dist,
      reporter: createSilentReporter(),
      write: (chunk) => chunks.push(chunk),
    });

    expect(code).toBe(0);
    expect(readFileSync(join(outDir, "analysis.json"), "utf8")).toContain(
      MARKER,
    );
  });

  it("re-analyzes under --force", async () => {
    const dist = fakeVizDist();
    const first = await build([fixtureRepo], dist);
    const outDir = join(first.cwd, DEFAULT_BUNDLE_DIR);
    mark(join(outDir, "analysis.json"));

    const code = await run(["build", fixtureRepo, "-o", outDir, "--force"], {
      cwd: first.cwd,
      vizDist: dist,
      reporter: createSilentReporter(),
      write: () => {},
    });

    expect(code).toBe(0);
    expect(readFileSync(join(outDir, "analysis.json"), "utf8")).not.toContain(
      MARKER,
    );
  });

  // The failure a review of this branch caught before it shipped: an output
  // directory is a destination, not a cache, and a newer-than-HEAD test alone
  // will happily publish one repository's map under another's name.
  it("re-analyzes when the output directory holds another repository's map", async () => {
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
});

describe("assessReuse — provenance, not age", () => {
  /** The question `build` asks about the fixture repository. */
  function question(analysisPath: string, overrides = {}) {
    return {
      analysisPath,
      repoRoot: fixtureRepo,
      repo: { name: "history-repo", remoteUrl: null },
      windowDays: FIXTURE_WINDOW_DAYS,
      unrecordedFlags: [],
      ...overrides,
    };
  }

  /** A document that would legitimately be reusable. */
  function reusableDocument(): string {
    const path = join(makeTempDir(temps, "gitnebula-out-"), "analysis.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: "1.0",
        repo: {
          name: "history-repo",
          remoteUrl: null,
          analysisWindowDays: FIXTURE_WINDOW_DAYS,
        },
      }),
      "utf8",
    );
    return path;
  }

  it("reuses a document that matches the repository, window and HEAD", () => {
    // The fixture repository's commits are pinned in the past (AD-14), so a
    // file written now is newer than its HEAD.
    const verdict = assessReuse(question(reusableDocument()));
    expect(verdict.reuse).toBe(true);
    expect(verdict.because).toContain("this repository");
  });

  it("refuses when there is no file", () => {
    const dir = makeTempDir(temps, "gitnebula-out-");
    const verdict = assessReuse(question(join(dir, "analysis.json")));
    expect(verdict).toEqual({
      reuse: false,
      because: "no analysis.json is there yet",
    });
  });

  it("refuses a document describing a different repository", () => {
    const verdict = assessReuse(
      question(reusableDocument(), {
        repo: { name: "something-else", remoteUrl: null },
      }),
    );
    expect(verdict.reuse).toBe(false);
    expect(verdict.because).toContain("history-repo");
  });

  it("refuses a document made from a different remote", () => {
    const verdict = assessReuse(
      question(reusableDocument(), {
        repo: { name: "history-repo", remoteUrl: "git@example.com:a/b.git" },
      }),
    );
    expect(verdict.reuse).toBe(false);
    expect(verdict.because).toContain("different remote");
  });

  it("refuses a document analyzed over a different window", () => {
    const verdict = assessReuse(
      question(reusableDocument(), { windowDays: 30 }),
    );
    expect(verdict.reuse).toBe(false);
    expect(verdict.because).toContain("not 30");
  });

  // The document records neither exclusions nor the threshold, so a run that
  // passes them cannot be compared against it — and what cannot be compared is
  // not evidence.
  it("refuses when a flag the document does not record was passed", () => {
    const verdict = assessReuse(
      question(reusableDocument(), {
        unrecordedFlags: ["--exclude", "--hotspot-threshold"],
      }),
    );
    expect(verdict.reuse).toBe(false);
    expect(verdict.because).toContain("--exclude, --hotspot-threshold");
  });

  it("refuses an unreadable document", () => {
    const path = join(makeTempDir(temps, "gitnebula-out-"), "analysis.json");
    writeFileSync(path, "{ not json", "utf8");
    expect(assessReuse(question(path)).because).toContain("unreadable");
  });

  it("refuses a document older than HEAD", () => {
    const repo = makeTempDir(temps, "gitnebula-repo-");
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "T");
    writeFileSync(join(repo, "a.txt"), "a", "utf8");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "first");

    const path = reusableDocument();
    const longAgo = new Date("2000-01-01T00:00:00Z");
    utimesSync(path, longAgo, longAgo);

    expect(assessReuse(question(path, { repoRoot: repo })).because).toBe(
      "it predates HEAD",
    );
  });

  it("refuses a document older than .gitnebula.yml", () => {
    // A config change alters the analysis without touching a commit, so HEAD
    // alone cannot see it.
    const repo = makeTempDir(temps, "gitnebula-repo-");
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "T");
    writeFileSync(join(repo, "a.txt"), "a", "utf8");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "first");

    const path = reusableDocument();
    const config = join(repo, ".gitnebula.yml");
    writeFileSync(config, "exclude:\n  - vendor/**\n", "utf8");
    const later = new Date(Date.now() + 60_000);
    utimesSync(config, later, later);

    expect(assessReuse(question(path, { repoRoot: repo })).because).toContain(
      ".gitnebula.yml",
    );
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
