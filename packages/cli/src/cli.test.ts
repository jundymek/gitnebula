import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AnalysisDocument } from "@gitnebula/contract";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { run, type RunOptions } from "./cli.js";
import { createSilentReporter } from "./progress.js";
import {
  FIXTURE_ANCHOR,
  ensureFixtureRepo,
  fixtureRepo,
  makeTempDir,
  removeAll,
} from "./test-support.js";

// The fixture repository (AD-14) is built here rather than by a `pretest`:
// the builder is concurrency-safe and no-ops on a valid repository (story 3.6),
// so this keeps `pnpm --filter @gitnebula/cli test` self-sufficient without
// adding a fifth shell caller racing the other packages.
beforeAll(() => ensureFixtureRepo());

const temps: string[] = [];
afterEach(() => removeAll(temps));

/**
 * Runs the CLI without its serving tail. Serving blocks until a signal, so
 * every test that is about analysis says `--no-serve`; the ones about the
 * server say so explicitly and drive the signal themselves.
 */
function invoke(argv: readonly string[], options: RunOptions = {}) {
  const cwd = makeTempDir(temps, "gitnebula-cli-");
  const chunks: string[] = [];
  return {
    cwd,
    output: () => chunks.join(""),
    code: run(["--no-serve", ...argv], {
      cwd,
      reporter: createSilentReporter(),
      write: (chunk) => chunks.push(chunk),
      ...options,
    }),
  };
}

describe("gitnebula argument handling", () => {
  it("analyzes a path and exits 0", async () => {
    const attempt = invoke([
      fixtureRepo,
      "--window-anchor",
      FIXTURE_ANCHOR,
      "--window-days",
      "365",
    ]);

    await expect(attempt.code).resolves.toBe(0);
    expect(existsSync(join(attempt.cwd, "analysis.json"))).toBe(true);
  });

  it("accepts a repeated --exclude and an --out path", async () => {
    const attempt = invoke([
      fixtureRepo,
      "--exclude",
      "legacy/**",
      "--exclude",
      "docs/**",
      "--out",
      "reports/analysis.json",
    ]);

    await expect(attempt.code).resolves.toBe(0);
    expect(existsSync(join(attempt.cwd, "reports", "analysis.json"))).toBe(
      true,
    );
  });

  it("prints --help and exits 0 without analyzing anything", async () => {
    const attempt = invoke(["--help"]);

    await expect(attempt.code).resolves.toBe(0);
    expect(attempt.output()).toContain("--window-anchor");
    expect(attempt.output()).toContain("TEST ONLY");
    expect(existsSync(join(attempt.cwd, "analysis.json"))).toBe(false);
  });

  it("exits 2 on an unknown option", async () => {
    await expect(invoke(["--nope"]).code).resolves.toBe(2);
  });
});

