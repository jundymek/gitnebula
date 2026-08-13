// Shared test helpers. Not exported from the package index — this file exists
// for the colocated `*.test.ts` files and nothing else.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const buildLock = join(
  workspaceRoot,
  "node_modules",
  ".cache",
  "gitnebula-build.lock",
);
const buildStamp = join(
  workspaceRoot,
  "node_modules",
  ".cache",
  "gitnebula-build.stamp",
);

/** Blocks the calling thread, so this stays usable from a synchronous test. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * `pnpm build`, from the workspace root, serialized across vitest workers.
 *
 * Skipping the build when `dist/` already exists is the obvious optimisation
 * and it is wrong: `dist/` is exactly as old as whenever it was last built, so
 * a green run over it would be a green run over a binary the branch no longer
 * describes. `tsup` cleans its output directory, so a `dist/` predating story
 * 4.1's rename still holds `dist/gitnebula.js` — the very path story 4.6's
 * check exists to catch.
 *
 * But two suites each running `pnpm build` in parallel workers would race, one
 * cleaning `dist/` while the other reads it. Hence the lock: the first caller
 * builds and stamps; a caller that waited and finds a build completed *after*
 * it asked skips its own, because that build is fresh by definition.
 *
 * Calling the workspace's own build entry rather than tsup and vite directly
 * is also the point: 4.1's AC-5 says `pnpm build` is the only build entry, and
 * a test reaching past it to its two halves would be the second one.
 */
export function buildWorkspace(): void {
  const requestedAt = Date.now();
  const deadline = requestedAt + 300_000;
  mkdirSync(dirname(buildLock), { recursive: true });

  for (;;) {
    try {
      mkdirSync(buildLock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        throw new Error("timed out waiting for the workspace build lock");
      }
      sleep(250);
      continue;
    }
    try {
      if (builtSince(requestedAt)) return;
      execFileSync("pnpm", ["build"], { cwd: workspaceRoot, stdio: "ignore" });
      writeFileSync(buildStamp, String(Date.now()));
    } finally {
      rmSync(buildLock, { recursive: true, force: true });
    }
    return;
  }
}

function builtSince(instant: number): boolean {
  if (!existsSync(buildStamp)) return false;
  return Number(readFileSync(buildStamp, "utf8")) >= instant;
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
