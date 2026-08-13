// AC-1/AC-2/AC-3. The server is exercised over a real socket — the point of
// the story is what the network layer does, so a mocked http module would
// prove nothing about the bound address or the 404s.
import { EventEmitter } from "node:events";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StageError } from "./errors.js";
import {
  ANALYSIS_URL_PATH,
  DEFAULT_PORT,
  LOOPBACK_ADDRESS,
  awaitShutdown,
  contentTypeFor,
  missingDistError,
  resolveDistFile,
  resolveVizDist,
  startServer,
  type RunningServer,
} from "./serve.js";
import { makeTempDir, removeAll } from "./test-support.js";

const temps: string[] = [];
const servers: RunningServer[] = [];

afterEach(async () => {
  while (servers.length > 0) await (servers.pop() as RunningServer).close();
  removeAll(temps);
});

/**
 * A stand-in viz dist: index.html, an asset, and a nested directory. It sits
 * one level *inside* the registered temp dir so a traversal test can put a
 * file next to it and still have everything cleaned up.
 */
function makeDist(): string {
  const dist = join(makeTempDir(temps, "gitnebula-dist-"), "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>map</title>");
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets", "app.js"), "export const x = 1;\n");
  return dist;
}

/** An emitted analysis.json, outside the dist — where a real run puts it. */
function makeAnalysis(): string {
  const dir = makeTempDir(temps, "gitnebula-out-");
  const path = join(dir, "analysis.json");
  writeFileSync(path, '{"schemaVersion":"1.0.0"}\n');
  return path;
}

async function serve(port?: number): Promise<RunningServer> {
  const server = await startServer({
    distDir: makeDist(),
    analysisPath: makeAnalysis(),
    ...(port === undefined ? {} : { port }),
    attempts: 40,
  });
  servers.push(server);
  return server;
}

/** Binds a port so the scan has something to step over. */
function occupy(port: number): Promise<() => Promise<void>> {
  const blocker = createServer();
  return new Promise((settle, fail) => {
    blocker.once("error", fail);
    blocker.listen(port, LOOPBACK_ADDRESS, () => {
      settle(() => new Promise<void>((done) => blocker.close(() => done())));
    });
  });
}

describe("the server binds the loopback interface only (AC-1)", () => {
  it("listens on 127.0.0.1 and prints that URL", async () => {
    const server = await serve(45211);

    expect(server.address).toBe(LOOPBACK_ADDRESS);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
    expect(await (await fetch(server.url)).status).toBe(200);
  });

  it("never binds the wildcard address", async () => {
    const server = await serve(45212);

    // The interface the loopback binding excludes. A wildcard bind would
    // answer here; a loopback bind refuses the connection.
    const externalHost = localExternalAddress();
    if (externalHost === null) return;

    await expect(
      fetch(`http://${externalHost}:${server.port}/`),
    ).rejects.toThrow();
  });

  it("steps to the next free port when the default is taken", async () => {
    const release = await occupy(45220);
    try {
      const server = await serve(45220);
      expect(server.port).toBe(45221);
    } finally {
      await release();
    }
  });

  it("aborts in the AD-7 shape when the whole scan is taken", async () => {
    const release = await occupy(45230);
    try {
      const attempt = startServer({
        distDir: makeDist(),
        analysisPath: makeAnalysis(),
        port: 45230,
        attempts: 1,
      });
      await expect(attempt).rejects.toThrow(StageError);
      await expect(attempt).rejects.toThrow(/^serve: ports 45230–45230 .* — /);
    } finally {
      await release();
    }
  });

  it("defaults to a port that misses the common dev-server ones", () => {
    expect([3000, 4173, 5000, 5173, 7000, 8080]).not.toContain(DEFAULT_PORT);
  });
});

describe("what is served, and what is not (AC-2)", () => {
  it("serves index.html at the root with an HTML content type", async () => {
    const server = await serve(45240);
    const response = await fetch(server.url);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await response.text()).toContain("<title>map</title>");
  });

  it("serves the generated analysis.json at the sibling URL (AD-12)", async () => {
    const server = await serve(45241);
    const response = await fetch(
      `${server.url.slice(0, -1)}${ANALYSIS_URL_PATH}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await response.json()).toEqual({ schemaVersion: "1.0.0" });
  });

  it("serves nested dist assets with their own content type", async () => {
    const server = await serve(45242);
    const response = await fetch(`${server.url}assets/app.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
  });

  it("404s unknown paths, directories and traversal attempts", async () => {
    const server = await serve(45243);

    for (const path of [
      "nope.html",
      "assets", // a directory: there is no listing
      "assets/",
      "../../etc/hosts",
      "..%2f..%2fetc%2fhosts",
      "%2e%2e/%2e%2e/etc/hosts",
    ]) {
      const response = await fetch(`${server.url}${path}`, {
        redirect: "manual",
      });
      expect([response.status, path]).toEqual([404, path]);
    }
  });

  it("refuses methods other than GET and HEAD", async () => {
    const server = await serve(45244);
    const response = await fetch(server.url, { method: "POST" });

    expect(response.status).toBe(405);
  });
});

