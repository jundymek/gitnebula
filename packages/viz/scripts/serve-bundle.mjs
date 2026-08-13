// A static host for the built bundle, for the checks in `tests/`.
//
// It stands in for GitHub Pages: it serves the two files ADR-0004 specifies
// out of a directory, over HTTP, with no knowledge of gitnebula whatsoever.
// That ignorance is the point — anything the page needs beyond its own two
// files shows up here as a 404 in the network log the test reads.
//
// It is forty lines of `node:http` rather than a call into the cli's own
// server because AD-2 forbids `viz` depending on `cli`. Dev tooling; nothing
// here enters the bundle.
//
//   node serve-bundle.mjs <port> <viewer-dist> <analysis.json>
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve, sep } from "node:path";

const [port, viewerDist, analysis] = process.argv.slice(2);
if (!port || !viewerDist || !analysis) {
  process.stderr.write(
    "usage: node serve-bundle.mjs <port> <viewer-dist> <analysis.json>\n",
  );
  process.exit(2);
}

const dist = resolve(viewerDist);
const analysisPath = resolve(analysis);
for (const [what, path] of [
  ["the viewer", join(dist, "index.html")],
  ["the analysis document", analysisPath],
]) {
  if (!existsSync(path)) {
    process.stderr.write(`serve-bundle: ${what} is missing at ${path}\n`);
    process.exit(1);
  }
}

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer((request, response) => {
  const raw = (request.url ?? "/").split("?")[0];
  let path;
  try {
    path = decodeURIComponent(raw);
  } catch {
    response.writeHead(400).end("bad request");
    return;
  }

  const file =
    path === "/analysis.json"
      ? analysisPath
      : join(dist, path === "/" ? "index.html" : path.replace(/^\/+/, ""));

  // No fallback to index.html: a single-page rewrite would answer 200 to a
  // request for a script that is not there, and the whole check is whether
  // anything is requested at all.
  //
  // The separator in the prefix check is load-bearing: a bare
  // `startsWith(dist)` also accepts a sibling directory whose name merely
  // begins with the dist's, which `..` in a request path can reach.
  if (file !== analysisPath && !file.startsWith(dist + sep)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(file)) {
    response.writeHead(404).end("not found");
    return;
  }

  const extension = file.slice(file.lastIndexOf("."));
  response.writeHead(200, {
    "content-type": TYPES[extension] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}).listen(Number(port), "127.0.0.1", () => {
  process.stdout.write(`serve-bundle: http://127.0.0.1:${port}/\n`);
});
