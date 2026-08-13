import { defineConfig } from "tsup";

export default defineConfig({
  entry: { gitnebula: "src/gitnebula.ts" },
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
  external: ["typescript"],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
});
