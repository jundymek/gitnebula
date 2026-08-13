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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { workspaceRoot } from "./test-support.js";

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

describe("fixture repository build (story 3.6)", () => {
  it("survives concurrent callers, which is what `pnpm -r test` does", async () => {
    const runs = await Promise.all(
      Array.from({ length: 6 }, () =>
        execFileAsync("sh", [buildScript], { encoding: "utf8" }),
      ),
    );

    const heads = runs.map(({ stdout }) => stdout.trim());
    expect(new Set(heads).size).toBe(1);
    expect(heads[0]).toMatch(/^[0-9a-f]{40}$/);

    // And the repository they raced over is a readable one afterwards.
    const head = execFileSync(
      "git",
      [
        "-C",
        join(workspaceRoot, "test-fixtures", ".generated", "history-repo"),
        "rev-parse",
        "HEAD",
      ],
      { encoding: "utf8" },
    ).trim();
    expect(head).toBe(heads[0]);
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
