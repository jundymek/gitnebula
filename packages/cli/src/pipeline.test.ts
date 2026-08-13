import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AnalysisDocument } from "@gitnebula/contract";
import { validateAnalysis } from "@gitnebula/contract";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CONFIG_FILENAME, LLM_IGNORED_NOTICE } from "./config.js";
import { DEFAULT_OUTPUT_FILENAME, serialize } from "./emit.js";
import { StageError } from "./errors.js";
import { runPipeline, type RunPipelineOptions } from "./pipeline.js";
import { createReporter } from "./progress.js";
import {
  FIXTURE_ANCHOR,
  FIXTURE_WINDOW_DAYS,
  ensureFixtureRepo,
  fixtureRepo,
  git,
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

/** A clock pinned per run, so `analyzedAt` is a value the test chose. */
function fixedClock(iso: string): () => number {
  const value = Date.parse(iso);
  return () => value;
}

function runOnFixture(overrides: Partial<RunPipelineOptions> = {}) {
  const cwd = makeTempDir(temps, "gitnebula-run-");
  const lines: string[] = [];
  const reporter = createReporter({
    write: (chunk) => lines.push(chunk),
    isTty: false,
    now: overrides.now ?? fixedClock("2026-02-03T10:00:00.000Z"),
  });

  const options: RunPipelineOptions = {
    target: fixtureRepo,
    cwd,
    windowAnchor: FIXTURE_ANCHOR,
    flags: { windowDays: FIXTURE_WINDOW_DAYS },
    reporter,
    now: fixedClock("2026-02-03T10:00:00.000Z"),
    ...overrides,
  };

  return {
    cwd,
    lines,
    output: () => lines.join(""),
    run: runPipeline(options),
  };
}

/** The stages, in the order their end lines appear. */
function completedStages(output: string): string[] {
  return [...output.matchAll(/^✔ (\S+) /gm)].map((match) => match[1] as string);
}

describe("runPipeline on the fixture repo (AC-2, AC-3, AC-5)", () => {
  it("emits a file that passes validateAnalysis", async () => {
    const { cwd, run } = runOnFixture();
    const result = await run;

    expect(result.outputPath).toBe(join(cwd, DEFAULT_OUTPUT_FILENAME));
    expect(existsSync(result.outputPath)).toBe(true);

    const parsed = JSON.parse(
      readFileSync(result.outputPath, "utf8"),
    ) as unknown;
    expect(validateAnalysis(parsed).valid).toBe(true);
  });

  it("runs the stages in the order the architecture fixes, enrich between validate and emit", async () => {
    const { run, output } = runOnFixture();
    await run;

    const completed = completedStages(output());

    // deps and githist are deliberately concurrent, so which of the two
    // finishes first is not the pipeline's promise — only that both sit
    // between scan and assemble. Asserting a fixed order here would encode a
    // race, and did: it passed only while one of them was a stub.
    expect(completed.slice(0, 3)).toEqual(["repo", "config", "scan"]);
    expect(completed.slice(3, 5).sort()).toEqual(["deps", "githist"]);
    expect(completed.slice(5)).toEqual(["assemble", "enrich", "emit"]);
  });

  it("starts deps and githist together rather than one after the other", async () => {
    const { run, output } = runOnFixture();
    await run;

    // Both start lines come before either end line: the two stages genuinely
    // overlap, rather than being a sequence the summary calls parallel.
    const lines = output().split("\n");
    const lastStart = Math.max(
      lines.indexOf("▸ deps"),
      lines.indexOf("▸ githist"),
    );
    const firstEnd = lines.findIndex((line) => /^✔ (deps|githist) /.test(line));

    expect(lastStart).toBeGreaterThanOrEqual(0);
    expect(firstEnd).toBeGreaterThan(lastStart);
  });

  it("prints a start line and an elapsed end line for every stage", async () => {
    const { run, output } = runOnFixture();
    await run;

    for (const stage of completedStages(output())) {
      expect(output()).toContain(`▸ ${stage}\n`);
      expect(output()).toMatch(
        new RegExp(`^✔ ${stage} \\(\\d+\\.\\d+s\\)$`, "m"),
      );
    }
  });

  it("takes repo metadata from the repository, not from an analyzer", async () => {
    const { run } = runOnFixture();
    const { analysis } = await run;

    expect(analysis.repo.name).toBe("history-repo");
    expect(analysis.repo.remoteUrl).toBeNull();
    expect(analysis.repo.defaultBranch).toBe("main");
    expect(analysis.repo.analysisWindowDays).toBe(FIXTURE_WINDOW_DAYS);
  });

  it("honours --out, absolute or relative to the invocation directory", async () => {
    const { cwd, run } = runOnFixture({ out: "nested/report.json" });
    const result = await run;

    expect(result.outputPath).toBe(join(cwd, "nested", "report.json"));
    expect(existsSync(result.outputPath)).toBe(true);
  });
});

describe("determinism (AC-3, FR-7)", () => {
  it("produces byte-identical output across two runs except analyzedAt", async () => {
    const first = await runOnFixture({
      now: fixedClock("2026-02-03T10:00:00.000Z"),
    }).run;
    const second = await runOnFixture({
      now: fixedClock("2026-09-17T22:31:04.000Z"),
    }).run;

    expect(first.analysis.repo.analyzedAt).toBe("2026-02-03T10:00:00.000Z");
    expect(second.analysis.repo.analyzedAt).toBe("2026-09-17T22:31:04.000Z");
    expect(serialize(first.analysis)).not.toBe(serialize(second.analysis));

    const pinned = (analysis: AnalysisDocument): string =>
      serialize({
        ...analysis,
        repo: { ...analysis.repo, analyzedAt: "PINNED" },
      });
    expect(pinned(first.analysis)).toBe(pinned(second.analysis));
  });

  it("injects analyzedAt and windowAnchor here and nowhere else", async () => {
    const { run } = runOnFixture();
    const { analysis, config } = await run;

    expect(config.windowAnchor).toBe("2026-01-01T00:00:00.000Z");
    expect(analysis.repo.analyzedAt).toBe("2026-02-03T10:00:00.000Z");
  });

  it("defaults the window anchor to the run start when the flag is absent (AD-13)", async () => {
    const { run } = runOnFixture({ windowAnchor: undefined });
    const { analysis, config } = await run;

    expect(config.windowAnchor).toBe(analysis.repo.analyzedAt);
  });

  it("rejects a --window-anchor that is not an instant (AC-6)", async () => {
    await expect(
      runOnFixture({ windowAnchor: "last tuesday" }).run,
    ).rejects.toThrow(
      /^config: --window-anchor "last tuesday" is not an ISO-8601 instant — /,
    );
  });

  it("canonicalizes an offset anchor so equivalent instants emit equal bytes", async () => {
    const utc = await runOnFixture({ windowAnchor: "2026-01-01T00:00:00Z" })
      .run;
    const offset = await runOnFixture({
      windowAnchor: "2026-01-01T01:00:00+01:00",
    }).run;

    expect(utc.config.windowAnchor).toBe(offset.config.windowAnchor);
    expect(serialize(utc.analysis)).toBe(serialize(offset.analysis));
  });
});

describe("failures and notices (AC-1, AC-2)", () => {
  it("aborts in the AD-7 shape on a directory that is not a git repository", async () => {
    const plain = makeTempDir(temps, "gitnebula-plain-");

    let thrown: unknown;
    try {
      await runOnFixture({ target: plain }).run;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StageError);
    expect((thrown as StageError).stage).toBe("repo");
    expect((thrown as StageError).message).toMatch(
      /^repo: .+ is not a git repository — run gitnebula inside a git repository/,
    );
  });

  it("marks the failed stage in the terminal output", async () => {
    const plain = makeTempDir(temps, "gitnebula-plain-");
    const attempt = runOnFixture({ target: plain });

    await attempt.run.catch(() => undefined);

    expect(attempt.output()).toContain("▸ repo\n");
    expect(attempt.output()).toMatch(/^✖ repo /m);
    expect(attempt.output()).not.toContain("▸ scan");
  });

  it("prints the ignored-in-MVP llm notice exactly once (AD-10)", async () => {
    const configured = makeTempDir(temps, "gitnebula-cfg-");
    git(configured, "init", "--quiet", "--template=", "-b", "main");
    writeFileSync(
      join(configured, CONFIG_FILENAME),
      "llm:\n  backend: ollama\n",
    );

    const attempt = runOnFixture({ target: configured });
    await attempt.run;

    const occurrences = attempt.output().split(LLM_IGNORED_NOTICE).length - 1;
    expect(occurrences).toBe(1);
  });

  it("says nothing about llm on a repository with no config (FR-8)", async () => {
    const { run, output } = runOnFixture();
    await run;

    expect(output()).not.toContain("llm");
    expect(output()).not.toMatch(/warn|degrad/i);
  });
});
