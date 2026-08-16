# Recording the README demo

`docs/assets/demo.gif` is the README's demo. It is a recording of the real
product — the map gitnebula draws of **this** repository — and it is expected to
be re-recorded whenever the viewer changes enough that the GIF stops being an
honest picture of it. Epic 5 was exactly such a change: the pre-Epic-5 take
opened by hovering a module so the rest of the map went dark, which is the
behaviour story 5.2 removed.

In-tool recording is a deliberate non-goal (brief §6). The recorder is external:
Playwright, which is already a `viz` devDependency for the performance harness.

## What was recorded

| | |
| --- | --- |
| Recorded from | `story/5.8-repo-docs-refresh` rebased onto the epic at `9a115f1` — after #72 (data blobs off the map), #73 (the new start-here ranking) and #74 (the 3D member layout) — gitnebula analysing a **fresh clone** of its own repository (406 nodes, 492 edges, 179 co-change pairs — the document this take was recorded from, which is **not** the later run the README transcript quotes) |
| Recorder | Playwright `recordVideo` (Chromium, headless), `scripts/record-demo.mjs` |
| Capture resolution | 1280 × 720, `deviceScaleFactor: 1`, `colorScheme: dark` |
| Raw length | 39 s of WebM |
| Published asset | 720 px wide, 8 fps, 64-colour palette, no dithering — 4.1 MiB |

The committed GIF is the ffmpeg encode of that WebM; the WebM itself is not
committed.

**Record against a clean clone, not against your working tree.** A working tree
carries build output, generated fixtures and whatever scratch files the current
branch happens to have, and every one of them becomes a node on the map. The
first take of this cut had `plan.md` and an `.intent-acks/` module in frame. The
recipe below clones the repository into a temp directory for exactly this
reason, which is also why the README's sample run reports 406 nodes where the
same command in a live worktree reports more.

## The scripted sequence

`scripts/record-demo.mjs` drives the served map with real pointer, keyboard and
click events, in this order. The order is the product's onboarding path, not a
tour of the feature list.

1. **Launch and settle** — wait for the engine's `settled` event, so the opening
   seconds are the force layout finding its shape (FR-12).
2. **The start-here panel** — the map's first state (5.1, UX-DR12): a reading
   order in three categories rather than an inventory of everything.
3. **Take the first entry** — the camera flies to that file and its detail panel
   opens on arrival, through story 3.3's existing `flyTo` + `select` path. The
   panel is held long enough to read the history rows and the window they
   carry (5.5).
4. **Blast radius** — still on that panel: the files this one keeps being
   committed with, then `show on map` to mark them on the canvas and off again
   (5.6). The entry taken in step 3 is what makes this beat possible — 86% of
   this repository's nodes have no co-change partners, so a randomly chosen
   node would record the empty state rather than the feature.
5. **Search for the module the tour drills into** — a beat in its own right,
   and the thing that makes the next step reliable: step 3 leaves the camera
   zoomed in on a ranked file, and a module that happens to be off-screen there
   cannot be found by a viewport scan. Arriving through search centres it.
6. **Drill down** — `dblclick` on `packages/` scopes the map to that module,
   its files and its direct neighbours (5.4). The module's own panel is closed
   straight away: this beat is about what the canvas carries.
7. **Hover a file in the scope** — the file with the widest one-hop chain, so
   the chain emphasis is actually visible. The rest of the map settles back
   rather than going dark (5.2).
8. **Connected only** — the files carrying no import edge leave the frame, and
   the chrome states how many went (UX-DR14). Toggled back off.
9. **`Escape`** — leaves the scope. The map returns exactly as it was, because
   scoping never re-ran the layout.
10. **Layer filter** — one layer switched off is *not drawn*, not dimmed (5.3),
   then switched back on and restored in place.
11. **3D** — the same graph with depth separating clusters that overlap in the
    plane (5.7), held long enough for the idle auto-rotation to read, then back
    to 2D. The tour returns to 2D deliberately: 3D is the alternative, not the
    product. Under `prefers-reduced-motion` there is no auto-rotation, so this
    beat is a still frame — a property of the view, not a fault in the recipe.
12. **Heatmap** — the same map coloured by churn.
13. **PNG export** — click `↓ png` and wait for the download the viewer starts.
14. **Back to structure** — end on the map the visitor first saw.

Node positions are resolved at runtime through the engine's public `pick()`,
never hardcoded: the layout is seeded per repository, so fixed coordinates would
point at empty space the moment the demo is re-recorded on another checkout.
The file hovered in step 7 is chosen the same way — by asking the engine which
on-screen file has the widest chain — because a file with two imports
demonstrates nothing.

## Re-recording

