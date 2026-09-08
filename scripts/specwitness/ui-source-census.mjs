#!/usr/bin/env node
// A SpecWitness observation: how the UI suite's own sources are written
// (criterion E6-09).
//
// Prints ONE JSON object to stdout.
//
// E6-09 makes two mechanical claims, and both are countable rather than
// judgeable, which is why this observation is worth writing at all:
//
//   1. sources import `HARNESS_HANDLE_KEY` instead of spelling `__gitnebula`;
//   2. every assertion supplies a prose failure message.
//
// The first is exact: a literal `__gitnebula` anywhere in the suite is a
// violation, and the count is the assertion. The second is approximate and
// says so -- `expect(...)` calls are counted against those carrying a message
// argument, and a helper that wraps `expect` would not be seen. The number to
// assert on is `expectsWithoutMessage`, whose useful expected value is 0; a
// suite that wraps every assertion in a helper would report 0 for a different
// reason, and that is a reading a human does once rather than a hole a machine
// falls into every run.
//
// Absent directory reports zeroes with `present: false`, for the reason
// `ui-config-shape.mjs` gives: this epic creates it.
//
// Usage: node scripts/specwitness/ui-source-census.mjs

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const UI = "packages/viz/ui";
const present = existsSync(UI);
const files = walk(UI).filter((f) => /\.ts$/.test(f));

let literalHandleKey = 0;
let importsHandleKeyConst = 0;
let expectCalls = 0;
let expectsWithoutMessage = 0;
let gotoDirect = 0;
let openViewerUses = 0;

for (const f of files) {
  const src = readFileSync(f, "utf8");
  literalHandleKey += [...src.matchAll(/["'`]__gitnebula["'`]/g)].length;
  if (/HARNESS_HANDLE_KEY/.test(src)) importsHandleKeyConst++;
  // E6-07 supporting evidence: navigation goes through the shared helper.
  gotoDirect += [...src.matchAll(/\bpage\.goto\(/g)].length;
  openViewerUses += [...src.matchAll(/\bopenViewer\(/g)].length;

  for (const m of src.matchAll(/\bexpect\(/g)) {
    expectCalls++;
    // A message is the second argument of the matcher call on the same
    // statement: `.toBe(x, "why")` or `expect(v, "why")`.
    const tail = src.slice(m.index, m.index + 400);
    if (!/,\s*["'`]/.test(tail.split("\n")[0] ?? "")) expectsWithoutMessage++;
  }
}

process.stdout.write(
  JSON.stringify({
    present,
    specFileCount: files.filter((f) => f.endsWith(".pw.ts")).length,
    sourceFileCount: files.length,
    literalHandleKeyCount: literalHandleKey,
    filesImportingHandleKeyConst: importsHandleKeyConst,
    expectCalls,
    expectsWithoutMessage,
    pageGotoDirectCount: gotoDirect,
    openViewerUseCount: openViewerUses,
  }) + "\n",
);
