# Manual testing — 3.2 serve and URL mode

**Executed 2026-08-13** by the story's agent on `story/3.2-cli-serve-url`
(base `epic/3-deps-python`). Machine: Apple M4 Pro, Darwin 25.5.0 arm64,
Node v22.20.0, git 2.x. Observed results are recorded under each check.

Every step below was run against the **built binary**, not the sources — the
point of several of them is process-level behaviour (real SIGINT, a real
network clone) that the vitest suite deliberately does not reach.

Prerequisites:

```sh
pnpm install
pnpm build                                # packages/{cli/dist/gitnebula.js,viz/dist}
sh ./test-fixtures/build-fixture-repo.sh  # AD-14 fixture repo
```

`<repo>` below is the worktree root. Run the binary as
`node <repo>/packages/cli/dist/gitnebula.js` — it is not on PATH until publish.

## 1. A zero-config run ends in a served map (AC-1)

```sh
mkdir -p /tmp/gitnebula-manual && cd /tmp/gitnebula-manual
node <repo>/packages/cli/dist/gitnebula.js \
  <repo>/test-fixtures/.generated/history-repo --no-open
```

- [x] The pipeline stages print as before, then a final line names the URL.
      → `serving http://127.0.0.1:4137/ — press Ctrl+C to stop`
- [x] The URL is on `127.0.0.1`, and the port is the documented default.
      → `4137`, first attempt, nothing else was listening.
- [x] `analysis.json` is written in the invocation directory.
      → 2,206 bytes, 6 nodes.

## 2. What the server answers (AC-2)

With the run from step 1 still up, in another shell:

```sh
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:4137/
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:4137/analysis.json
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:4137/assets/index-CoLFakSW.js
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4137/nope
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4137/assets/
curl -s -o /dev/null -w '%{http_code}\n' --path-as-is 'http://127.0.0.1:4137/../../../../etc/hosts'
```

- [x] `/` → 200, `text/html; charset=utf-8`.
- [x] `/analysis.json` → 200, `application/json; charset=utf-8`, 2,206 bytes —
      the same document step 1 wrote (AD-12).
- [x] a dist asset → 200, `text/javascript; charset=utf-8`.
- [x] an unknown path → 404.
- [x] a directory → 404, no listing.
- [x] a traversal out of the dist → 404.

## 3. The bind is loopback-only, not merely loopback-first (AC-1, AD-8)

```sh
IP=$(ipconfig getifaddr en0)          # 192.168.1.6 on this machine
curl -s -m 3 -o /dev/null -w '%{http_code}\n' http://$IP:4137/
```

- [x] The request to this machine's LAN address is refused (curl reports `000`,
      connection failure), while `127.0.0.1:4137` answers 200. A `0.0.0.0` bind
      would have answered both.

## 4. Ctrl+C shuts down cleanly (AC-3)

```sh
node <repo>/packages/cli/dist/gitnebula.js <fixture repo> --no-open & PID=$!
# wait for the "serving" line, then:
kill -INT $PID; wait $PID; echo "exit code: $?"
```

- [x] The process prints `stopped` and exits.
- [x] Exit code is **0**.
- [x] The process is gone (`ps -p` finds nothing) and the port is released
      (`lsof -ti tcp:4137` is empty) — so a second run reuses 4137 rather than
      stepping to 4138.

## 5. A real GitHub URL (AC-4)

```sh
mkdir -p /tmp/gitnebula-url && cd /tmp/gitnebula-url
node <repo>/packages/cli/dist/gitnebula.js \
  https://github.com/octocat/Hello-World.git --no-serve
```

- [x] The run starts with a `clone` stage, then proceeds identically to a local
      analysis.
- [x] `analysis.json` describes the remote repository:
      `repo.name = "Hello-World"`,
      `repo.remoteUrl = "https://github.com/octocat/Hello-World.git"`, 1 node.
- [x] No `gitnebula-clone-*` directory is left in `$TMPDIR` afterwards.
- [x] **The full-clone fallback was exercised for real here**: that repository's
      only commits are from 2011, so `--shallow-since=<90 days ago>` selects no
      commits and git refuses the shallow request. The run still succeeded,
      which is the fallback working.

## 6. A URL that cannot be cloned (AC-5)

```sh
node <repo>/packages/cli/dist/gitnebula.js \
  https://github.com/jundymek/definitely-not-a-real-repo-3x9.git
```

- [x] Output is exactly AD-7's shape:
      `clone: cannot clone https://github.com/jundymek/definitely-not-a-real-repo-3x9.git — check the URL or your network`
- [x] Exit code is **1**.
- [x] No `analysis.json` is written and no temp directory survives.

## 7. The map actually renders — human review

- [ ] Open the URL from step 1 in a real browser and confirm the nebula renders,
      settles, and responds to pan/zoom.
      **Not run: requires a human at a GUI browser.** The agent verified the
      bytes the browser would receive (step 2: `index.html`, the JS bundle and
      `analysis.json` all 200 with correct content types) but cannot judge what
      is painted. `--no-open` was used throughout so no browser was launched
      from the agent's session.
- [ ] Confirm `gitnebula` with no `--no-open` opens your default browser at the
      printed URL.
      **Not run for the same reason.** The launch itself is covered by
      `cli.test.ts` through an injected `openBrowser`, which asserts the exact
      URL handed to it; what is not covered is the real `open` package talking
      to a real desktop.

**Summary: 6 of 7 sections executed in full; section 7 (two checks) is left for
the maintainer** — it is the look-and-feel review that needs a GUI browser.
