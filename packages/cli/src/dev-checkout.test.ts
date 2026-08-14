// Story 4.5, AC-6: the built binary has to work in a plain dev checkout.
//
// Every other proof in this package runs the binary somewhere it has been
// helped. `pack.test.ts` runs it out of an npm tarball, and `npm pack` runs
// prepack on the way, which is what populates `packages/cli/assets/`. The rest
// of the suite runs the sources. Nobody was testing the state a contributor is
// actually in one minute after `git clone`: `pnpm install && pnpm build`, and
// then the command README and CONTRIBUTING both tell them to run.
//
// In that state the binary used to be broken twice over — it could not find
// the viewer, so it could not serve at all whatever the repository contained,
// and it could not find `tree-sitter-python.wasm`, so the first Python file
// killed the `deps` stage with ENOENT. Story 4.4 found the second half while
// measuring the DoD (PR #39) and reported it; the maintainer widened this
// story's AC-6 to the first half at launch. Neither was ever a shipping
// defect — the tarball has always been correct — which is exactly why no test
// saw them.
//
// The whole check is one test holding the build lock, on purpose. It asserts
// what `pnpm build` *left behind*, so it must not be possible for another
// worker's `npm pack` to repopulate `assets/` in the middle and hand it a pass
// it did not earn.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AnalysisDocument } from "@gitnebula/contract";
import { formatValidationErrors, validateAnalysis } from "@gitnebula/contract";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  FIXTURE_ANCHOR,
  ensureFixtureRepo,
  fixtureRepo,
  makeTempDir,
  rebuildWithoutAssets,
  removeAll,
  withBuildLockAsync,
  workspaceRoot,
} from "./test-support.js";

const cliRoot = join(workspaceRoot, "packages", "cli");
const binary = join(cliRoot, "dist", "bin", "gitnebula.js");
const assets = join(cliRoot, "assets");

const temps: string[] = [];
afterEach(() => removeAll(temps));

beforeAll(() => {
  ensureFixtureRepo();
}, 300_000);

describe("a fresh clone after `pnpm build` and nothing else (AC-6)", () => {
  it("analyzes a repository containing Python and serves the map", async () => {
    await withBuildLockAsync(async () => {
      rebuildWithoutAssets();

      // The two files prepack used to be the only producer of. Asserted by
      // name rather than left implicit in the run below, so a failure says
      // which half of the gap reopened.
      expect(existsSync(join(assets, "viz", "index.html"))).toBe(true);
      expect(existsSync(join(assets, "tree-sitter-python.wasm"))).toBe(true);

      // --no-serve: the pipeline half, the way the README documents it.
      const out = join(makeTempDir(temps, "gitnebula-devcheckout-"), "a.json");
      const written = await run([fixtureRepo, "--no-serve", "--out", out]);
      expect(written.code).toBe(0);
      expect(existsSync(out)).toBe(true);

      const analysis = JSON.parse(
        readFileSync(out, "utf8"),
      ) as AnalysisDocument;
      const result = validateAnalysis(analysis);
      expect(result.valid ? "" : formatValidationErrors(result.errors)).toBe(
        "",
      );

      // Python actually reached `deps`. Without the grammar this run either
      // died on ENOENT or degraded to a tree with no Python in it, and an
      // assertion on schema validity alone would not tell the two apart.
      const python = analysis.nodes.filter((node) => node.path.endsWith(".py"));
      expect(python.length).toBeGreaterThan(0);

      // The serving half — the maintainer's widening of AC-6. The viewer is
      // language-independent, so this is the failure every contributor hits,
      // not only the ones with Python in their tree.
      const served = await serveOnce();
      expect(served.page).toContain('<script type="module">');
      expect(served.analysis.repo.name).toBe("history-repo");
    });
  }, 600_000);
});

interface Finished {
  readonly code: number | null;
  readonly output: string;
}

/** Runs the built binary to completion and returns its exit code and output. */
function run(args: string[]): Promise<Finished> {
  return new Promise((settle, fail) => {
    const child = spawn(
      process.execPath,
      [binary, ...args, "--window-anchor", FIXTURE_ANCHOR],
      { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    const onChunk = (chunk: Buffer): void => {
      output += chunk.toString();
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", fail);
    child.on("exit", (code) => {
      // The output travels with the code: a non-zero exit whose stderr is
      // discarded is the least useful failure a test can produce, and the
      // whole class of defect here announces itself in that text.
      settle({ code, output });
    });
  });
}

interface ServedMap {
  readonly page: string;
  readonly analysis: { repo: { name: string } };
}

/**
 * Starts the binary in its default serving mode, reads the page and the
 * analysis off it, and stops it.
 *
 * `--no-open` because a CI runner has no browser to open, exactly as
 * `pack.test.ts` does it.
 */
async function serveOnce(): Promise<ServedMap> {
  const child = spawn(
    process.execPath,
    [
      binary,
      fixtureRepo,
      "--no-open",
      "--out",
      join(makeTempDir(temps, "gitnebula-devserve-"), "analysis.json"),
      "--window-anchor",
      FIXTURE_ANCHOR,
    ],
    { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] },
  );

  let output = "";
  const url = await new Promise<string>((settle, fail) => {
    const timer = setTimeout(() => {
      child.kill("SIGINT");
      fail(new Error(`the binary never announced a URL. Output:\n${output}`));
    }, 120_000);
    const onChunk = (chunk: Buffer): void => {
      output += chunk.toString();
      const match = /serving (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
      if (match) {
        clearTimeout(timer);
        settle(match[1] as string);
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`the binary exited with ${code}. Output:\n${output}`));
    });
  });

  try {
    const page = await (await fetch(url)).text();
    const analysis = (await (
      await fetch(new URL("analysis.json", url))
    ).json()) as ServedMap["analysis"];
    return { page, analysis };
  } finally {
    child.kill("SIGINT");
  }
}
