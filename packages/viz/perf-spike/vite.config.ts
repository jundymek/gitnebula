import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev-only sink for the spike's results. The page POSTs its results JSON here
 * so a scripted run can be read back without hand-copying numbers out of the
 * console. Spike tooling only — it lives under perf-spike/, never ships, and
 * only ever binds to the local dev server.
 */
function resultsSink(): Plugin {
  return {
    name: "perf-spike-results-sink",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/spike-results", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const out = resolve(import.meta.dirname, "results.json");
          writeFileSync(out, body);
          server.config.logger.info(`perf-spike: results written to ${out}`);
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

/**
 * Serves story 1.3's committed synthetic document at `/fixture.json`.
 *
 * The fixture lives in the contract package, not under the spike's Vite root,
 * so without this the page's `fetch("./fixture.json")` 404s and the loader
 * silently drops to its seeded generator — the run would then look normal
 * while measuring something that is not the story's yardstick. Reading it
 * through the dev server (rather than importing the JSON) keeps the ~950 KB
 * document out of the bundle and keeps `viz` free of a build-time dependency
 * on the contract package's internals.
 */
function contractFixture(): Plugin {
  const fixture = resolve(
    import.meta.dirname,
    "../../contract/fixtures/synthetic-100x2000.json",
  );
  return {
    name: "perf-spike-contract-fixture",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/fixture.json", (_req, res) => {
        if (!existsSync(fixture)) {
          // Loud, not silent: a missing yardstick must not read as a 404 the
          // loader can shrug off into a fallback run.
          server.config.logger.error(
            `perf-spike: contract fixture not found at ${fixture}`,
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

export default defineConfig({
  plugins: [resultsSink(), contractFixture()],
});
