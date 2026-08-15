#!/usr/bin/env node
// Canonical per-package test entry point: `pnpm test:pkg <package name>`.
//
// It resolves the workspace's real project list first, so a filter that
// matches nothing is reported by name instead of being reported as success.
// pnpm's own message names the directory it searched, not the filter it was
// given, which is what made the stale `@gitnebula/cli` filter survive.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Names of every package in the workspace, sorted. */
export function workspacePackages(repoRoot = REPO_ROOT) {
  const packagesDir = join(repoRoot, "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, "package.json"))
    .filter((manifest) => existsSync(manifest))
    .map((manifest) => JSON.parse(readFileSync(manifest, "utf8")).name)
    .sort();
}

function main(argv) {
  const [name, ...rest] = argv;
  const known = workspacePackages();

  if (!name) {
    process.stderr.write(
      `pkg-test: usage: pnpm test:pkg <package name>\n` +
        `pkg-test: workspace packages: ${known.join(", ")}\n`,
    );
    return 2;
  }

  if (!known.includes(name)) {
    process.stderr.write(
      `pkg-test: filter "${name}" matched no project in this workspace.\n` +
        `pkg-test: workspace packages: ${known.join(", ")}\n` +
        `pkg-test: note the cli package is published as "gitnebula", unscoped.\n`,
    );
    return 1;
  }

  const run = spawnSync("pnpm", ["--filter", name, "test", ...rest], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return run.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
