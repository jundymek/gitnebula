# 3.2 — Serve and URL mode

`gitnebula` now ends where the product promises it ends: with the map open in a
browser. And a repository you do not have locally is one argument away.

```sh
gitnebula                                   # analyze ., serve the map, open a browser
gitnebula --no-open                         # serve, but do not launch a browser (CI)
gitnebula --no-serve                        # write analysis.json and exit
gitnebula https://github.com/owner/repo     # shallow-clone into a temp dir, then the same
```

## The server (FR-5, AD-8)

`node:http`, no framework. Three properties are the story:

**It binds `127.0.0.1` and only that.** The host argument is passed on every
`listen`, and `0.0.0.0` appears nowhere in the code path. `serve.test.ts`
asserts the bound address and, on a machine that has a non-loopback IPv4
address, that a request to that address is refused.

**It serves two things.** The viz dist, and this run's `analysis.json` at
`/analysis.json` — the same-directory sibling URL the viewer fetches in every
mode (AD-12). The generated file is *mapped onto* that URL rather than copied
next to the bundle: `--out` may have put it anywhere, and copying a 5 MB
document to serve it once would be silly.

Everything else is a 404: unknown paths, directories (there is no listing), and
anything whose resolved path is not inside the dist. `resolveDistFile` resolves
the request against the dist root and rejects the result unless it is still
under that root, so `..`, an encoded `..`, an absolute path and a NUL byte all
land in the same place. Methods other than GET and HEAD get a 405.

**Ports.** The scan starts at **4137** and walks up 20 ports. 4137 is chosen to
miss what a developer usually has busy: 3000, 4173 and 5173 (Vite preview and
dev — `viz` itself uses those), 8080, and macOS's reserved 5000/7000. An
exhausted scan aborts in AD-7's shape rather than looping.

**Shutdown.** SIGINT/SIGTERM resolve `awaitShutdown`, `run` closes the socket
and returns 0. Live keep-alive sockets are tracked and destroyed on close —
without that, a browser holding a connection keeps Ctrl+C waiting.

## Where the viewer comes from

`resolveVizDist` checks two candidates and imports nothing from
`@gitnebula/viz`: serving a directory is not a package edge, and AD-2 forbids
the edge an import would create.

1. `<bundle dir>/assets/viz` — where cli's prepack copies it (AD-11).
2. `packages/viz/dist` — the workspace build, for a source-mode run.

Neither present means the viewer has not been built, which is an abort in AD-7's
shape naming `pnpm --filter @gitnebula/viz build`. The analysis is already on
disk at that point; only the serving tail failed.

## URL mode (FR-2, AD-8)

`git clone` here is the **only** network operation in the entire system.
Everything after it reads the temp checkout and is byte-identically the local
path.

```
git clone --quiet --shallow-since=<window start> --no-single-branch -- <url> <temp>/repo
```

- **Fallback.** Any failure of the shallow attempt retries as a plain
  `git clone`. FR-2 words it as "if the server refuses", but distinguishing a
  refusal from an unreachable host means parsing git's stderr, which is not a
  contract and is locale-dependent. If the full clone fails too, the abort
  quotes the *shallow* attempt's error as the underlying cause — that is the
  error the user's URL actually produced. A real GitHub repository whose only
  commit predates the window exercises this path for real: git rejects a
  shallow request that selects no commits, and the full clone carries the run.
- **The window comes from the flags, not from `.gitnebula.yml`.** The config
  file lives inside a repository we do not have yet, so `--shallow-since` uses
  `--window-days` if given and `DEFAULT_WINDOW_DAYS` (90) otherwise. A file that
  later widens the window analyses whatever the clone fetched; the full-clone
  fallback covers the case where that matters.
- **The temp directory is owned by `dispose`**, which `run` calls in a
  `finally`. Success, a pipeline failure and a clone failure all clean up; the
  clone failure removes the directory *before* throwing.
- `GIT_TERMINAL_PROMPT=0` and `ssh -oBatchMode=yes`: a credential prompt would
  hang the run forever, and an actionable failure beats a silent stall.

A target is a URL when it looks like one **and** no such path exists locally.
Existence wins — `example.com/checkout` is a perfectly good directory name.

## Why `--no-serve` exists

The spec names `--no-open`. But `--no-open` suppresses the browser, not the
server, and serving blocks until a signal — so with serving as the default tail
there would be no way to run the analysis non-interactively at all. `--no-serve`
is that way, and it is what the package's own tests use. See `DECISIONS.md` §1.

## Files

| file | | why |
| --- | --- | --- |
| `packages/cli/src/serve.ts` | NEW | the loopback server, port scan, dist resolution, shutdown |
| `packages/cli/src/serve.test.ts` | NEW | AC-1/2/3 over a real socket |
| `packages/cli/src/clone.ts` | NEW | URL detection, shallow clone + fallback, temp lifecycle |
| `packages/cli/src/clone.test.ts` | NEW | AC-4/5 against a `file://` origin and a closed port |
| `packages/cli/src/browser.ts` | NEW | the `open` call, isolated so tests inject a fake |
| `packages/cli/src/cli.ts` | UPDATE | `--no-serve`/`--no-open`, the clone branch, the serving tail |
| `packages/cli/src/cli.test.ts` | UPDATE | end-to-end serve and URL cases; existing cases say `--no-serve` |
| `packages/cli/src/index.ts` | UPDATE | exports the new surface |
| `packages/cli/package.json` | UPDATE | `open` dependency |

## Asserting that the temp checkout is gone

Every cleanup assertion is scoped to a directory the test itself handed the
clone, via `CloneOptions.tempDir` (and `RunOptions.cloneTempDir` one layer up).

That seam exists because the obvious alternative is a race. Listing
`gitnebula-clone-*` in the shared system temp directory — snapshot before,
compare after — made this suite fail roughly a third of the time: vitest runs
the package's suites in parallel workers, and a neighbour creating or disposing
its own checkout between the two observations moves the listing for reasons that
have nothing to do with the code under test. The failure that surfaced was not
even a leak; it was a directory in the `before` snapshot that someone else
cleaned up first.

## Testing

```sh
pnpm --filter @gitnebula/cli test    # 114 tests
pnpm lint && pnpm build
```

The signal test drives an injected emitter rather than a spawned process:
vitest runs the TypeScript sources directly (AD-11 — no build step for the
analysis packages), so there is no artifact to signal without adding a bundler
to the test path. The real thing — `kill -INT` against
`packages/cli/dist/gitnebula.js` — is step 4 of `MANUAL_TESTING.md`, and it was
run.