describe("failures reach the terminal in the AD-7 shape (AC-2)", () => {
  it("treats a host-like path that exists on disk as a local repository", async () => {
    // `example.com/checkout` is a perfectly good directory name. Existence
    // wins over the host-shaped regex, or a real repo becomes unanalyzable.
    const cwd = makeTempDir(temps, "gitnebula-hostlike-");
    mkdirSync(join(cwd, "example.com", "checkout"), { recursive: true });
    const chunks: string[] = [];

    const code = await run(["--no-serve", "example.com/checkout"], {
      cwd,
      reporter: createSilentReporter(),
      write: (chunk) => chunks.push(chunk),
    });

    // It is not a git repository, so it still fails — but as `repo:`, having
    // been recognised as a path, not refused as a URL.
    expect(code).toBe(1);
    expect(chunks.join("")).toMatch(/^repo: .+ is not a git repository/);
    expect(chunks.join("")).not.toContain("remote repository");
  });

  it("takes a host-like target that does not exist locally to the clone stage", async () => {
    // No such directory, so it is a URL — and `example.com/checkout` is not a
    // repository git can reach, which is the abort AC-5 specifies. git treats
    // the bare host-like form as a local path, so nothing leaves the machine.
    const attempt = invoke(["example.com/checkout"]);

    await expect(attempt.code).resolves.toBe(1);
    expect(attempt.output()).toContain(
      "clone: cannot clone example.com/checkout — check the URL or your network",
    );
  });

  it("exits non-zero on a directory that is not a git repository", async () => {
    const plain = makeTempDir(temps, "gitnebula-plain-");
    const attempt = invoke([plain]);

    await expect(attempt.code).resolves.toBe(1);
    expect(attempt.output()).toMatch(
      /^repo: .+ is not a git repository — run gitnebula inside a git repository/m,
    );
  });

  it("rejects a non-numeric --window-days before touching the repository", async () => {
    const attempt = invoke([fixtureRepo, "--window-days", "soon"]);

    await expect(attempt.code).resolves.toBe(1);
    expect(attempt.output()).toMatch(
      /^input: --window-days expects a whole number of days of at least 1, got "soon" — /,
    );
    expect(existsSync(join(attempt.cwd, "analysis.json"))).toBe(false);
  });

  it("rejects a --hotspot-threshold outside 0..1", async () => {
    const attempt = invoke([fixtureRepo, "--hotspot-threshold", "5"]);

    await expect(attempt.code).resolves.toBe(1);
    expect(attempt.output()).toMatch(
      /^input: --hotspot-threshold expects a number between 0 and 1, got "5" — /,
    );
  });
});

/** A stand-in viz dist, so these tests do not depend on a viz build. */
function makeDist(): string {
  const dist = makeTempDir(temps, "gitnebula-clidist-");
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>map</title>");
  return dist;
}

/**
 * Runs the CLI with its serving tail, waits until the URL is printed, hands it
 * to `visit`, then delivers SIGINT and returns the exit code (AC-1, AC-3).
 */
async function serveThenInterrupt(
  argv: readonly string[],
  visit: (url: string, output: () => string) => Promise<void>,
  options: RunOptions = {},
): Promise<{ code: number; output: string; opened: string[] }> {
  const cwd = makeTempDir(temps, "gitnebula-serve-");
  const chunks: string[] = [];
  const opened: string[] = [];
  const signals = new EventEmitter();

  const code = run(argv, {
    cwd,
    reporter: createSilentReporter(),
    write: (chunk) => chunks.push(chunk),
    signals,
    vizDist: makeDist(),
    port: nextPort(),
    openBrowser: async (url) => void opened.push(url),
    ...options,
  });

  const url = await waitForUrl(() => chunks.join(""));
  await visit(url, () => chunks.join(""));
  signals.emit("SIGINT");

  return { code: await code, output: chunks.join(""), opened };
}

/**
 * A distinct starting port per test. The scan makes a collision harmless, but
 * a fixed start would have every test in the file queue behind the first one.
 */
let portCursor = 45300;
function nextPort(): number {
  portCursor += 5;
  return portCursor;
}

/** Polls the CLI's own output for the line it prints once the socket is up. */
async function waitForUrl(output: () => string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const match = /serving (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output());
    if (match?.[1] !== undefined) return match[1];
    await new Promise((settle) => setTimeout(settle, 25));
  }
  throw new Error(`the server never announced a URL. Output:\n${output()}`);
}

