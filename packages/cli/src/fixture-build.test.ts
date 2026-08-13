// Story 3.6, AC-5: the guard against the defect coming back.
//
// The fixture builder used to `rm -rf` a shared directory with four callers
// racing it under `pnpm -r test`, and no single story owned that: three
// stories each added a reasonable caller and nothing noticed. Two assertions
// here, one per half of the problem:
//
//   - concurrent builders must all succeed and agree on the HEAD hash;
//   - no package may reintroduce a `pretest` that shells out to the builder,
//     because a package script runs outside the builder's lock discipline in
//     the sense that matters — it multiplies callers again for no gain now
//     that suites build the fixture themselves.
//
// This lives in `cli` because it is a workspace-level fact and `cli` is the
// package that already reaches across the whole workspace.
import { execFile, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureFixtureRepo,
  fixtureRepo,
  makeTempDir,
  removeAll,
  workspaceRoot,
} from "./test-support.js";

const temps: string[] = [];
afterEach(() => removeAll(temps));

const execFileAsync = promisify(execFile);

const BUILDER = "build-fixture-repo.sh";
const buildScript = join(workspaceRoot, "test-fixtures", BUILDER);

interface PackageManifest {
  name?: string;
  scripts?: Record<string, string>;
}

function workspaceManifests(): { name: string; manifest: PackageManifest }[] {
  const packagesDir = join(workspaceRoot, "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = join(packagesDir, entry.name, "package.json");
      const manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as PackageManifest;
      return { name: manifest.name ?? entry.name, manifest };
    });
}

function head(repo: string): string {
  return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

describe("fixture repository build (story 3.6)", () => {
  it("survives concurrent callers building from nothing", async () => {
    // The builders are pointed at a throwaway copy of the script, which
    // derives its paths from its own location. Two reasons: they must go
    // through the real build rather than the already-built no-op, and they
    // must not delete the fixture the rest of the workspace is reading — the
    // very failure this story exists to remove.
    const sandbox = makeTempDir(temps, "gitnebula-fixture-race-");
    const scriptCopy = join(sandbox, BUILDER);
    copyFileSync(buildScript, scriptCopy);
    mkdirSync(join(sandbox, ".generated"));

    const runs = await Promise.all(
      Array.from({ length: 6 }, () =>
        execFileAsync("sh", [scriptCopy], { encoding: "utf8" }),
      ),
    );

    const heads = runs.map(({ stdout }) => stdout.trim());
    expect(new Set(heads).size).toBe(1);
    expect(heads[0]).toMatch(/^[0-9a-f]{40}$/);

    // The repository they raced over is readable afterwards, no lock is left
    // behind, and it is the same history the workspace fixture has (AD-4).
    const built = join(sandbox, ".generated", "history-repo");
    expect(head(built)).toBe(heads[0]);
    expect(existsSync(join(sandbox, ".generated", "history-repo.lock"))).toBe(
      false,
    );

    ensureFixtureRepo();
    expect(heads[0]).toBe(head(fixtureRepo));
  });

  it("has exactly one package script invoking the builder: the root pretest", () => {
    const rootManifest = JSON.parse(
      readFileSync(join(workspaceRoot, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(rootManifest.scripts?.pretest).toContain(BUILDER);

    const offenders = workspaceManifests().flatMap(({ name, manifest }) =>
      Object.entries(manifest.scripts ?? {})
        .filter(([, command]) => command.includes(BUILDER))
        .map(([script]) => `${name}: ${script}`),
    );

    // A package that needs the fixture calls the builder from its suite, where
    // the lock and the already-built no-op apply per call. See AC-2/AC-3.
    expect(offenders).toEqual([]);
  });
});
