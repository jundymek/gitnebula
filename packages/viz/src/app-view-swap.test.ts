// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unavailabilityAfterSwap } from "./app.js";
import { connectEngine, mountChrome } from "./chrome/chrome.js";
import { createSearchBox } from "./chrome/search.js";
import { createGraphEngine, type GraphEngine } from "./engine/index.js";
import { createNebula3DEngine } from "./engine/engine3d.js";
import { installFakeCanvas } from "./test-support/fake-canvas.js";
import { loadContractFixture } from "./test-support/fixtures.js";

/**
 * Regressions from story 5.7's code review, both in the **view swap**.
 *
 * `boot()` itself is not exercised here — it fetches `analysis.json` — so
 * these reproduce the two behaviours `app.ts` depends on, at the seam where
 * each defect actually lived.
 */

const analysis = loadContractFixture("cyclic-imports");
const built: GraphEngine[] = [];

function stage(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.id = "stage";
  return canvas;
}

beforeEach(() => {
  installFakeCanvas(1200, 800);
});

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
  document.body.replaceChildren();
});

/**
 * What `app.ts` captures and restores across a swap, exercised directly on two
 * engines. Kept in step with `captureState`/`restoreState` in `app.ts`.
 */
function carry(from: GraphEngine, to: GraphEngine): void {
  const state = {
    mode: from.getMode(),
    layers: [...from.getLayerFilter()],
    scopeId: from.getScope(),
    connectedOnly: from.getConnectedOnly(),
    selectedId: from.getSelected()?.id ?? null,
    isolatedId: from.getIsolated()?.id ?? null,
    blastRadius: [...from.getBlastRadius()],
  };
  to.setMode(state.mode);
  to.setLayerFilter(state.layers);
  to.setScope(state.scopeId);
  to.setConnectedOnly(state.connectedOnly);
  if (state.selectedId !== null) to.setSelected(state.selectedId);
  if (state.isolatedId !== null) to.setIsolated(state.isolatedId);
  to.setBlastRadius(state.blastRadius);
}

describe("the search box survives a view swap", () => {
  it("is not destroyed by a disconnect that passes destroyControls: false", () => {
    // The defect: `connectEngine`'s teardown called `search.destroy()`, which
    // removes the document-level shortcut listener. That is correct for a page
    // teardown and wrong for a swap — the search box is created once and
    // reused by every engine, so after one 2D→3D switch it looked present and
    // answered nothing.
    const root = document.createElement("div");
    document.body.append(root);

    const search = createSearchBox({ onSelect: () => {} });
    let destroyed = false;
    const realDestroy = search.destroy.bind(search);
    search.destroy = () => {
      destroyed = true;
      realDestroy();
    };

    const canvas = stage();
    const chrome = mountChrome(root, analysis, {
      stage: canvas,
      actions: { onReplay: () => {} },
      overlays: [search.element],
    });

    const engine = createGraphEngine({ canvas, reducedMotion: true });
    built.push(engine);
    engine.load(analysis);
    const disconnect = connectEngine(chrome, engine, {
      search,
      analysis,
      destroyControls: false,
    });
    disconnect();

    expect(destroyed).toBe(false);
  });

  it("still destroys the search box by default, so no existing caller changes", () => {
    const root = document.createElement("div");
    document.body.append(root);

    const search = createSearchBox({ onSelect: () => {} });
    let destroyed = false;
    const realDestroy = search.destroy.bind(search);
    search.destroy = () => {
      destroyed = true;
      realDestroy();
    };

    const canvas = stage();
    const chrome = mountChrome(root, analysis, {
      stage: canvas,
      actions: { onReplay: () => {} },
      overlays: [search.element],
    });
    const engine = createGraphEngine({ canvas, reducedMotion: true });
    built.push(engine);
    engine.load(analysis);
    // No `destroyControls` — the behaviour every pre-5.7 caller relies on.
    connectEngine(chrome, engine, { search, analysis })();

    expect(destroyed).toBe(true);
  });
});

