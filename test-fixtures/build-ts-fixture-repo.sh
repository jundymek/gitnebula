#!/usr/bin/env sh
# Builds the crafted TS/JS source trees used by `deps` tests (AD-14).
#
# Two trees are written into the gitignored test-fixtures/.generated/ — built,
# never committed:
#
#   ts-imports-repo            the AC-1..AC-5 fixture: relative imports, a
#                              `paths` alias, a `baseUrl` import, an implicit
#                              `index.ts`, an `export * from` chain, dynamic
#                              `import()`, JS `require`, a stylesheet import,
#                              a node_modules import, an uninstalled package,
#                              a Node builtin, an import to a file outside the
#                              scanned universe, two kinds of unresolvable
#                              import, and a file with syntax errors
#   ts-imports-repo-no-config  the AC-7 fixture: no tsconfig.json at all
#
# Unlike build-fixture-repo.sh (githist's, whose commit hashes are pinned by
# story 2.3's snapshots and which this script deliberately does not touch),
# these trees are plain files with no git history: deps reads the working
# tree, never the log, so a repository here would be ceremony.
#
# The file with syntax errors is the reason the fixture is generated rather
# than committed — as a committed .ts it would break `pnpm lint` and
# `pnpm typecheck` for the whole workspace.
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR="$ROOT_DIR/.generated/ts-imports-repo"
PLAIN_DIR="$ROOT_DIR/.generated/ts-imports-repo-no-config"

rm -rf "$REPO_DIR" "$PLAIN_DIR"
mkdir -p "$REPO_DIR" "$PLAIN_DIR"

write() {
  # write <path-relative-to-REPO_DIR>; content on stdin
  mkdir -p "$(dirname -- "$REPO_DIR/$1")"
  cat > "$REPO_DIR/$1"
}

# --- tsconfig: baseUrl and a paths alias, the two resolution features a
# --- syntax-level parser cannot follow (ADR-0001) --------------------------

write tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowJs": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
EOF

# --- top-level file: parent is null in the ScanResult, so its edge exists at
# --- file level and contributes no module edge (D6) ------------------------

write main.ts <<'EOF'
// Implicit index.ts: "./app" resolves to app/index.ts.
import { boot } from "./app";

boot();
EOF

# --- module `app` ----------------------------------------------------------

write app/index.ts <<'EOF'
// Re-export chain, same module: a file edge, no module self-loop.
export * from "./view";
// Alias import through `paths` into another module.
export { engine } from "@/core";
// An alias the repo defines but nothing answers: a real miss, counted
// unresolved rather than waved through as a package.
import "@/missing";
EOF

write app/view.ts <<'EOF'
// The same target imported twice, once as a type: one deduplicated file edge.
import { format } from "@/utils/format";
import type { Formatted } from "@/utils/format";
// Non-relative import resolved through `baseUrl`, not through `paths`.
import { pad } from "utils/pad";
// A stylesheet beside the component: a repo file the TypeScript resolver
// cannot follow, resolved against the scan universe instead.
import "./view.css";

export const view = (n: number): Formatted => format(pad(n));
EOF

write app/view.css <<'EOF'
.view {
  color: rebeccapurple;
}
EOF

# --- module `core` ---------------------------------------------------------

write core/index.ts <<'EOF'
export * from "./engine";
EOF

write core/engine.ts <<'EOF'
import { format } from "../utils/format";
// Bare specifier resolving into node_modules: counted external, no edge.
import react from "react";
// A package with nothing in node_modules — exactly what a fresh clone looks
// like. Still a dependency, never an intra-repo edge.
import { z } from "zod";
// A workspace package: node_modules is only the route, the destination is
// shared/util.ts in this repo.
import { shared } from "@fixture/shared";

export const engine = async (n: number): Promise<string> => {
  // Dynamic import with a literal specifier.
  const { lazy } = await import("./lazy");
  return format(lazy(shared(n))) + String(react) + String(z);
};
EOF

write core/lazy.ts <<'EOF'
// Resolves to a real file that the ScanResult does not list: outside the
// closed universe (AD-13), so no edge and its own counter.
import { hidden } from "../vendored/secret";

export const lazy = (n: number): number => n + hidden;
EOF

# --- module `utils` --------------------------------------------------------

write utils/format.ts <<'EOF'
import { pad } from "./pad";

export type Formatted = string;

export const format = (n: number): Formatted => `#${pad(n)}`;
EOF

write utils/pad.ts <<'EOF'
// Nothing on disk answers this specifier: unresolved, counted, no edge.
import "./nope";

export const pad = (n: number): number => n;
EOF

# --- module `legacy`: CommonJS JavaScript ----------------------------------

write legacy/loader.js <<'EOF'
const { pad } = require("../utils/pad");
// A Node builtin: external, like any other specifier that names no repo file.
const nodePath = require("node:path");
// Computed specifier: nothing to resolve, so it is not an unresolved import.
const name = process.env.PLUGIN;
const plugin = require(name);

module.exports = { pad, plugin, nodePath };
EOF

# --- a file that does not parse (AC-4) -------------------------------------

write broken.ts <<'EOF'
import { real } from "./utils/format";

export const broken = ( => {
  this is not typescript ][
EOF

# --- on disk but outside the scanned universe ------------------------------

write vendored/secret.ts <<'EOF'
export const hidden = 42;
EOF

# --- module `shared`, reachable only as a workspace package ----------------
# A pnpm/yarn workspace links an intra-repo package into node_modules. The
# specifier looks external and resolves through node_modules, but the real
# path is a file in this repo — and that is a real edge.

write shared/package.json <<'EOF'
{ "name": "@fixture/shared", "version": "0.0.0", "types": "util.ts" }
EOF

write shared/util.ts <<'EOF'
export const shared = (n: number): number => n;
EOF

mkdir -p "$REPO_DIR/node_modules/@fixture"
ln -s ../../shared "$REPO_DIR/node_modules/@fixture/shared"

# --- a minimal node_modules package so `react` resolves as external --------

write node_modules/react/package.json <<'EOF'
{ "name": "react", "version": "0.0.0-fixture", "main": "index.js" }
EOF

write node_modules/react/index.js <<'EOF'
module.exports = "react-fixture";
EOF

# --- AC-7: the same relative and index resolution, with no tsconfig.json ---

mkdir -p "$PLAIN_DIR/nested"

cat > "$PLAIN_DIR/entry.ts" <<'EOF'
import { helper } from "./helper";
import { nested } from "./nested";

export const entry = (): string => helper() + nested();
EOF

cat > "$PLAIN_DIR/helper.ts" <<'EOF'
export const helper = (): string => "helper";
EOF

cat > "$PLAIN_DIR/nested/index.ts" <<'EOF'
export const nested = (): string => "nested";
EOF

printf '%s\n' "$REPO_DIR"
