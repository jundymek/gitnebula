#!/usr/bin/env node
// A SpecWitness observation: things this epic promised NOT to change
// (criteria E6-35, E6-36).
//
// Prints ONE JSON object to stdout. Digests rather than prose: "the schema is
// unchanged" is a claim a reader cannot check, whereas a SHA-256 recorded
// before the epic and compared after is a fact.
//
// WHY DIGESTS AND COUNTS, NOT A DIFF.
//
// SpecWitness compares an observation's values across a run, and the plan
// asserts on them. A digest is the smallest value that changes if and only if
// the bytes change, which is exactly the promise E6-36 makes ("byte-for-byte
// unchanged"). Counting dependencies rather than listing them is the same
// choice one level down: E6-35 promises that NO package dependency was added,
// so the number is the assertion and the names would be noise -- until the
// number moves, at which point `pnpm why` answers better than this file could.
//
// A missing file reports a null digest rather than throwing. Deleting
// `analysis.schema.json` would be a spectacular way to violate E6-36, and a
// probe that crashed on it would report an infrastructure error instead of the
// product failure it is.
//
// Usage: node scripts/specwitness/file-integrity.mjs

import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const digest = (p) =>
  existsSync(p)
    ? createHash("sha256").update(readFileSync(p)).digest("hex")
    : null;

const readJson = (p) =>
  existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;

// Total declared dependencies across the workspace. E6-35: this must not grow.
let depCount = 0;
const perPackage = {};
const countIn = (pkg, label) => {
  if (!pkg) return;
  const n =
    Object.keys(pkg.dependencies ?? {}).length +
    Object.keys(pkg.devDependencies ?? {}).length;
  perPackage[label] = n;
  depCount += n;
};

countIn(readJson("package.json"), "(root)");
for (const dir of existsSync("packages") ? readdirSync("packages") : []) {
  const pkg = readJson(join("packages", dir, "package.json"));
  if (pkg?.name) countIn(pkg, pkg.name);
}

// E6-35: the fixture builders. A NEW fixture would mean a new builder script.
const fixtureBuilders = existsSync("test-fixtures")
  ? readdirSync("test-fixtures")
      .filter((f) => f.startsWith("build-") && f.endsWith(".sh"))
      .sort()
  : [];

const schema = readJson("packages/contract/src/analysis.schema.json");

process.stdout.write(
  JSON.stringify({
    analysisSchemaDigest: digest("packages/contract/src/analysis.schema.json"),
    // E6-36 names the document schemaVersion explicitly.
    analysisSchemaVersion:
      schema?.properties?.schemaVersion?.const ??
      schema?.properties?.schemaVersion?.default ??
      null,
    loaderDigest: digest("packages/viz/src/loader.ts"),
    tooltipDigest: digest("packages/viz/src/chrome/tooltip.ts"),
    dependencyCount: depCount,
    dependencyCountByPackage: perPackage,
    fixtureBuilders,
    fixtureBuilderCount: fixtureBuilders.length,
  }) + "\n",
);
