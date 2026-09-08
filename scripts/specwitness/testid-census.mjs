#!/usr/bin/env node
// A SpecWitness observation: where stable test hooks live, and how much the
// chrome tests still select by CSS class (criteria E6-29, E6-30).
//
// Prints ONE JSON object to stdout.
//
// WHAT A COUNT CAN AND CANNOT SETTLE.
//
// E6-29 says hooks are present "only on" a named set of regions. A census can
// prove the TOTAL and show WHERE each hook sits; it cannot judge whether a
// given element was already identifiable by role and accessible name, which is
// the other half of that criterion. So this reports the hooks with their file
// and their id, and the reviewer judges the "only on" clause against a list
// rather than against the whole diff. That is a smaller job than reading the
// epic, and it is the part a machine can do honestly.
//
// E6-30 asks for a post-change count "lower than the independently documented
// pre-change count". The pre-change number is what this file measures TODAY,
// before the epic starts -- which is why it is worth recording now and not
// after. `classSelectorCount` is that number.
//
// The counting is deliberately crude and stated so: a regex over test sources
// for `.p-`-style class selectors inside query calls. It will not see a
// selector built by string concatenation. It is a trend measurement, and the
// criterion asks for a direction of change rather than an exact figure.
//
// Usage: node scripts/specwitness/testid-census.mjs

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const SRC = "packages/viz/src";
const files = walk(SRC);

// Every data-testid literal in the product source, with where it lives.
const hooks = [];
for (const f of files.filter((f) => /\.(ts|tsx|html)$/.test(f))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/data-testid=["'`]([^"'`]+)["'`]/g)) {
    hooks.push({ file: relative(SRC, f), id: m[1] });
  }
  // The attribute can also be set programmatically.
  for (const m of src.matchAll(
    /setAttribute\(\s*["'`]data-testid["'`]\s*,\s*["'`]([^"'`]+)["'`]/g,
  )) {
    hooks.push({ file: relative(SRC, f), id: m[1] });
  }
}

// Class-based selection inside chrome tests -- the number E6-30 wants to fall.
const testFiles = files.filter(
  (f) => /\.test\.ts$/.test(f) && f.includes("chrome"),
);
let classSelectorCount = 0;
for (const f of testFiles) {
  const src = readFileSync(f, "utf8");
  classSelectorCount += [
    ...src.matchAll(/querySelector(?:All)?\(\s*["'`][^"'`]*\.[a-zA-Z][\w-]*/g),
  ].length;
}

// E6-29 protects two header slot ids byte-for-byte; report what exists.
const headerIds = [];
for (const f of files.filter(
  (f) => /\.(ts|html)$/.test(f) && f.includes("header"),
)) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/id=["'`]([^"'`]+)["'`]/g)) headerIds.push(m[1]);
}

process.stdout.write(
  JSON.stringify({
    testIdCount: hooks.length,
    testIds: hooks.map((h) => h.id).sort(),
    testIdsByFile: hooks.reduce((acc, h) => {
      (acc[h.file] ??= []).push(h.id);
      return acc;
    }, {}),
    chromeTestFileCount: testFiles.length,
    classSelectorCount,
    headerIds: [...new Set(headerIds)].sort(),
  }) + "\n",
);