describe("the run ends in a served map (AC-1, AC-2, AC-3)", () => {
  it("serves the analysis it just wrote and opens a browser at it", async () => {
    const result = await serveThenInterrupt(
      [fixtureRepo, "--window-anchor", FIXTURE_ANCHOR, "--window-days", "365"],
      async (url) => {
        const page = await fetch(url);
        expect(page.status).toBe(200);

        const analysis = await fetch(`${url}analysis.json`);
        expect(analysis.status).toBe(200);
        // The sibling URL serves *this run's* document (AD-12), not a copy.
        const document = (await analysis.json()) as AnalysisDocument;
        expect(document.repo.name).toBe("history-repo");
      },
    );

    expect(result.code).toBe(0);
    expect(result.opened).toEqual([
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/),
    ]);
    expect(result.output).toContain("press Ctrl+C to stop");
    expect(result.output).toContain("stopped");
  });

  it("does not open a browser under --no-open", async () => {
    const result = await serveThenInterrupt(
      [fixtureRepo, "--no-open", "--window-days", "365"],
      async (url) => {
        expect((await fetch(url)).status).toBe(200);
      },
    );

    expect(result.code).toBe(0);
    expect(result.opened).toEqual([]);
  });

  it("still serves when the browser cannot be launched", async () => {
    const result = await serveThenInterrupt(
      [fixtureRepo, "--window-days", "365"],
      async (url) => {
        expect((await fetch(url)).status).toBe(200);
      },
      { openBrowser: async () => Promise.reject(new Error("no browser here")) },
    );

    expect(result.code).toBe(0);
    expect(result.output).toContain(
      "! could not open a browser (no browser here)",
    );
  });

  it("aborts with the viz build hint when the viewer is not built", async () => {
    const cwd = makeTempDir(temps, "gitnebula-nodist-run-");
    const chunks: string[] = [];

    const code = await run([fixtureRepo, "--window-days", "365"], {
      cwd,
      reporter: createSilentReporter(),
      write: (chunk) => chunks.push(chunk),
      // An empty directory: exactly what a fresh clone with no viz build has.
      vizDist: makeTempDir(temps, "gitnebula-nodist-"),
      openBrowser: async () => {},
      signals: new EventEmitter(),
    });

    expect(code).toBe(1);
    expect(chunks.join("")).toMatch(
      /^serve: the viewer has not been built — run `pnpm --filter @gitnebula\/viz build`/m,
    );
    // The analysis is still on disk: only the serving tail failed.
    expect(existsSync(join(cwd, "analysis.json"))).toBe(true);
  });
});

describe("URL mode (AC-4, AC-5)", () => {
  it("clones a URL, analyzes the clone, and removes the temp checkout", async () => {
    const origin = join(makeTempDir(temps, "gitnebula-origin-"), "origin");
    mkdirSync(origin);
    for (const args of [
      ["init", "-q", "-b", "main"],
      ["config", "user.email", "fixture@example.invalid"],
      ["config", "user.name", "Fixture"],
    ]) {
      execFileSync("git", args, { cwd: origin, stdio: "ignore" });
    }
    writeFileSync(join(origin, "app.ts"), "export const answer = 42;\n");
    execFileSync("git", ["add", "."], { cwd: origin, stdio: "ignore" });
    execFileSync("git", ["commit", "-q", "-m", "feat: seed"], {
      cwd: origin,
      stdio: "ignore",
    });

    const attempt = invoke([`file://${origin}`]);

    await expect(attempt.code).resolves.toBe(0);
    const written = JSON.parse(
      readFileSync(join(attempt.cwd, "analysis.json"), "utf8"),
    ) as AnalysisDocument;
    expect(written.repo.name).toBe("origin");
    // AC-4: nothing is left behind in the system temp directory.
    expect(
      readdirSync(tmpdir()).filter((name) =>
        name.startsWith("gitnebula-clone-"),
      ),
    ).toEqual([]);
  });

  it("exits non-zero and cleans up when the URL cannot be cloned", async () => {
    const attempt = invoke(["http://127.0.0.1:1/nothing.git"]);

    await expect(attempt.code).resolves.toBe(1);
    expect(attempt.output()).toContain(
      "clone: cannot clone http://127.0.0.1:1/nothing.git — check the URL or your network",
    );
    expect(existsSync(join(attempt.cwd, "analysis.json"))).toBe(false);
    expect(
      readdirSync(tmpdir()).filter((name) =>
        name.startsWith("gitnebula-clone-"),
      ),
    ).toEqual([]);
  });
});
