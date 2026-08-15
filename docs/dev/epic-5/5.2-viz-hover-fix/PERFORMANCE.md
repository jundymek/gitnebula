# 5.2 — Performance record

This story changes what the renderer draws on every hovered frame: file labels
that used to disappear under a hover now stay, and chain nodes gain a ring and
a larger glow. Render frame rate is a stated property of this project (FR-14 /
SM-2: ≥ 55 fps sustained on the 2,000-node fixture), so the change is measured
rather than argued about.

Two measurements: the draw-call delta the change actually causes, and the
repo's own fps yardstick before and after.

**Machine**: Apple M4 Pro, macOS 26.5.2 (Darwin 25.5.0), Node 22, Chromium
151.0.7922.34 headless, `devicePixelRatio` 1, canvas 1440 × 797 CSS px.

## 1. Draw calls per frame under a hover

**Method.** The 2,100-node synthetic fixture (`synthetic-100x2000.json`, story
1.3 — the same document FR-14 is measured on), settled, camera flown to a
module at **3.2× zoom** (above `FILE_LABEL_ZOOM` = 3.0, so file labels are
live), 740 nodes in the scene, chain size 25. One frame rendered into the
recording context of `test-support/fake-canvas.ts` and its operations counted.
`chainMode` is forced to `"isolate"` to reproduce the pre-story encoding
against the identical scene, which is what makes the two rows comparable.

The measurement script is not committed — it is a scratch file, reproduced in
full at the bottom of this document.

| state | `fillText` | `arc` | `stroke` | gradients |
| --- | ---: | ---: | ---: | ---: |
| no hover (resting map) | 467 | 935 | 1025 | 467 |
| **hover, this story** | **467** | **958** | **1048** | **467** |
| hover, previous encoding | 42 | 935 | 1025 | 467 |

**Read it in the other direction.** The interesting number is not that this
story draws 425 more labels than the old hover did — it is that hovering no
longer *changes* the label workload at all (467 → 467). The old encoding
deleted 425 of 467 labels the instant the pointer touched a node and restored
them the instant it left, which is precisely the strobe FR-29 names, and it did
so on every crossing of every node.

The added cost over the resting map is **+23 `arc` and +23 `stroke` calls** —
one ring per drawn chain node — and no additional gradient, which is the
expensive per-node operation. Glow radius grows by `CHAIN_GLOW_BOOST` (1.35)
for those same ≤25 nodes; it is a larger gradient, not another one.

## 2. The fps yardstick, before and after

**Method.** `PERF_PORT=<free> pnpm --filter @gitnebula/viz perf`, story 3.5's
harness unchanged: scripted camera keyframes on the rAF clock, 2,100-node
fixture, sustained fps = the lowest frame count in any sliding 1-second window.
"Before" is an untouched checkout of `origin/epic/5-onboarding` (`9c28344`) in
a separate worktree on the same machine, run minutes apart from "after".

Note the harness drives the **camera**, not the pointer: it never hovers. These
numbers therefore certify that the render-path edits cost nothing on the
ordinary path, and say nothing about the hover path — which section 1 measures
instead.

| phase | | avg fps | sustained (worst 1 s) | p95 interval | max interval |
| --- | --- | ---: | ---: | ---: | ---: |
| `b-frozen-pan-zoom` | before | 120.00 | 119 | 9.1 ms | 9.4 ms |
| | **after** | **120.00** | **119** | 9.1 ms | 9.4 ms |
| `c-unfold-pan` | before | 116.73 | 86 | 9.2 ms | 25.0 ms |
| | **after** | **116.80** | **87** | 9.3 ms | 17.6 ms |

**Verdict: no regression.** Both phases sit far above the 55 fps floor
(SM-2, FR-14), and the before/after difference is inside the run-to-run spread
already recorded in `docs/dev/epic-3/3.5-viz-export-perf/PERFORMANCE.md`.

## 3. A pre-existing failure in the same suite

`perf/tests/export.pw.ts` fails on this branch:

```
expect(parity.exportHeight).toBe(parity.cssHeight * 2)
Expected: 1594   Received: 1654
```

It fails **identically** on the untouched base checkout, byte for byte
(797 × 2 = 1594 expected, 827 × 2 = 1654 received) — a window-height
disagreement inside the export parity harness in this environment, unrelated to
anything this story touches. Recorded here and in the PR body; not fixed, per
the cohort rule about defects outside a story.

## Reproducing section 1

Drop this in `packages/viz/src/engine/hover-labels.measure.test.ts` and run
`pnpm --filter @gitnebula/viz exec vitest run src/engine/hover-labels.measure.test.ts --reporter=verbose`.

```ts
// @vitest-environment jsdom
import { describe, it } from "vitest";

import { CanvasGraphEngine } from "./engine.js";
import { renderFrame } from "./render.js";
import {
  createFakeContext,
  installFakeCanvas,
} from "../test-support/fake-canvas.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";

describe("measure", () => {
  it("counts draw calls with and without a hover at FILE_LABEL_ZOOM", async () => {
    installFakeCanvas(1440, 797);
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const engine = new CanvasGraphEngine({ canvas });
    engine.load(loadSyntheticFixture());
    let clock = 0;
    for (let i = 0; i < 600; i++) engine.frame((clock += 1000 / 60));
    const module = engine.nodes.find((n) => n.kind === "module")!;
    await engine.flyTo(module.id, { durationMs: 0, zoom: 3.2 });
    for (let i = 0; i < 20; i++) engine.frame((clock += 1000 / 60));

    const count = (chainMode: "hover" | "isolate" | undefined, hover: boolean) => {
      engine.setHovered(hover ? module.id : null, hover ? { x: 0, y: 0 } : null);
      const scene = { ...engine.buildScene(clock)!, chainMode };
      const fake = createFakeContext();
      renderFrame(fake.context, scene);
      const ops: Record<string, number> = {};
      for (const call of fake.calls) ops[call.op] = (ops[call.op] ?? 0) + 1;
      return {
        nodes: scene.nodes.length,
        chain: scene.chain?.size ?? 0,
        fillText: ops["fillText"] ?? 0,
        arc: ops["arc"] ?? 0,
        stroke: ops["stroke"] ?? 0,
        gradients: fake.gradients.length,
      };
    };

    console.log("no hover   ", JSON.stringify(count(undefined, false)));
    console.log("hover (new)", JSON.stringify(count("hover", true)));
    console.log("hover (old)", JSON.stringify(count("isolate", true)));
    engine.destroy();
  });
});
```
