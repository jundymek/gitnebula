# Manual testing — 4.3, the launch README

The deliverable is reviewed content, so the testing is: does the demo show the
real product, does the page render on GitHub, and does every link resolve.

**Environment note that shapes what could be checked here.** The repository is
private, and the browser available to this agent is not signed in to GitHub —
so `https://github.com/jundymek/gitnebula/tree/story/4.3-repo-quality` answers
404 to it. The render was therefore verified through GitHub's **own** markdown
renderer (`GET /repos/{owner}/{repo}/readme` with
`Accept: application/vnd.github.html`, on this branch), which is the same
pipeline that produces the page — but the last mile, seeing it painted in a
signed-in browser, is left to the maintainer below.

## Setup

```bash
pnpm install
pnpm build
node packages/cli/dist/gitnebula.js . --no-open   # prints its 127.0.0.1 URL
```

## Steps

- [x] **1. The demo shows the real product.** The GIF is a recording of
      gitnebula analyzing this repository, not a mockup.
      _Observed: recorded from this branch's build against this checkout — the
      run under it printed `295 nodes, 360 edges, 60 co-change pairs in 0.25s`,
      and the header in the GIF reads `286 files · 75.4k loc · 6 modules ·
      47 commits`._

- [x] **2. The scripted sequence is all there.** Launch → settle → hover →
      panel → zoom/unfold → file hover → search fly-to → heatmap → PNG export.
      _Observed frame by frame in the capture: the layout settles; `packages/`
      lights its chain on hover; its panel shows `194 files / 63,893 loc /
      churn 90d 48% / co-changes with docs/ 19`; 16 wheel steps unfold it into
      labelled files; a file hover dims everything off its chain; typing
      `pipeline` and taking the first result flies the camera and opens
      `pipeline.ts`; heatmap recolours the map by churn; `↓ png` runs and the
      viewer starts its download._

- [x] **3. The GIF actually animates.** A still image would satisfy nobody.
      _Observed: 197 frames, 720 × 405, 25/3 fps (`ffprobe -count_frames`), and
      GitHub's renderer tags it `data-animated-image=""` in the HTML it
      produces for this branch._

- [x] **4. The README renders on GitHub.** Headings, the image, the code
      blocks and the badge survive the markdown pipeline.
      _Observed in GitHub's rendered HTML for this branch: `<img
      src="docs/assets/demo.gif" alt="…" data-animated-image="">`, the badge
      `<img src="…/actions/workflows/ci.yml/badge.svg" alt="CI">`, and the six
      section anchors (`#quickstart`, `#the-map-of-gitnebula-itself`,
      `#what-it-gives-you`, `#contributing`, `#license`, `#gitnebula`)._

- [x] **5. Every relative link resolves on this branch.**
      _Observed via the contents API at `ref=story/4.3-repo-quality`:
      `CONTRIBUTING.md` (4,784 B), `LICENSE` (1,075 B),
      `docs/recording-demo.md` (3,748 B), `docs/assets/demo.gif`
      (3,909,199 B). No broken relative link._

- [x] **6. The CI badge points at a workflow that exists.**
      _Observed: the API lists `CI — .github/workflows/ci.yml — active`. The
      badge and workflow URLs answer 404 to an unauthenticated client purely
      because the repository is private; they resolve for anyone who can see
      the repo, and will resolve publicly at launch._

- [x] **7. The recorder is re-runnable.** `docs/recording-demo.md`'s recipe
      has to work for the next maintainer, not just once.
      _Observed: `scripts/record-demo.mjs` was run four times end to end during
      this story (three of them while its selectors were being corrected), each
      time producing a complete WebM from a freshly served map._

- [x] **8. Nothing broke.** `pnpm lint` and `pnpm -r test`.
      _Observed: lint clean; 67 test files, **874 tests passed**, 2 skipped._

- [ ] **9. Owner: read the rendered page in a signed-in browser.** Open
      `https://github.com/jundymek/gitnebula/tree/story/4.3-repo-quality`,
      watch the GIF play through at least one loop, and confirm it is legible
      at GitHub's content width.
      _Not runnable here: the repo is private and this agent's browser is not
      signed in — and signing it in is not something the agent may do. Step 3
      verifies the asset is animated and step 4 that GitHub emits it as one._

- [ ] **10. Owner: click every link on the rendered page.** `CONTRIBUTING.md`,
      `docs/recording-demo.md`, `LICENSE`, the demo image, the CI badge.
      _Step 5 verifies each target exists on this branch; this step is the
      human confirmation that the rendered page points where it should._

- [ ] **11. Owner: copy review (AC-5).** The pitch, the feature bullets and
      the quickstart are the maintainer's call — deliberately left unticked.

## Accessibility checks

- [x] The demo image has a descriptive `alt` that says what the animation
      shows, not "demo.gif". _Observed in the rendered HTML._
- [x] Headings are a single `h1` followed by `h2` sections — no level skipped.
- [x] Link text is meaningful out of context (`CONTRIBUTING.md`,
      `docs/recording-demo.md`, `MIT`), never "here" or "this link".
- [ ] Owner: confirm the demo is not the only carrier of any claim — a visitor
      who cannot see the animation should still learn everything from the prose
      bullets. Written that way deliberately; worth one human read.

## Outcome

Ran 8 of 11 steps. The three unrun ones all need the maintainer: two need a
signed-in browser on a private repository, and the third is the copy review
that AC-5 reserves for the owner. Everything verifiable without those — the
demo's content, the animation, GitHub's own render of the page, every link
target, the badge's workflow, and the full test suite — was executed and is
recorded above.
