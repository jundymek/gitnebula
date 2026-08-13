import { defineConfig } from "tsup";

export default defineConfig({
  // `dist/bin/gitnebula.js`, and the depth is load-bearing. `@gitnebula/deps`
  // resolves its grammar as `new URL("../../assets/tree-sitter-python.wasm",
  // import.meta.url)` — two directories up from `src/python/parser.ts`. AD-11
  // requires that same expression to work once the package is inlined, so the
  // module doing the resolving has to sit two directories below the package
  // root here too. Emitted at `dist/gitnebula.js` it resolves to
  // `packages/assets/…`, outside the package, where no prepack copy can ever
  // put it — and the binary dies on the first Python file it meets.
  entry: { "bin/gitnebula": "src/gitnebula.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  // AD-11: the published bundle inlines all workspace packages — `gitnebula`
  // is the only artifact that ever reaches npm.
  noExternal: [/^@gitnebula\//],
  // The TypeScript compiler API that `deps` uses for module resolution
  // (ADR-0001) stays out of the bundle. It is CommonJS, it calls `require`
  // and reads `__filename` at load time, and inlining it into an ESM bundle
  // makes the binary die on its first import — first with
  // `Dynamic require of "fs" is not supported`, then, once a `require` is
  // shimmed in, with `ERR_AMBIGUOUS_MODULE_SYNTAX`. It is also 9.5 MB of the
  // 9.9 MB bundle. Left external it is a plain runtime dependency that Node
  // loads as the CommonJS it is, and the bundle stays small.
  //
  // `web-tree-sitter` is external for the same class of reason, found the same
  // way — by running the built binary (story 4.1, AC-4). Its emscripten glue
  // loads `web-tree-sitter.wasm` from beside the module that imports it, so
  // inlining relocates the lookup to `dist/`, where the runtime `.wasm` is
  // not, and every repository containing Python aborts with
  // `ENOENT ... web-tree-sitter.wasm`. Left external it resolves out of
  // node_modules exactly as it does in source mode.
  external: ["typescript", "web-tree-sitter"],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
});
