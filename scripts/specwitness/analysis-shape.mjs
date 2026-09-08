#!/usr/bin/env node
// A SpecWitness observation: measurable facts about what the pipeline produced.
//
// Prints ONE JSON object to stdout. SpecWitness compares the values it printed
// before a change against the values after, so a claim like "this story does
// not change the graph" becomes a diff rather than a sentence in a PR body.
//
// Reads the bundle's analysis.json rather than re-running the analyzers: the
// artifact under verification is the file the frontend actually consumes.
//
// Usage: node scripts/specwitness/analysis-shape.mjs [--file <path>]

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const i = args.indexOf("--file");
const file = resolve(
  i === -1 ? "specwitness-bundle/analysis.json" : args[i + 1],
);

const analysis = JSON.parse(readFileSync(file, "utf8"));

process.stdout.write(
  JSON.stringify({
    schemaVersion: analysis.schemaVersion ?? null,
    nodes: analysis.nodes?.length ?? 0,
    edges: analysis.edges?.length ?? 0,
    cochanges: analysis.cochanges?.length ?? 0,
    // A node carrying a description means the optional LLM layer ran. It must
    // be 0 for as long as `describe` is out of scope.
    describedNodes:
      analysis.nodes?.filter((n) => n.description != null).length ?? 0,
  }) + "\n",
);
