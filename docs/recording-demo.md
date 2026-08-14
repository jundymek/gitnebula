# Recording the README demo

`docs/assets/demo.gif` is the README's 30-second demo. It is a recording of the
real product — the map gitnebula draws of **this** repository — and it is
expected to be re-recorded whenever the viewer changes enough that the GIF stops
being an honest picture of it.

In-tool recording is a deliberate non-goal (brief §6). The recorder is external:
Playwright, which is already a `viz` devDependency for the performance harness.

## What was recorded

| | |
| --- | --- |
| Recorded from | `story/4.3-repo-quality`, gitnebula analyzing its own checkout (295 nodes, 360 edges, 60 co-change pairs) |
| Recorder | Playwright `recordVideo` (Chromium, headless), `scripts/record-demo.mjs` |
| Capture resolution | 1280 × 720, `deviceScaleFactor: 1`, `colorScheme: dark` |
| Raw length | ~25 s of WebM |
| Published asset | 720 px wide, 8 fps, 64-colour palette, no dithering — 3.7 MiB |

The committed GIF is the ffmpeg encode of that WebM; the WebM itself is not
committed.

## The scripted sequence

`scripts/record-demo.mjs` drives the served map with real pointer, wheel and
keyboard events, in this order:

1. **Launch and settle** — wait for the engine's `settled` event, so the
   opening seconds are the force layout finding its shape (FR-12).
2. **Hover a module** (`packages/`) — the dependency chain lights up and
   everything else dims.
3. **Click it** — the panel shows files, LOC, 90-day churn, authors, last
   change and the top co-changing modules; then close the panel.
4. **Zoom past `UNFOLD_ZOOM`** — 16 wheel steps at the module, which opens it
   into its files with labels.
5. **Hover a file** — the file with the widest one-hop chain in that module, so
   its imports are visible against the dimmed rest.
6. **Search** — click the box, type `pipeline`, take the first result; the
   camera flies to it and the panel opens on arrival.
7. **Heatmap** — switch view mode, hold on the churn colouring.
8. **PNG export** — click `↓ png` and wait for the download the viewer starts.
9. **Back to structure** — end on the map the visitor first saw.

Node positions are resolved at runtime through the engine's public `pick()`,
never hardcoded: the layout is seeded per repository, so fixed coordinates would
point at empty space the moment the demo is re-recorded on another checkout.

## Re-recording

```bash
pnpm install
pnpm build

# terminal 1 — serve the real map of this repository
node packages/cli/dist/bin/gitnebula.js . --no-open

# terminal 2 — record it (DEMO_URL must match the port printed above).
# The script prints the path of the WebM it wrote: DEMO_OUT/demo.webm, one
# fixed name, so re-recording into the same directory replaces the take
# instead of leaving a second file behind for the glob below to trip on.
DEMO_URL=http://127.0.0.1:4137/ DEMO_OUT=/tmp/gitnebula-demo \
  node scripts/record-demo.mjs

# encode the committed asset
ffmpeg -y -i /tmp/gitnebula-demo/demo.webm \
  -filter_complex "fps=8,scale=720:-1:flags=lanczos,split[a][b];\
[a]palettegen=max_colors=64:stats_mode=diff[p];\
[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  docs/assets/demo.gif
```

Overridable inputs: `DEMO_URL`, `DEMO_OUT`, `DEMO_MODULE` (default `packages/`)
and `DEMO_QUERY` (default `pipeline`).

### Keeping the asset small

A dark canvas full of moving points is the worst case for GIF: dithering adds
per-frame noise that defeats the format's compression. The encode above trades
smooth gradients for size — `dither=none` with 64 colours costs some banding in
the glow around nodes and saves several megabytes. If you raise the frame rate,
the width or the colour count, check the file size before committing: the whole
README should stay comfortably loadable, and past ~5 MB the GIF becomes the
slowest thing on the page.

If a future version needs a longer or higher-fidelity demo, publish a video
elsewhere and keep a short GIF in the README — do not commit a 20 MB asset.
