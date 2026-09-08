#!/usr/bin/env node
// A SpecWitness observation: which commands this repository exposes, and what
// the default test command actually invokes (criteria E6-03, E6-04, E6-05).
//
// Prints ONE JSON object to stdout.
//
// THE QUESTION THIS ANSWERS, AND THE ONE IT DOES NOT.
//
// E6-04 says `pnpm test` "invokes no Playwright suite". A command cannot be
// asked what it would do without running it, and running the whole suite to
// find out would make this observation as expensive as the gate it sits beside.
// So this reads the SCRIPT GRAPH: `test` at the root, every script it delegates
// to via `pnpm -r` or `--filter`, and whether any of them mentions Playwright.
//
// That is a real answer to a narrower question -- "does the declared script
// graph reach Playwright" -- and the narrowing is deliberate rather than
// hidden. A suite that shells out to Playwright from inside a test FILE would
// not be seen here, and no static reading of package.json could see it.
// `playwrightReachableFromTest` is named for what it measures.
//
// E6-05 ("succeeds with no browser installed") is NOT answered here at all. It
// is a claim about a machine, not about a file, and the honest observation is
// the absence of a Playwright invocation in the graph -- which is the
// precondition for it, not the proof of it. The criterion keeps whatever
// verdict the gate gives it.
//
// Usage: node scripts/specwitness/pkg-scripts.mjs

import { readFileSync, existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const readJson = (p) =>
  existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;

const root = readJson("package.json") ?? {};
const rootScripts = root.scripts ?? {};

// Every workspace package's scripts, keyed by package name.
const pkgScripts = {};
for (const dir of existsSync("packages") ? readdirSync("packages") : []) {
  const pkg = readJson(join("packages", dir, "package.json"));
  if (pkg?.name) pkgScripts[pkg.name] = pkg.scripts ?? {};
}

const MENTIONS_PLAYWRIGHT = /playwright/i;

// `pnpm -r test` fans out to every package's `test`. Follow that.
const reachable = [];
const rootTest = rootScripts.test ?? "";
if (MENTIONS_PLAYWRIGHT.test(rootTest)) reachable.push("root:test");
if (/-r\s+test|--recursive\s+test/.test(rootTest)) {
  for (const [name, s] of Object.entries(pkgScripts)) {
    if (s.test && MENTIONS_PLAYWRIGHT.test(s.test))
      reachable.push(`${name}:test`);
  }
}

const viz = pkgScripts["@gitnebula/viz"] ?? {};

process.stdout.write(
  JSON.stringify({
    rootTest,
    rootTestRecursive: /-r\s+test|--recursive\s+test/.test(rootTest),
    playwrightReachableFromTest: reachable.length > 0,
    playwrightReachableVia: reachable,
    // E6-03: the on-demand suite has its own script, separate from `test`.
    vizHasUiScript: typeof viz.ui === "string",
    vizUiScript: viz.ui ?? null,
    vizUiInvokesPlaywright: MENTIONS_PLAYWRIGHT.test(viz.ui ?? ""),
    vizTestScript: viz.test ?? null,
    vizTestInvokesPlaywright: MENTIONS_PLAYWRIGHT.test(viz.test ?? ""),
  }) + "\n",
);
