import { writeFileSync } from "node:fs";
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

export default defineConfig({
  plugins: [resultsSink()],
});
