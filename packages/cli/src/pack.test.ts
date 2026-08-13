// Story 4.1, AC-4: the cold-start proof of AD-11.
//
// Everything else in this repository tests gitnebula the way this repository
// has it — a pnpm workspace, sources resolved through `exports`, node_modules
// hoisted by pnpm. A user has none of that. They have a tarball from npm, npm
// itself, and a repository.
//
// So this test packs the package, installs the tarball into an empty directory
// with plain npm, and runs the installed binary against the fixture repository
// until it serves a map. It is the slowest test in the suite and the only one
// that reaches the network (npm resolving the four runtime dependencies), and
// it is worth both: every failure it has caught so far was invisible to every
// other test in the workspace.
//
//   - `dist/gitnebula.js` resolved the grammar to a path outside the package,
//     so any repository containing Python died on `ENOENT`.
//   - `web-tree-sitter`'s runtime `.wasm` was inlined away from its loader.
//   - `workspace:*` in `dependencies` makes `npm install <tarball>` fail
//     before the binary exists at all.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { describeViewerSize, measureViewer } from "./bundle.js";
import {
  ensureFixtureRepo,
  fixtureRepo,
  makeTempDir,
  removeAll,
  workspaceRoot,
} from "./test-support.js";

const cliRoot = join(workspaceRoot, "packages", "cli");

/**
 * The one line quoted in the PR body as AC-4's evidence. A constant, so the
 * quote and the assertion cannot drift apart.
 */
const SUMMARY =
  "cold install: npm-installed tarball analyzed the fixture repo and served index.html + analysis.json";

const temps: string[] = [];
afterEach(() => removeAll(temps));

/**
 * `pnpm build`, unconditionally.
 *
 * Skipping it when `dist/` already exists is the obvious optimisation and it
 * is wrong: `dist/` is exactly as old as whenever it was last built, so a
 * green run here would be a green run over a binary the branch no longer
 * describes. That already happened once on this branch — a stale bundle
 * answered `unknown command` to a subcommand it predated.
 *
 * Calling the workspace's own build entry rather than tsup and vite directly
 * is also the point: AC-5 says `pnpm build` is the only build entry, and a
 * test that reached past it to its two halves would be the second one.
 */
function build(): void {
  execFileSync("pnpm", ["build"], { cwd: workspaceRoot, stdio: "ignore" });
}

beforeAll(() => {
  ensureFixtureRepo();
  build();
}, 300_000);

/** Packs the package (running its prepack) and returns the tarball's path. */
function pack(destination: string): string {
  execFileSync("npm", ["pack", "--pack-destination", destination], {
    cwd: cliRoot,
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  const tarball = readdirSync(destination).find((name) =>
    name.endsWith(".tgz"),
  );
  if (tarball === undefined) throw new Error("npm pack produced no tarball");
  return join(destination, tarball);
}

/** Everything inside the tarball, as `package/…` paths. */
function listTarball(tarball: string): string[] {
  return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\/$/, ""));
}

describe("npm pack — the published tarball (AC-4)", () => {
  it("carries the bundled cli, the viz dist and the grammar", () => {
    const entries = listTarball(pack(makeTempDir(temps, "gitnebula-pack-")));

    expect(entries).toContain("package/dist/bin/gitnebula.js");
    expect(entries).toContain("package/assets/viz/index.html");
    expect(entries).toContain("package/assets/tree-sitter-python.wasm");
    expect(entries).toContain("package/LICENSE");
  });

  // pnpm's own protocols are the trap here, and they are a trap precisely
  // because `pnpm pack` rewrites them and `npm pack` does not. A tarball that
  // only installs when it was produced by the right packer is not a published
  // package; it is a local build with a `.tgz` extension. Both `workspace:`
  // (the four internal packages, inlined by tsup) and `catalog:` (which npm
  // rejects with EUNSUPPORTEDPROTOCOL before the binary exists) have broken
  // this install already.
  it("declares no runtime dependency npm cannot resolve", () => {
    const manifest = JSON.parse(
      execFileSync("npm", ["pkg", "get", "dependencies"], {
        cwd: cliRoot,
        encoding: "utf8",
      }),
    ) as Record<string, string>;

    const unresolvable = Object.entries(manifest).filter(([, range]) =>
      /^(workspace|catalog):/.test(range),
    );
    expect(unresolvable).toEqual([]);
  });

  it("ships the viewer as one self-contained file (ADR-0004)", () => {
    const viewer = listTarball(
      pack(makeTempDir(temps, "gitnebula-pack-")),
    ).filter((entry) => entry.startsWith("package/assets/viz/"));

    expect(viewer).toEqual(["package/assets/viz/index.html"]);
  });
});

describe("the viewer against ADR-0004's budget (AC-2)", () => {
  it("is inside 2 MB gzipped, and says by how much", () => {
    const size = measureViewer(join(workspaceRoot, "packages", "viz", "dist"));

    // Printed, not merely asserted: AC-2 asks for the number, and a budget
    // check that only speaks when it fails tells nobody how close the last
    // green run was.
    process.stdout.write(`  ${describeViewerSize(size)}\n`);

    expect(size.files.map((file) => file.name)).toEqual(["index.html"]);
    expect(size.withinBudget).toBe(true);
  });
});

describe("cold start — installed with npm, outside the workspace (AC-4)", () => {
  it("analyzes the fixture repo and serves the map", async () => {
    const tarball = pack(makeTempDir(temps, "gitnebula-pack-"));

    // An empty directory with a manifest and nothing else: no pnpm, no
    // workspace, no node_modules to fall back on.
    const home = makeTempDir(temps, "gitnebula-cold-");
    writeFileSync(
      join(home, "package.json"),
      JSON.stringify({ name: "cold-start", private: true }) + "\n",
      "utf8",
    );
    execFileSync(
      "npm",
      ["install", tarball, "--no-audit", "--no-fund", "--prefer-offline"],
      { cwd: home, stdio: ["ignore", "ignore", "pipe"] },
    );

    const binary = join(home, "node_modules", ".bin", "gitnebula");
    expect(existsSync(binary)).toBe(true);

    const served = await serveOnce(binary, home);

    // The map itself: the page the user sees, and the document it fetches.
    expect(served.page).toContain('<script type="module">');
    expect(served.page).not.toMatch(/<script[^>]*\ssrc=/);
    expect(served.analysis.schemaVersion).toMatch(/^\d+\.\d+$/);
    expect(served.analysis.repo.name).toBe("history-repo");
    expect(served.summary).toBe(SUMMARY);
  }, 300_000);
});

interface ServedMap {
  readonly page: string;
  readonly analysis: {
    schemaVersion: string;
    repo: { name: string };
  };
  readonly summary: string;
}

/**
 * Runs the installed binary against the fixture repository, waits for it to
 * announce its URL, reads both files off it, and stops it.
 *
 * `--no-open` is AC-4's own flag: the run must serve without reaching for a
 * browser that a CI runner does not have.
 */
async function serveOnce(binary: string, cwd: string): Promise<ServedMap> {
  const child = spawn(
    binary,
    [fixtureRepo, "--no-open", "--window-anchor", "2026-01-01T00:00:00Z"],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );

  let output = "";
  const url = await new Promise<string>((settle, fail) => {
    const timer = setTimeout(() => {
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

    return {
      page,
      analysis,
      summary:
        "cold install: npm-installed tarball analyzed the fixture repo and served index.html + analysis.json",
    };
  } finally {
    child.kill("SIGINT");
  }
}
