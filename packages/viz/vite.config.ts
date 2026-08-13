import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, type Plugin } from "vite";

/**
 * AD-12: the Viewer fetches `./analysis.json` — a same-directory sibling URL —
 * in every mode. In dev there is no pipeline to produce one, so this plugin
 * serves a **committed contract fixture** at exactly that URL.
 *
 * Pick the fixture with `GITNEBULA_FIXTURE`:
 *
 *     pnpm --filter @gitnebula/viz dev
 *     GITNEBULA_FIXTURE=zero-history pnpm --filter @gitnebula/viz dev
 *     GITNEBULA_FIXTURE=/abs/path/to/analysis.json pnpm --filter @gitnebula/viz dev
 *
 * A bare name resolves against `packages/contract/fixtures/`; a path with a
 * separator is used as given, which is how you point the dev server at a file
 * the cli just produced.
 *
 * The fixture is read through the dev server rather than imported, so the
 * ~950 KB synthetic document never enters the bundle and `viz` gains no
 * build-time reach into the contract package's internals (AD-2).
 *
 * A missing fixture answers 404 **loudly**: story 1.4 learned that a silent
 * fallback produces a run that looks normal while measuring nothing.
 */
const DEFAULT_FIXTURE = "synthetic-100x2000";

function resolveFixture(): string {
  const requested = process.env.GITNEBULA_FIXTURE ?? DEFAULT_FIXTURE;
  if (requested.includes("/") || requested.endsWith(".json")) {
    return resolve(process.cwd(), requested);
  }
  return resolve(
    import.meta.dirname,
    "..",
    "contract",
    "fixtures",
    `${requested}.json`,
  );
}

function analysisFixture(): Plugin {
  const fixture = resolveFixture();
  return {
    name: "gitnebula-analysis-fixture",
    apply: "serve",
    configureServer(server) {
      server.config.logger.info(
        `gitnebula: serving ${fixture} at /analysis.json`,
      );
      server.middlewares.use("/analysis.json", (_req, res) => {
        if (!existsSync(fixture)) {
          server.config.logger.error(
            `gitnebula: fixture not found at ${fixture} — set GITNEBULA_FIXTURE`,
          );
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(readFileSync(fixture));
      });
    },
  };
}

// Story 4.1 turns the build into the single self-contained index.html (AD-11).
export default defineConfig({
  plugins: [analysisFixture()],
});
