// Shared test helpers. Not exported from the package index — this file exists
// for the colocated `*.test.ts` files and nothing else.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Workspace root, from `packages/cli/src`. */
export const workspaceRoot = join(here, "..", "..", "..");

/**
 * The deterministic fixture repository (AD-14). Built by `ensureFixtureRepo`
 * below, so `pnpm --filter @gitnebula/cli test` is self-sufficient.
 */
export const fixtureRepo = join(
  workspaceRoot,
  "test-fixtures",
  ".generated",
  "history-repo",
);

const buildScript = join(
  workspaceRoot,
  "test-fixtures",
  "build-fixture-repo.sh",
);

/**
 * Builds the fixture repository if it is not already there (story 3.6). The
 * builder holds a lock and no-ops on a valid repository, so calling it from
 * every suite that needs the fixture is both safe under `pnpm -r test` and
 * cheap — this is what replaces this package's `pretest`.
 */
export function ensureFixtureRepo(): void {
  execFileSync("sh", [buildScript], { stdio: "ignore" });
}

/** The window fixture tests pin, matching `test-fixtures/README.md`. */
export const FIXTURE_ANCHOR = "2026-01-01T00:00:00Z";
export const FIXTURE_WINDOW_DAYS = 365;

/** Creates a temp directory and registers it for removal. */
export function makeTempDir(registry: string[], prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  registry.push(dir);
  return dir;
}

export function removeAll(registry: string[]): void {
  while (registry.length > 0) {
    rmSync(registry.pop() as string, { recursive: true, force: true });
  }
}

/** Runs git in `cwd`, letting a failure surface as a test failure. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
