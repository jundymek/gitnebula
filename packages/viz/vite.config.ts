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

/**
 * ADR-0004 / AD-11: the production build is **one file**. `index.html` carries
 * its JS and CSS inline, uses the system font stack, and issues zero external
 * requests — the only thing it ever fetches is the sibling `analysis.json`
 * (AD-12).
 *
 * This is thirty lines rather than a plugin dependency on purpose. The whole
 * job is one `generateBundle` hook, and a bundle whose self-containment is
 * guaranteed by a third-party package is a worse trade than owning the hook.
 *
 * Inlining is done by string replacement on the emitted HTML rather than by
 * regenerating it, so whatever `index.html` declares — attributes, extra
 * markup, a second entry later — survives untouched.
 */
function singleFile(): Plugin {
  return {
    name: "gitnebula-single-file",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      let html: { fileName: string; source: string } | null = null;
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === "asset" && fileName.endsWith(".html")) {
          html = { fileName, source: String(output.source) };
        }
      }
      if (html === null) return;

      // AD-8: nothing in the hand-written HTML may point off-origin. Checked
      // before inlining, while the document is still small enough for the
      // question to have a clear answer.
      const remote = /(?:src|href)="(https?:)?\/\//.exec(html.source);
      if (remote !== null) {
        this.error(
          `single-file build: index.html requests ${remote[0]} — the bundle makes zero external requests (AD-8).`,
        );
      }

      let source = html.source;
      for (const [fileName, output] of Object.entries(bundle)) {
        if (fileName === html.fileName) continue;

        // Both replacements pass a *function*, never a string. A string
        // replacement re-reads `$&`, `` $` `` and `$'` out of the code being
        // inserted, and minified JS contains those sequences: the first build
        // of this plugin spliced a second copy of the page into the middle of
        // the bundle, because `$'` means "everything after the match". The
        // page still rendered, which is what makes it worth a comment.
        const replaced =
          output.type === "chunk"
            ? source.replace(
                new RegExp(
                  `<script[^>]*src="[^"]*${escapeForRegExp(fileName)}"[^>]*></script>`,
                ),
                // `</script>` inside the code would close the tag early. The
                // escape is inert everywhere it can legally appear.
                () =>
                  `<script type="module">\n${output.code.replace(/<\/script/gi, "<\\/script")}\n</script>`,
              )
            : fileName.endsWith(".css")
              ? source.replace(
                  new RegExp(
                    `<link[^>]*href="[^"]*${escapeForRegExp(fileName)}"[^>]*>`,
                  ),
                  () => `<style>\n${String(output.source)}\n</style>`,
                )
              : source;

        // An emitted file whose reference could not be found would be deleted
        // below and silently vanish from a bundle that still needs it — the
        // exact two-file failure AC-1 forbids, arriving as a blank page rather
        // than a build error. Anything not a chunk or a stylesheet lands here
        // too, which is intended: raise `assetsInlineLimit` or stop importing
        // it.
        if (replaced === source) {
          this.error(
            `single-file build: ${fileName} was emitted but could not be inlined into index.html — the bundle must be one file (ADR-0004).`,
          );
        }
        source = replaced;
        delete bundle[fileName];
      }

      (bundle[html.fileName] as { source: string }).source = source;
    },
  };
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default defineConfig({
  plugins: [analysisFixture(), singleFile()],
  build: {
    // Every asset becomes a data URI or an inline block; nothing is emitted
    // beside the HTML.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    // A preload polyfill would emit a second chunk to inline for no benefit:
    // there is nothing left to preload once everything is in the document.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // No `inlineDynamicImports`: the Viewer has no dynamic imports, and
        // if one appears the plugin above fails the build by name rather than
        // quietly folding it in.
        // Hashing names a file for cache-busting. There is no file.
        entryFileNames: "index.js",
        assetFileNames: "index[extname]",
      },
    },
  },
});
