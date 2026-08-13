import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { run } from "./cli.js";
import { createSilentReporter } from "./progress.js";
import {
  FIXTURE_ANCHOR,
  fixtureRepo,
  makeTempDir,
  removeAll,
} from "./test-support.js";

const temps: string[] = [];
afterEach(() => removeAll(temps));

function invoke(argv: readonly string[]) {
  const cwd = makeTempDir(temps, "gitnebula-cli-");
  const chunks: string[] = [];
  return {
    cwd,
    output: () => chunks.join(""),
    code: run(argv, {
      cwd,
      reporter: createSilentReporter(),
      write: (chunk) => chunks.push(chunk),
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
  it("refuses a URL target, naming the story that will support it", async () => {
    const attempt = invoke(["https://github.com/owner/thing"]);

    await expect(attempt.code).resolves.toBe(1);
    expect(attempt.output()).toMatch(
      /^input: analyzing a remote repository \(https:\/\/github\.com\/owner\/thing\) is not supported in this release — .*3\.2/,
    );
  });

  it("treats a host-like path that exists on disk as a local repository", async () => {
    // `example.com/checkout` is a perfectly good directory name. Existence
    // wins over the host-shaped regex, or a real repo becomes unanalyzable.
    const cwd = makeTempDir(temps, "gitnebula-hostlike-");
    mkdirSync(join(cwd, "example.com", "checkout"), { recursive: true });
    const chunks: string[] = [];

    const code = await run(["example.com/checkout"], {
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

  it("still refuses a host-like target that does not exist locally", async () => {
    const attempt = invoke(["example.com/checkout"]);

    await expect(attempt.code).resolves.toBe(1);
    expect(attempt.output()).toContain("input: analyzing a remote repository");
  });

  it("refuses an scp-style remote target too", async () => {
    const attempt = invoke(["git@github.com:owner/thing.git"]);

    await expect(attempt.code).resolves.toBe(1);
    expect(attempt.output()).toContain("input: analyzing a remote repository");
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
