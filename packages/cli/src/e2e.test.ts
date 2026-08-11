// AC-5: the M2 evidence. One run of the real pipeline over the built fixture
// repository (AD-14) with the window anchor pinned, compared byte-for-byte
// against a committed expectation.
//
// `analyzedAt` is the one field a rerun is allowed to change (FR-7), so it is
// replaced with a constant before the comparison — everything else in the file
// is a promise this test holds the pipeline to.
//
// To regenerate after an analyzer's behaviour legitimately changes:
//   UPDATE_ANALYSIS_SNAPSHOT=1 pnpm --filter @gitnebula/cli test
// and read the diff before committing it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AnalysisDocument } from "@gitnebula/contract";
import { validateAnalysis } from "@gitnebula/contract";
import { afterEach, describe, expect, it } from "vitest";

import { stubbedAnalyzers } from "./analyzers.js";
import { serialize } from "./emit.js";
import { runPipeline } from "./pipeline.js";
import { createSilentReporter } from "./progress.js";
import {
  FIXTURE_ANCHOR,
  FIXTURE_WINDOW_DAYS,
  fixtureRepo,
  makeTempDir,
  removeAll,
} from "./test-support.js";

const here = dirname(fileURLToPath(import.meta.url));
const expectationPath = join(
  here,
  "__fixtures__",
  "fixture-repo.analysis.json",
);

/** Stand-in for the run instant, so the committed expectation never rots. */
const PINNED_ANALYZED_AT = "2026-01-01T00:00:00.000Z";

/**
 * The one-line result quoted in the PR body as the M2 evidence. Kept as a
 * constant so the quote and the assertion cannot drift apart.
 */
const SUMMARY =
  "history-repo: 0 modules, 0 files, 0 edges, 0 co-change pairs, 0 commits in 365d";

const temps: string[] = [];
afterEach(() => removeAll(temps));

async function analyzeFixtureRepo(): Promise<AnalysisDocument> {
  const { analysis } = await runPipeline({
    target: fixtureRepo,
    cwd: makeTempDir(temps, "gitnebula-e2e-"),
    windowAnchor: FIXTURE_ANCHOR,
    flags: { windowDays: FIXTURE_WINDOW_DAYS },
    reporter: createSilentReporter(),
  });

  return {
    ...analysis,
    repo: { ...analysis.repo, analyzedAt: PINNED_ANALYZED_AT },
  };
}

// TEMPORARY, removed with the last stub: while 2.1/2.2/2.3 are unmerged this
// suite would only assert that three empty results merge into an empty
// document. It skips loudly instead, and un-skips itself the moment the real
// analyzers are on the branch — which AC-5 requires before this story opens
// its PR.
const stubbed = stubbedAnalyzers.length > 0;
const suiteName = stubbed
  ? `end to end on the fixture repo (AC-5) — SKIPPED, still stubbed: ${stubbedAnalyzers.join(", ")}`
  : "end to end on the fixture repo (AC-5, M2 evidence)";

describe.skipIf(stubbed)(suiteName, () => {
  it("wires all three analyzers for real — no inert stubs left", () => {
    expect(stubbedAnalyzers).toEqual([]);
  });

  it("matches the committed expectation byte for byte", async () => {
    const analysis = await analyzeFixtureRepo();
    const emitted = serialize(analysis);

    if (process.env["UPDATE_ANALYSIS_SNAPSHOT"] === "1") {
      mkdirSync(dirname(expectationPath), { recursive: true });
      writeFileSync(expectationPath, emitted, "utf8");
    }

    expect(emitted).toBe(readFileSync(expectationPath, "utf8"));
    expect(validateAnalysis(JSON.parse(emitted) as unknown).valid).toBe(true);
  });

  it("summarizes as the PR body reports it", async () => {
    const analysis = await analyzeFixtureRepo();
    const modules = analysis.nodes.filter(
      (node) => node.kind === "module",
    ).length;
    const files = analysis.nodes.length - modules;

    const summary = `${analysis.repo.name}: ${modules} modules, ${files} files, ${analysis.edges.length} edges, ${analysis.cochanges.length} co-change pairs, ${analysis.repo.stats.commits} commits in ${analysis.repo.analysisWindowDays}d`;

    expect(summary).toBe(SUMMARY);
  });
});
