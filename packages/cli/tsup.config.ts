import { defineConfig } from "tsup";

export default defineConfig({
  entry: { gitnebula: "src/gitnebula.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  // AD-11: the published bundle inlines all workspace packages — `gitnebula`
  // is the only artifact that ever reaches npm.
  noExternal: [/^@gitnebula\//],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
});