describe("graph state carries across a view swap", () => {
  it("carries mode, layers, scope, connected-only and selection 2D → 3D", () => {
    // A view switch changes how the graph is drawn, not what the reader is
    // looking at. Without this the reader silently loses the frame they built.
    const canvas = stage();
    document.body.append(canvas);

    const twoD = createGraphEngine({ canvas, reducedMotion: true });
    built.push(twoD);
    twoD.load(analysis);

    const moduleId = twoD.nodes.find((node) => node.kind === "module")!.id;
    twoD.setMode("heat");
    twoD.setLayerFilter(["backend", "frontend"]);
    twoD.setConnectedOnly(true);
    twoD.setScope(moduleId);
    twoD.setSelected(moduleId);
    twoD.setIsolated(moduleId);

    const threeD = createNebula3DEngine({ canvas, reducedMotion: true });
    built.push(threeD);
    threeD.load(analysis);
    // Proof the assertions below are not passing on defaults.
    expect(threeD.getMode()).toBe("structure");
    expect(threeD.getScope()).toBeNull();

    carry(twoD, threeD);

    expect(threeD.getMode()).toBe("heat");
    expect([...threeD.getLayerFilter()]).toEqual(["backend", "frontend"]);
    expect(threeD.getConnectedOnly()).toBe(true);
    expect(threeD.getScope()).toBe(moduleId);
    expect(threeD.getSelected()?.id).toBe(moduleId);
    expect(threeD.getIsolated()?.id).toBe(moduleId);
  });

  it("carries the same state back 3D → 2D", () => {
    const canvas = stage();
    document.body.append(canvas);

    const threeD = createNebula3DEngine({ canvas, reducedMotion: true });
    built.push(threeD);
    threeD.load(analysis);
    const moduleId = threeD.nodes.find((node) => node.kind === "module")!.id;
    threeD.setMode("heat");
    threeD.setScope(moduleId);

    const twoD = createGraphEngine({ canvas, reducedMotion: true });
    built.push(twoD);
    twoD.load(analysis);
    carry(threeD, twoD);

    expect(twoD.getMode()).toBe("heat");
    expect(twoD.getScope()).toBe(moduleId);
  });

  it("carries a clean state without inventing one", () => {
    // The untouched case must stay untouched: restoring null/defaults should
    // not, for instance, scope to an arbitrary module or select something.
    const canvas = stage();
    document.body.append(canvas);

    const twoD = createGraphEngine({ canvas, reducedMotion: true });
    built.push(twoD);
    twoD.load(analysis);

    const threeD = createNebula3DEngine({ canvas, reducedMotion: true });
    built.push(threeD);
    threeD.load(analysis);
    carry(twoD, threeD);

    expect(threeD.getMode()).toBe("structure");
    expect(threeD.getScope()).toBeNull();
    expect(threeD.getConnectedOnly()).toBe(false);
    expect(threeD.getSelected()).toBeNull();
    expect(threeD.getIsolated()).toBeNull();
  });
});

describe("the co-change mark survives a view swap (5.6 x 5.7)", () => {
  it("carries the blast radius 2D -> 3D", () => {
    // This story insisted 3D *draw* 5.6's mark rather than merely store it,
    // on the grounds that a capability vanishing on the view switch would
    // falsify "same map, one interface". Dropping the ids from the carried
    // state reintroduced exactly that defect one layer up — the mark would
    // disappear while the panel still implied it was active.
    const canvas = stage();
    document.body.append(canvas);

    const twoD = createGraphEngine({ canvas, reducedMotion: true });
    built.push(twoD);
    twoD.load(analysis);
    const partners = twoD.nodes.slice(0, 2).map((node) => node.id);
    twoD.setBlastRadius(partners);

    const threeD = createNebula3DEngine({ canvas, reducedMotion: true });
    built.push(threeD);
    threeD.load(analysis);
    expect(threeD.getBlastRadius()).toEqual([]);

    carry(twoD, threeD);
    expect([...threeD.getBlastRadius()]).toEqual(partners);
  });

  it("carries an empty blast radius without inventing one", () => {
    const canvas = stage();
    document.body.append(canvas);
    const twoD = createGraphEngine({ canvas, reducedMotion: true });
    built.push(twoD);
    twoD.load(analysis);
    const threeD = createNebula3DEngine({ canvas, reducedMotion: true });
    built.push(threeD);
    threeD.load(analysis);
    carry(twoD, threeD);
    expect(threeD.getBlastRadius()).toEqual([]);
  });
});

describe("unavailabilityAfterSwap — the 3D button's reason (AC-5)", () => {
  it("keeps a constructor failure's reason instead of probing it away", () => {
    // The regression: `?view=3d`, probe passes, constructor throws, fall back
    // to 2D. A later unconditional probe returned null, which re-enabled the
    // button and erased the only explanation the reader was given.
    const reason = unavailabilityAfterSwap(
      {
        view: "2d",
        reason: "The 3D view could not be started (context lost).",
      },
      () => null,
    );
    expect(reason).toContain("could not be started");
  });

  it("asks the probe when 3D was never attempted", () => {
    expect(
      unavailabilityAfterSwap({ view: "2d", reason: null }, () => "no canvas"),
    ).toBe("no canvas");
    expect(
      unavailabilityAfterSwap({ view: "2d", reason: null }, () => null),
    ).toBeNull();
  });

  it("never disables 3D while 3D is the view actually running", () => {
    expect(
      unavailabilityAfterSwap({ view: "3d", reason: null }, () => "stale"),
    ).toBeNull();
  });
});
