# Manual testing — 2.5 GraphEngine core

The story's automated suite covers settle timing, seeding, the version gate,
the encoding constants, the camera maths and the AD-5 boundary. What it cannot
cover is whether the thing looks like `reference/mockup.html`. These steps are
left **unticked for the owner**.

Two windows side by side: the dev server, and `reference/mockup.html` opened
directly in the browser.

```bash
pnpm install
pnpm --filter @gitnebula/viz dev     # http://localhost:5173
open reference/mockup.html
```

## Setup

- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0 (148 tests in `@gitnebula/viz`)
- [ ] `pnpm --filter @gitnebula/viz build` exits 0

## First load (AC-1, AC-2)

- [ ] The map appears immediately and **visibly settles** — nodes drift apart
      and come to rest, they do not pop into place
- [ ] Settling takes roughly two and a half seconds, not "instantly" and not
      "still moving after five"
- [ ] Once still, the camera glides once to frame the whole graph, and the
      whole graph is on screen afterwards — nothing cut off at an edge
- [ ] Reload the page. The map settles into **the same arrangement**; compare
      two screenshots if unsure
- [ ] `↻ replay` re-runs the animation and lands in the same arrangement again
- [ ] `↻ replay` is greyed out while settling and clickable once settled

## Against the mockup (AC-3, AC-4)

Compare side by side. The mockup has 9 modules and gitnebula's fixture has 100,
so compare *character*, not layout.

- [ ] Background is the same near-black; the starfield is present but faint —
      you should have to look for it
- [ ] Nodes glow rather than sit as flat discs, and busier nodes glow wider
- [ ] Bigger modules are bigger nodes
- [ ] Edges are **curved** and translucent, not straight lines
- [ ] Module labels sit above their nodes in the same mono type
- [ ] Header reads: brand, repo name, then files / loc / modules / commits /
      language shares, in that order
- [ ] Legend bottom-left: backend, frontend, infra, test, hot spot — the same
      five colours as the mockup's
- [ ] Hint overlay bottom-right, three lines, mentioning 1.8×

**Expect an all-orange map on the default fixture.** Every module in
`synthetic-100x2000.json` has churn above the 0.5 hot threshold, so structure
mode paints all of them `--hot`. That is correct behaviour on that data. To see
the layer palette:

```bash
GITNEBULA_FIXTURE=cyclic-imports pnpm --filter @gitnebula/viz dev
```

- [ ] On a cold fixture, modules take their layer colours (teal / purple /
      grey / lime) and none are orange

## Hot spots (AC-3)

- [ ] On the default fixture the hot nodes **pulse** — a slow breathing glow,
      roughly three times a second, not a flicker
- [ ] The pulse is a glow change, not a size jump

## Pan and zoom (AC-5)

- [ ] Cursor over the canvas is a hand (`grab`); it closes (`grabbing`) while
      dragging
- [ ] Drag moves the map with the pointer, one-to-one
- [ ] Scroll up zooms in **toward the cursor** — put the pointer on a specific
      node and zoom; that node stays under the pointer
- [ ] Scroll down zooms out the same way
- [ ] Keep scrolling in: the zoom stops. Keep scrolling out: it stops. Neither
      limit makes the map slide sideways
- [ ] Resize the window: the map stays centred on the same point at the same
      zoom, and stays sharp (no blurring on a Retina display). It does **not**
      re-fit — that would throw away a camera you had positioned yourself, and
      the mockup does not re-fit either

## Version refusal (AC-1, FR-6)

```bash
python3 -c "import json;d=json.load(open('packages/contract/fixtures/single-module.json'));d['schemaVersion']='99.0';json.dump(d,open('/tmp/bad.json','w'))"
GITNEBULA_FIXTURE=/tmp/bad.json pnpm --filter @gitnebula/viz dev
```

- [ ] A plain error screen replaces the map
- [ ] It names **both** versions: the document's `99.0` and the viewer's `1`
- [ ] It says what to do about it
- [ ] Stop the server and reload: the screen says the file could not be loaded,
      rather than showing an empty map

## Reduced motion (AC-2, UX-DR11)

macOS: System Settings → Accessibility → Display → Reduce motion. Or in Chrome
DevTools: Rendering panel → "Emulate CSS media feature prefers-reduced-motion".

- [ ] With reduced motion on, reload: the map is **already settled and framed**
      on the first frame — no drift, no camera glide
- [ ] Hot nodes do not pulse
- [ ] The arrangement is the same one the animated path produces

## Accessibility

- [ ] Tab reaches the replay button and it shows a visible focus ring
- [ ] Enter/Space activates it
- [ ] The error screen is announced by a screen reader (it carries
      `role="alert"`)

## Console

- [ ] No errors or warnings in the console after load, settle, pan and zoom
