// Assemble `packages/cli/assets/` out of artefacts the two build edges have
// already produced (AD-11).
//
// It deliberately does **not** build anything. 4.1's AC-5 keeps `pnpm build`
// as the only build entry, and a step that quietly rebuilt would be a second
// one — with its own idea of which sources are current. So it copies, and it
// aborts by name when an input is missing.
//
// Two callers, both of which need exactly this (story 4.5, AC-6):
//
//   cli's `build`    — after tsup, so a plain `pnpm build` leaves a binary
//                      that runs. Until 4.5 only the caller below existed,
//                      npm runs it only on `pack`/`publish`, and so every
//                      development checkout had an empty `assets/`: serving
//                      aborted whatever the repository contained, and the
//                      first Python file died on ENOENT. The published
//                      tarball was never affected, which is why nothing
//                      caught it for three stories.
//   cli's `prepack`  — unchanged, and kept rather than trusted to the build:
//                      `npm pack` on a tree nobody built must fail by name
//                      instead of shipping an empty `assets/`.
//
// This is why the workspace `build` runs viz **before** cli: the first caller
// needs `packages/viz/dist` to already exist.
//
// What lands in `packages/cli/assets/`, and why there:
//
//   assets/tree-sitter-python.wasm   @gitnebula/deps resolves the grammar as
//                                    `../../assets/…` from its own module.
//                                    Inlined into `dist/bin/gitnebula.js`,
//                                    that is exactly this path — which is why
//                                    the bundle sits two directories deep.
//   assets/viz/index.html            the self-contained Viewer (ADR-0004),
//                                    found by `resolveVizDist` in serve.ts.
//
// Both are regenerated artefacts, so both are gitignored: the tarball is the
// only place they persist beyond the build that produced them.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, "..");
const workspaceRoot = join(cliRoot, "..", "..");

const assets = join(cliRoot, "assets");

/** Each input, the file that proves it exists, and how to produce it. */
const inputs = [
  {
    what: "the built Viewer",
    from: join(workspaceRoot, "packages", "viz", "dist"),
    proof: join(workspaceRoot, "packages", "viz", "dist", "index.html"),
    to: join(assets, "viz"),
    remedy: "run `pnpm build` first",
  },
  {
    what: "the Python grammar",
    from: join(
      workspaceRoot,
      "packages",
      "deps",
      "assets",
      "tree-sitter-python.wasm",
    ),
    proof: join(
      workspaceRoot,
      "packages",
      "deps",
      "assets",
      "tree-sitter-python.wasm",
    ),
    to: join(assets, "tree-sitter-python.wasm"),
    remedy: "run `sh scripts/build-grammar.sh` from the workspace root",
  },
  {
    what: "the licence",
    from: join(workspaceRoot, "LICENSE"),
    proof: join(workspaceRoot, "LICENSE"),
    to: join(cliRoot, "LICENSE"),
    remedy: "restore LICENSE at the workspace root",
  },
  {
    what: "the cli bundle",
    from: null,
    proof: join(cliRoot, "dist", "bin", "gitnebula.js"),
    to: null,
    remedy: "run `pnpm build` first",
  },
];

const missing = inputs.filter((input) => !existsSync(input.proof));
if (missing.length > 0) {
  for (const input of missing) {
    process.stderr.write(
      `assets: ${input.what} is missing at ${input.proof} — ${input.remedy}\n`,
    );
  }
  process.exit(1);
}

// Rebuilt from scratch: a stale file left behind by an earlier layout would
// ship in the tarball and be found by resolution before the current one.
rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

for (const input of inputs) {
  if (input.from === null || input.to === null) continue;
  cpSync(input.from, input.to, { recursive: true });
  process.stdout.write(`assets: ${input.to.slice(cliRoot.length + 1)}\n`);
}