describe("path resolution never escapes the dist (AC-2)", () => {
  it("maps / to index.html and rejects everything outside the root", () => {
    const dist = makeDist();
    // A file that really exists just outside the dist. `/etc/passwd` is the
    // instinctive target and is useless here: from a deep temp directory the
    // `..` segments land nowhere, so the assertion would pass with no guard
    // at all. The escape has to point at something reachable.
    const secret = escapeTargetOutside(dist);

    expect(resolveDistFile(dist, "/")).toBe(join(dist, "index.html"));
    expect(resolveDistFile(dist, "/assets/app.js")).toBe(
      join(dist, "assets", "app.js"),
    );
    expect(resolveDistFile(dist, `/${secret.relative}`)).toBeNull();
    expect(
      resolveDistFile(dist, `/${encodeURIComponent(secret.relative)}`),
    ).toBeNull();
    expect(resolveDistFile(dist, secret.absolute)).toBeNull();
    expect(resolveDistFile(dist, "/assets")).toBeNull();
    expect(resolveDistFile(dist, "/index.html%00.txt")).toBeNull();
    expect(resolveDistFile(dist, "/%zz")).toBeNull();
  });

  it("404s a traversal request over the wire", async () => {
    const distDir = makeDist();
    const secret = escapeTargetOutside(distDir);
    const server = await startServer({
      distDir,
      analysisPath: makeAnalysis(),
      port: 45245,
      attempts: 40,
    });
    servers.push(server);

    // Encoded, so fetch does not normalise the `..` away before it is sent.
    const response = await fetch(
      `${server.url}${encodeURIComponent(secret.relative)}`,
    );
    expect(response.status).toBe(404);
  });

  it("falls back to a non-rendering content type for unknown extensions", () => {
    expect(contentTypeFor("a.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("a.WASM")).toBe("application/wasm");
  });
});

describe("Ctrl+C shuts the server down cleanly (AC-3)", () => {
  it("closes the socket on SIGINT, freeing the port", async () => {
    const port = 45250;
    const server = await serve(port);
    servers.pop(); // this test owns the close

    const signals = new EventEmitter();
    const stopped = awaitShutdown(signals);
    signals.emit("SIGINT");

    expect(await stopped).toBe("SIGINT");
    await server.close();

    // The proof the socket is really gone: the port binds again.
    const release = await occupy(port);
    await release();
  });

  it("detaches the sibling signal listener once one fires", async () => {
    const signals = new EventEmitter();
    const stopped = awaitShutdown(signals);
    signals.emit("SIGTERM");

    expect(await stopped).toBe("SIGTERM");
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("tolerates a second close", async () => {
    const server = await serve(45251);
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
  });
});

describe("a missing viewer build is an actionable abort (AC-2)", () => {
  it("names the viz build command in the AD-7 shape", async () => {
    const empty = makeTempDir(temps, "gitnebula-nodist-");

    const attempt = startServer({
      distDir: empty,
      analysisPath: makeAnalysis(),
      port: 45260,
    });
    await expect(attempt).rejects.toThrow(StageError);
    await expect(attempt).rejects.toThrow(
      /^serve: the viewer has not been built — run `pnpm --filter @gitnebula\/viz build`/,
    );
    expect(missingDistError().stage).toBe("serve");
  });

  it("returns null rather than guessing when no candidate dist exists", () => {
    const empty = makeTempDir(temps, "gitnebula-nowhere-");
    expect(
      resolveVizDist(new URL(`file://${empty}/src/serve.ts`).href),
    ).toBeNull();
  });
});

/**
 * Writes a file in the dist's parent directory and returns both ways of
 * naming it from inside the dist — the `..` relative path and the absolute
 * one. Both must be refused.
 */
function escapeTargetOutside(dist: string): {
  relative: string;
  absolute: string;
} {
  const absolute = join(dist, "..", "outside-the-dist.txt");
  writeFileSync(absolute, "must never be served\n");
  return { relative: "../outside-the-dist.txt", absolute };
}

/**
 * A non-loopback IPv4 address of this machine, or null when there is none
 * (an offline CI container). Used to prove the wildcard bind is absent.
 */
function localExternalAddress(): string | null {
  for (const entry of Object.values(networkInterfaces()).flat()) {
    if (entry !== undefined && entry.family === "IPv4" && !entry.internal) {
      return entry.address;
    }
  }
  return null;
}

describe("a symlink is not a way out of the dist (AC-2)", () => {
  it("refuses a link inside the dist that points outside it", () => {
    const dist = makeDist();
    const outside = escapeTargetOutside(dist);
    symlinkSync(outside.absolute, join(dist, "escape.txt"));

    expect(resolveDistFile(dist, "/escape.txt")).toBeNull();
    // The plain file next to it still resolves — the guard is about where the
    // link lands, not about links existing.
    expect(resolveDistFile(dist, "/index.html")).toBe(join(dist, "index.html"));
  });
});
