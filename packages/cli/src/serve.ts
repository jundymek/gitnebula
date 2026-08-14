// FR-5 / AD-8: the local viewer server. node:http, no framework (Stack), bound
// to the loopback interface and nothing else.
//
// It serves exactly two things: the viz dist, and the `analysis.json` this run
// produced, at the same-directory sibling URL the viewer fetches (AD-12). The
// generated file is *not* inside the dist — it is mapped onto that one URL, so
// nothing has to be copied next to the bundle for a plain `gitnebula` run.
//
// Everything a test needs to control arrives as an option: the port, the dist
// directory, the signal source. `startServer` resolves once the socket is
// listening and hands back a `close` that actually finishes — open keep-alive
// sockets are tracked and destroyed, or Ctrl+C would wait on a browser that is
// still holding a connection.
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Server, Socket } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { StageError } from "./errors.js";

/** The stage name this module aborts under (AD-7). */
export const SERVE_STAGE = "serve";

/**
 * The loopback address the server binds. Written once, here: AD-8 makes this
 * the whole point of the module, and a test asserts the bound address matches.
 */
export const LOOPBACK_ADDRESS = "127.0.0.1";

/**
 * First port tried. Chosen to miss the ports a developer most often has busy:
 * 3000, 4173/5173 (Vite preview/dev — `viz` uses those), 8080, and macOS's
 * reserved 5000/7000.
 */
export const DEFAULT_PORT = 4137;

/** How many consecutive ports the scan tries before giving up (FR-5). */
export const PORT_SCAN_ATTEMPTS = 20;

/** The one URL path the generated analysis is exposed at (AD-12). */
export const ANALYSIS_URL_PATH = "/analysis.json";

export interface ServeOptions {
  /** Directory of the built viewer. Must exist and contain `index.html`. */
  readonly distDir: string;
  /** Path of the `analysis.json` this run emitted. */
  readonly analysisPath: string;
  readonly port?: number;
  readonly attempts?: number;
}

export interface RunningServer {
  /** The address the socket is actually bound to — `127.0.0.1`, always. */
  readonly address: string;
  readonly port: number;
  /** What gets printed, and what the browser is pointed at. */
  readonly url: string;
  /** Closes the socket and destroys live connections. Safe to call twice. */
  close(): Promise<void>;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

/** Content type for a served file; unknown extensions download rather than render. */
export function contentTypeFor(path: string): string {
  return (
    CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}

/**
 * Resolves a request path to a file inside `distDir`, or null when it does not
 * name one.
 *
 * Null covers three cases deliberately: a path that escapes the dist (`..`,
 * an absolute path, an encoded separator), a directory (there is no listing),
 * and a file that is simply not there. All three are a 404 — the server never
 * falls through to a read outside the dist (AC-2).
 */
export function resolveDistFile(
  distDir: string,
  requestPath: string,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (relative.length === 0) return null;

  const root = resolve(distDir);
  const candidate = resolve(root, relative);
  if (!isInside(root, candidate)) return null;

  try {
    if (!statSync(candidate).isFile()) return null;
    // Re-checked after following symlinks: a link *inside* the dist pointing
    // out of it would otherwise pass the textual check and be served. Both
    // sides are resolved, or a dist reached through a symlinked path (macOS's
    // /tmp → /private/tmp) would fail against itself.
    return isInside(realpathSync(root), realpathSync(candidate))
      ? candidate
      : null;
  } catch {
    return null;
  }
}

/** True when `candidate` is `root` itself or lives under it. */
function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

/**
 * Locates the built viewer without importing from `@gitnebula/viz` — serving a
 * directory is not a package edge, and AD-2 forbids the edge that importing
 * would create.
 *
 * The copy the cli package's own build puts in `assets/` is the answer in both
 * layouts that matter — the installed package, and a workspace that has been
 * built (AD-11, and story 4.5's AC-6, which made `pnpm build` produce it). It
 * is tried first for that reason.
 *
 * The other two are the same fallback — the workspace's own `packages/viz/dist`
 * — reached from the two places this module can be running from, because the
 * bundle sits one directory deeper than the source does:
 *
 *     packages/cli/src/serve.ts        →  ../../viz/dist
 *     packages/cli/dist/bin/….js       →  ../../../viz/dist
 *
 * Only the first of those existed before story 4.5, so for the built binary
 * the fallback was dead: with `assets/` empty there was no second candidate at
 * all, and a dev checkout could not serve a map whatever the repository
 * contained. Populating `assets/` from the build is the real fix; this line
 * makes the fallback do what it always claimed to.
 *
 * @returns the directory, or null when no built viewer is reachable.
 */
export function resolveVizDist(moduleUrl: string): string | null {
  const here = resolve(fileURLToPath(new URL(".", moduleUrl)));
  const candidates = [
    // Bundled or installed: dist/bin/gitnebula.js → packages/cli/assets/viz.
    join(here, "..", "..", "assets", "viz"),
    // Source mode: packages/cli/src → packages/viz/dist.
    join(here, "..", "..", "viz", "dist"),
    // Bundled inside the workspace: dist/bin → packages/viz/dist.
    join(here, "..", "..", "..", "viz", "dist"),
  ];
  return candidates.find((dir) => existsSync(join(dir, "index.html"))) ?? null;
}

/**
 * The AD-7 abort for a run that reached serve with no viewer to serve.
 *
 * It used to say "the viewer has not been built" and send the reader to
 * `pnpm --filter @gitnebula/viz build`. In the one situation anybody ever hit
 * it, both halves were false: `packages/viz/dist/index.html` was sitting right
 * there, and running that command again changed nothing — what was missing was
 * the copy under `packages/cli/assets/`, which only `npm pack` produced. A
 * remedy that does not work is worse than no remedy, because the reader spends
 * their time proving it. So the cause names the directory that was searched,
 * and the remedy names the command that actually populates it.
 */
export function missingDistError(distDir?: string): StageError {
  const where = distDir === undefined ? "" : ` (looked in ${distDir})`;
  return new StageError(
    SERVE_STAGE,
    `no built viewer to serve${where}`,
    "in a checkout of the repository, run `pnpm build` from the workspace root and re-run gitnebula; from an installed copy this is a packaging bug, please report it — or pass --no-serve to stop after writing analysis.json",
  );
}

/**
 * Starts the viewer server on the loopback interface.
 *
 * @throws {StageError} stage `serve` when the dist is missing or the port scan
 * is exhausted.
 */
export async function startServer(
  options: ServeOptions,
): Promise<RunningServer> {
  if (!existsSync(join(options.distDir, "index.html")))
    throw missingDistError(options.distDir);

  const server = createServer((request, response) => {
    handle(request, response, options);
  });

  // Keep-alive connections would otherwise hold `close` open indefinitely.
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const firstPort = options.port ?? DEFAULT_PORT;
  const attempts = options.attempts ?? PORT_SCAN_ATTEMPTS;
  const port = await listenOnFreePort(server, firstPort, attempts);

  let closed = false;
  return {
    address: LOOPBACK_ADDRESS,
    port,
    url: `http://${LOOPBACK_ADDRESS}:${port}/`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((settle) => {
        server.close(() => settle());
        for (const socket of sockets) socket.destroy();
        sockets.clear();
      });
    },
  };
}

/**
 * Binds `server` to the first free port at or after `firstPort` (FR-5).
 *
 * @throws {StageError} when `attempts` consecutive ports are all taken.
 */
async function listenOnFreePort(
  server: Server,
  firstPort: number,
  attempts: number,
): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = firstPort + offset;
    const bound = await tryListen(server, port);
    if (bound) return port;
  }
  throw new StageError(
    SERVE_STAGE,
    `ports ${firstPort}–${firstPort + attempts - 1} are all in use`,
    "free one of them, or stop the other gitnebula instance and re-run",
  );
}

