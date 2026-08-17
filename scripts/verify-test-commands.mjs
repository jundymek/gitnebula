#!/usr/bin/env node
// The repository's tooling checks — the things that are true of the workspace
// rather than of any one package. Wired into the root `pnpm test` so they
// cannot rot unnoticed; run them alone with `pnpm test:tooling`.
//
//   1. a workspace filter that matches no project FAILS (the `.npmrc` setting);
//   2. the canonical runner names the filter that matched nothing;
//   3. CLAUDE.md's canonical command table and the workspace agree, in both
//      directions, and every command in it has the one literal form a later
//      spec can be checked against;
//   4. no tracked text file carries a literal NUL byte (story 5.10).
//
// 1–3 are story 5.9's. 4 lives here rather than in an entry point of its own
// because a second entry point is a second thing to remember to run.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findNulBytes, formatFinding } from "./nul-sweep.mjs";
import { workspacePackages } from "./pkg-test.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUNNER = join(REPO_ROOT, "scripts", "pkg-test.mjs");

// The name the cli package carried until commit efeaceb renamed it to
// `gitnebula`. Six story specs still quote it; it must fail loudly now.
const STALE_FILTER = "@gitnebula/cli";

const TABLE_START = "<!-- canonical-test-commands:start -->";
const TABLE_END = "<!-- canonical-test-commands:end -->";

const failures = [];
const check = (label, ok, detail) => {
  if (ok) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    process.stdout.write(`  FAIL ${label}\n`);
    failures.push(`${label}${detail ? `\n       ${detail}` : ""}`);
  }
};

/** The `<package name>` -> `<command>` rows of CLAUDE.md's canonical table. */
function canonicalTable() {
  const claudeMd = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8");
  const start = claudeMd.indexOf(TABLE_START);
  const end = claudeMd.indexOf(TABLE_END);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  const rows = new Map();
  for (const line of claudeMd.slice(start, end).split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 2 || /^-+$/.test(cells[0])) continue;
    const name = cells[0].replace(/`/g, "");
    const command = cells[1].replace(/`/g, "");
    if (name === "package") continue; // header row
    rows.set(name, command);
  }
  return rows;
}

process.stdout.write("verify-test-commands\n");

// 1. A no-match filter must fail. `list` is the cheapest filtered command
//    there is; the setting under test is global, not per-command.
const noMatch = spawnSync(
  "pnpm",
  ["--filter", "@gitnebula/there-is-no-such-package", "list"],
  { cwd: REPO_ROOT, encoding: "utf8" },
);
check(
  "a filter matching no project exits non-zero",
  noMatch.status !== 0,
  `exit ${noMatch.status} — is fail-if-no-match=true still in .npmrc?`,
);

// 2. The canonical runner rejects the stale filter and says which one it was.
const stale = spawnSync(process.execPath, [RUNNER, STALE_FILTER], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
check(
  `pkg-test rejects "${STALE_FILTER}"`,
  stale.status === 1,
  `exit ${stale.status}`,
);
check(
  "pkg-test names the filter that matched nothing",
  stale.stderr.includes(STALE_FILTER) &&
    stale.stderr.includes("matched no project"),
  JSON.stringify(stale.stderr),
);

// 3. The table in CLAUDE.md is complete, correct and mechanically checkable.
const packages = workspacePackages();
const table = canonicalTable();

if (!table) {
  check(
    "CLAUDE.md carries the canonical command table",
    false,
    `${TABLE_START} not found`,
  );
} else {
  const missing = packages.filter((name) => !table.has(name));
  const extra = [...table.keys()].filter((name) => !packages.includes(name));
  check(
    "every workspace package has a row",
    missing.length === 0,
    `missing: ${missing.join(", ")}`,
  );
  check(
    "every row names a real package",
    extra.length === 0,
    `unknown: ${extra.join(", ")}`,
  );
  for (const [name, command] of table) {
    check(
      `row "${name}" carries the literal command form`,
      command === `pnpm --filter ${name} test`,
      `got: ${command}`,
    );
  }
}

// 4. No tracked text file carries a literal NUL byte (story 5.10). The finding
//    names the file, the line and the byte offset, because the byte renders as
//    nothing in a diff, an editor and a code review alike.
const nulFindings = findNulBytes(REPO_ROOT);
check(
  "no tracked text file carries a NUL byte",
  nulFindings.length === 0,
  nulFindings.map(formatFinding).join("\n       "),
);

if (failures.length > 0) {
  process.stderr.write(`\nverify-test-commands: ${failures.length} failed\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}
process.stdout.write(
  `verify-test-commands: ${packages.length} packages, all checks passed\n`,
);
