#!/usr/bin/env node
// A SpecWitness observation: the shape of the on-demand UI suite's Playwright
// configuration (contract criteria E6-01, E6-02).
//
// Prints ONE JSON object to stdout. Every value is read from the file that
// actually configures the run, so a claim like "the suite uses one worker"
// becomes a value SpecWitness compares rather than a sentence in a PR body.
//
// WHY THIS READS TEXT RATHER THAN IMPORTING THE CONFIG.
//
// `playwright.config.ts` is TypeScript, and importing it would need a
// transpiler in this script's process plus `@playwright/test` resolvable from
// the repository root — which it is not, since Playwright is a devDependency of
// `viz`. It would also EXECUTE the config, and a config that reads
// `process.env.UI_PORT` returns whatever this process happens to have set,
// which is the wrong answer to "what is the default". So the file is read as
// source and the settings are matched literally.
//
// The cost is honest: a config that computes a value at runtime cannot be
// observed this way, and the field reports `null` rather than guessing. A null
// here means "not stated literally in the config" and is a real answer, not a
// failure to look.
//
// ABSENT IS NOT THE SAME AS WRONG.
//
// This epic CREATES the file. Before the work lands it does not exist, and the
// observation says so with `present: false` while still printing every field as
// null — so a `verify` run before implementation reports a red criterion for
// the right reason rather than crashing the probe.
//
// Usage: node scripts/specwitness/ui-config-shape.mjs [--file <path>]

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const i = args.indexOf("--file");
const file = resolve(
  i === -1 ? "packages/viz/ui/playwright.config.ts" : args[i + 1],
);

const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (!existsSync(file)) {
  emit({
    present: false,
    testDir: null,
    testMatch: null,
    workers: null,
    fullyParallel: null,
    retries: null,
    viewportWidth: null,
    viewportHeight: null,
    deviceScaleFactor: null,
    defaultPort: null,
    honorsUiPortEnv: false,
    reuseExistingServer: null,
    strictPort: false,
  });
  process.exit(0);
}

const src = readFileSync(file, "utf8");

// One capture, or null. Deliberately literal: see the header.
const one = (re, cast = (s) => s) => {
  const m = src.match(re);
  return m ? cast(m[1]) : null;
};
const num = (re) => one(re, Number);
const bool = (re) => {
  const m = src.match(re);
  return m ? m[1] === "true" : null;
};

emit({
  present: true,
  testDir: one(/testDir:\s*["'`]([^"'`]+)["'`]/),
  testMatch: one(/testMatch:\s*["'`]([^"'`]+)["'`]/),
  workers: num(/workers:\s*(\d+)/),
  fullyParallel: bool(/fullyParallel:\s*(true|false)/),
  retries: num(/retries:\s*(\d+)/),
  viewportWidth: num(/viewport:\s*\{\s*width:\s*(\d+)/),
  viewportHeight: num(/viewport:\s*\{[^}]*height:\s*(\d+)/),
  deviceScaleFactor: num(/deviceScaleFactor:\s*(\d+)/),
  // `process.env.UI_PORT ?? 4320` — the fallback is the default.
  defaultPort: num(/UI_PORT\s*\?\?\s*(\d+)/),
  honorsUiPortEnv: /process\.env\.UI_PORT/.test(src),
  reuseExistingServer: bool(/reuseExistingServer:\s*(true|false)/),
  strictPort: /--strictPort/.test(src),
});
