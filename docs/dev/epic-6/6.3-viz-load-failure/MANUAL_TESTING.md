# Manual testing — 6.3-viz-load-failure

Every step below that can be executed headless **was executed** on this branch,
and the observed output is recorded inline. The step that cannot — a human
judging whether the screens read as helpful, AC-8 — is left unticked with the
reason stated. An unchecked box with a reason is honest; a checked box nobody
ran is a lie the reviewer builds on.

Ran **6 of 7**. The one that remains is AC-8, and it is the owner's to tick.

Run from the worktree root unless a step says otherwise.

---

## Setup

- [x] `pnpm install` — done; workspace resolves.
- [x] `pnpm --filter @gitnebula/viz build` — done; `packages/viz/dist/index.html`
      is the single-file bundle (253,938 bytes at the time of this run).

## 1. The `unreachable` screen, reached the way a reader reaches it

A missing fixture makes the dev server answer 404, which is the same shape as a
bundle deployed without its `analysis.json` sibling.

```bash
GITNEBULA_FIXTURE=no-such-fixture pnpm --filter @gitnebula/viz dev -- --port 4399 --strictPort
```

- [x] **The server refuses loudly rather than falling back to a default.**
      Observed on stdout:
      `gitnebula: serving …/packages/contract/fixtures/no-such-fixture.json at /analysis.json`
      then
      `gitnebula: fixture not found at …/no-such-fixture.json — set GITNEBULA_FIXTURE`.
      `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4399/analysis.json`
      → `HTTP 404`. (Story 1.4: a silent fallback produces a run that looks
      normal while measuring nothing.)

- [x] **Opening `http://localhost:4399/` shows the load-failure screen.**
      Observed in a real Chromium:
      - `role`: `alert`
      - title: **analysis.json could not be loaded**
      - detail: _The viewer looks for ./analysis.json next to itself, and the
        server answered 404._
      - one failed request, `http://localhost:4399/analysis.json` — expected
        here: the file genuinely is not there.

## 2. The `unsupported-version` screen

The built bundle, served by an ordinary static host beside a document from a
future gitnebula.

```bash
python3 - <<'PY'
import json
d = json.load(open("packages/contract/fixtures/root-files.json"))
d["schemaVersion"] = "2.0"
json.dump(d, open("/tmp/analysis.json", "w"))
PY
node packages/viz/scripts/serve-bundle.mjs 4398 packages/viz/dist /tmp/analysis.json
```

- [x] **Opening `http://127.0.0.1:4398/` names both versions.** Observed:
      - `role`: `alert`
      - title: **This analysis.json was written by a different gitnebula**
      - detail: _The document declares schemaVersion 2.0; this viewer
        understands major version 1. Re-run gitnebula to regenerate the file,
        or open it with a matching viewer._
      - version rows: `document schemaVersion 2.0` / `viewer supports major 1`
      - zero failed requests — the document was fetched and read, then refused.

## 3. The `file://` screen — the mistake a human actually makes

- [x] **Double-clicking the bundle explains itself.** Opened
      `file:///…/packages/viz/dist/index.html` in a real Chromium. Observed:
      - `role`: `alert`
      - title: **This page has to be served, not opened from disk**
      - detail: _gitnebula's map must be served over HTTP — a page opened from
        disk is not allowed to read the file next to it. From the folder
        holding index.html run `npx serve` (or `python3 -m http.server`) and
        open the address it prints._
      - **zero failed requests** — the page does not even try, so the console
        carries no browser security error contradicting the explanation.

## 4. The automated suites

- [x] `UI_PORT=4322 pnpm --filter @gitnebula/viz ui` → **25 passed**
      (11 new in `load-failure.pw.ts`, 11 new in `validator-seam.pw.ts`, 3
      pre-existing in `smoke.pw.ts`). `UI_PORT` is set because three agent
      worktrees share this machine and the config uses `--strictPort` on
      purpose; 4320 is the default and may be held by a peer.

---

## Human review — AC-8, for the owner

- [ ] **The three screens read as helpful to someone who has not read the
      code.** Each should name a cause and an exit: what went wrong, and what
      to do next. The exact rendered text of all three is quoted verbatim in
      steps 1–3 above, so this can be judged from this file without rebuilding
      anything — but the judgement itself is a human one and is deliberately
      **not** ticked here.

      Worth weighing while reading them:
      - the `unreachable` detail names the URL (`./analysis.json`) and the
        status, but not _where_ that URL is relative to — is "next to itself"
        clear to someone who has just unzipped a bundle?
      - the `unsupported-version` detail offers two exits (regenerate, or open
        with a matching viewer). Is the first obviously the one to take?
      - the `file://` hint is the longest of the three and the only one that
        hands over a command. Does its length help, or bury the command?

      Accessibility, checked mechanically and worth confirming by ear: all
      three carry `role="alert"`, so a screen reader announces the replacement
      of the page. Nothing on these screens is focusable, which is correct —
      there is no action to take in the page — but it does mean a keyboard user
      lands on a page with nothing to tab to.
