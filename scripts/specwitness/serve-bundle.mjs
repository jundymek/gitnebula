#!/usr/bin/env node
// Serves a built gitnebula bundle on a FIXED port, for SpecWitness browser
// probes.
//
// The product CLI deliberately binds an ephemeral port on 127.0.0.1 and prints
// the URL, which is right for a human but useless to a verifier that must know
// the address before the process starts. This bridge builds the bundle and
// serves that directory at a port SpecWitness declared, so a probe can be
// written against a stable URL.
//
// Not a second implementation of the viewer: it serves exactly the two files
// `gitnebula build` emits (index.html + analysis.json), so what the probe sees
// is the shipped bundle, not a rendering of it.
//
// Usage: node scripts/specwitness/serve-bundle.mjs [--port 4173] [--dir <path>]
//                                                  [--reuse-bundle]

import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const port = Number(flag("port", "4173"));
const dir = resolve(flag("dir", "specwitness-bundle"));

// Build every time. SpecWitness verifies inside an isolated worktree where the
// bundle is always absent, so this costs nothing there — but run by hand in a
// working checkout, a "skip if present" shortcut would serve yesterday's bundle
// and call it evidence. `--reuse-bundle` is the opt-in for iterating on a probe
// against a bundle you know is current.
//
// `gitnebula build` analyzes this repository with the CLI the `build` gate just
// compiled, so what gets served is the shipped artifact.
const reuse =
  args.includes("--reuse-bundle") && existsSync(join(dir, "index.html"));
if (!reuse) {
  const built = spawnSync(
    process.execPath,
    ["packages/cli/dist/bin/gitnebula.js", "build", ".", "-o", dir],
    { stdio: "inherit" },
  );
  if (built.status !== 0) {
    console.error(`bundle build failed with exit code ${built.status}`);
    process.exit(1);
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const name = url.pathname === "/" ? "/index.html" : url.pathname;
  // Only the bundle's own files; no traversal out of `dir`.
  const file = resolve(join(dir, name));
  if (!file.startsWith(dir + "/")) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`serving ${dir} on http://127.0.0.1:${port}`);
});