```bash
pnpm install
pnpm build

# A clean checkout to record, so no build output or scratch file is on the map.
# Clone THIS checkout, not the remote: the branch you are recording is the one
# whose viewer you just built, and cloning the remote's default branch fetches
# a tree that may not contain the UI the recorder drives — it would sit waiting
# for a #start-here panel that release does not have.
CLEAN=$(mktemp -d)/gitnebula
git clone --no-checkout . "$CLEAN"

# Check out the exact commit you are recording. `-B <name> <commit>` rather
# than `--branch $(git rev-parse --abbrev-ref HEAD)` because a detached HEAD —
# a CI checkout, or a tag — reports the literal string `HEAD`, which is not a
# branch anyone can clone.
git -C "$CLEAN" checkout -B master "$(git rev-parse HEAD)"

# `repo.defaultBranch` is read from the remote's advertised HEAD, not from the
# branch you checked out, and it is what the panel's "open on github" links are
# built from. A clone of a worktree inherits that worktree's branch, so without
# this line every link in the demo points at your story branch.
git -C "$CLEAN" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master

# Point the clone's origin back at the canonical remote. `repo.name` is the last
# segment of the remote URL, so a clone made from `.` would title the map after
# your worktree path — and it is the other half of the GitHub link. The content
# recorded is still the commit you are on.
git -C "$CLEAN" remote set-url origin https://github.com/jundymek/gitnebula

# terminal 1 — serve the map of that clean checkout
node packages/cli/dist/bin/gitnebula.js "$CLEAN" --no-open

# terminal 2 — record it (DEMO_URL must match the port printed above; the
# server takes the next free port when 4137 is busy).
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
and `DEMO_LAYER` (default `test`, the layer the filter beat switches off).

### The take is only as current as the code under it

This demo has been re-recorded three times, and twice because the map changed
under it rather than because the recording was faulty. The second re-record
followed PR #68; the third followed #72, #73 and #74, which between them
changed the start-here ranking, removed a 40,655-line generated fixture from
the map and fixed what the 3D view draws when a module is unfolded. A take made
before those is not wrong in its own terms — it is a faithful recording of a
product that no longer exists.

**So the check is not "does the recorder still run", it is "does the map in the
frames match the map the code now draws".** Pull the frames and read them
against a fresh `analysis.json`: the node and file counts in the header, the
names in the start-here list, and whether the 3D beat unfolds anything. All
three of those changed between takes, and none of them would have failed a
test.

### The figures move too, and they live in four places

The numbers quoted from a run — node, edge and co-change counts, the skipped
import count, the "no partner" and "no import edge" ratios — change with every
commit that adds or removes a file. They have been re-measured four times
during this epic, twice because someone else's merge moved them.

Take them from **one** run of a fresh clone and update **the five mutable rows
below** in the same pass, or they will disagree with each other. The sixth row
is pinned and is explained under the table — it is the one place where copying
the fresh figure in is the mistake:

| where | what it carries | on a refresh |
| --- | --- | --- |
| `README.md` quickstart | the pasted transcript, and the skipped-import count in the sentence below it | update |
| `README.md` blast-radius paragraph | the files-with-no-partner share, as a ratio rather than a count | update |
| `README.md` connected-only bullet | the files-with-no-import-edge share | update |
| `docs/recording-demo.md` clean-clone note | the node count a visitor's clone reports | update |
| `docs/dev/epic-5/5.8-repo-docs-refresh/` | the same figures, as the record of what was verified | update |
| `docs/recording-demo.md` "what was recorded" row | the counts of the document **the committed GIF was recorded from** | **pin — do not sync** |

**The last row is provenance, not a copy.** It describes an immutable artifact:
the GIF in the repository was recorded against one specific document, and that
document's counts do not change when someone later re-measures the repository.
Synchronising it makes the metadata describe a run the video does not show. It
changes only when the GIF is re-recorded, and then both change together. This
distinction was got wrong once here — the row was synced to a later run while the
asset stayed put — and Codex caught it; the difference between "figures about the
repository now" and "figures about what is in this file" is worth the extra
column.

**Mind the denominator.** The document carries modules as well as files, so a
count over `nodes` is not a count over `files` — this repository has 406 nodes
and 400 files, and a sentence about files that quotes the node total is wrong by
six even when the arithmetic is right. Measure over `kind === "file"` when the
sentence says "files".

**Exact counts belong in the transcript; prose wants a ratio.** A pasted
terminal block is understood to be one moment and can carry exact numbers. A
sentence in the body reads as a standing fact about the repository, and an exact
count there is stale the next time anyone commits — the co-change total moved
four times during this story alone, twice from merges of the very PRs updating
it. That is not bad luck, it is self-reference: co-change is computed from files
changed together, so **the commit that corrects the figure is itself a shared-
history event that moves it.** An exact count of co-change data can never be
correct in the commit that writes it down. "Around 85% of files have no co-change partner" survives that; "344 of 400"
does not, and re-measuring it is a treadmill rather than a fix. Keep the exact
figures where a reader can see they are a snapshot.

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