/** Resolves true when the port was bound, false when it was already taken. */
function tryListen(server: Server, port: number): Promise<boolean> {
  return new Promise((settle, fail) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener("listening", onListening);
      if (error.code === "EADDRINUSE") {
        settle(false);
        return;
      }
      fail(
        new StageError(
          SERVE_STAGE,
          `cannot listen on ${LOOPBACK_ADDRESS}:${port} — ${error.message}`,
          "check that nothing is blocking the loopback interface, then re-run",
          { underlying: error },
        ),
      );
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      settle(true);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    // AD-8: the host argument is the whole guarantee. Omitting it would bind
    // every interface, which is exactly what this project must never do.
    server.listen(port, LOOPBACK_ADDRESS);
  });
}

function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServeOptions,
): void {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    plain(response, 405, "method not allowed");
    return;
  }

  const requestPath = (request.url ?? "/").split("?")[0] ?? "/";

  if (requestPath === ANALYSIS_URL_PATH) {
    // The sibling URL (AD-12). The file lives wherever --out put it, so it is
    // mapped onto the URL rather than looked up under the dist.
    sendFile(response, options.analysisPath, method === "HEAD");
    return;
  }

  const file = resolveDistFile(options.distDir, requestPath);
  if (file === null) {
    plain(response, 404, "not found");
    return;
  }
  sendFile(response, file, method === "HEAD");
}

function sendFile(
  response: ServerResponse,
  path: string,
  headOnly: boolean,
): void {
  let size: number;
  try {
    const stats = statSync(path);
    if (!stats.isFile()) {
      plain(response, 404, "not found");
      return;
    }
    size = stats.size;
  } catch {
    plain(response, 404, "not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypeFor(path),
    "content-length": String(size),
    // Loopback, single-run, regenerated on every invocation: a cached
    // analysis.json from a previous run would be a stale map.
    "cache-control": "no-store",
  });
  if (headOnly) {
    response.end();
    return;
  }

  const stream = createReadStream(path);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

function plain(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
  });
  response.end(body);
}

/** The subset of `process` {@link installShutdown} needs, so tests can pass a fake. */
export interface SignalSource {
  once(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

/** Signals that mean "stop serving": Ctrl+C, and a polite kill. */
export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Resolves when the process is asked to stop.
 *
 * Returning a promise rather than calling `process.exit` is what makes the
 * clean shutdown testable and keeps the exit code in one place — `run` awaits
 * this, closes the server, and returns 0 (AC-3).
 */
export function awaitShutdown(source: SignalSource): Promise<string> {
  return new Promise((settle) => {
    const listeners: [string, () => void][] = [];
    for (const signal of SHUTDOWN_SIGNALS) {
      const listener = (): void => {
        // Leaving the sibling listener attached would keep a handle on the
        // process after the server is gone.
        for (const [other, fn] of listeners) {
          if (other !== signal) source.removeListener(other, fn);
        }
        settle(signal);
      };
      listeners.push([signal, listener]);
      source.once(signal, listener);
    }
  });
}
