// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  failedSwitchReason,
  swapWithFallback,
  unavailabilityAfterSwap,
} from "./app.js";
import { connectEngine, mountChrome } from "./chrome/chrome.js";
import { createSearchBox } from "./chrome/search.js";
import {
  CanvasGraphEngine,
  createGraphEngine,
  type GraphEngine,
} from "./engine/index.js";
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
    returnScopeId: from.getReturnScope(),
  };
  to.setMode(state.mode);
  to.setLayerFilter(state.layers);
  to.setScope(state.scopeId);
  to.setConnectedOnly(state.connectedOnly);
  if (state.selectedId !== null) to.setSelected(state.selectedId);
  if (state.isolatedId !== null) to.setIsolated(state.isolatedId);
  to.setBlastRadius(state.blastRadius);
  to.setReturnScope(state.returnScopeId);
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

describe("swapWithFallback — a failed switch must not kill the viewer", () => {
  it("reports the requested view when the swap succeeds", () => {
    const tried: string[] = [];
    const result = swapWithFallback("3d", "2d", (v) => {
      tried.push(v);
    });
    expect(result.outcome).toBe("switched");
    expect(result.view).toBe("3d");
    expect(tried).toEqual(["3d"]);
  });

  it("falls back to the working view when the new one throws", () => {
    // The defect this encodes: `swapEngine` destroys the old engine before
    // building the new one, so a throw after that point left a canvas with
    // nothing drawing on it — and a toggle that had already recorded the new
    // view, making the next click a no-op. The reader had a dead map and no
    // way back.
    const tried: string[] = [];
    const result = swapWithFallback("3d", "2d", (v) => {
      tried.push(v);
      if (v === "3d") throw new Error("WebGL context lost");
    });
    expect(result.outcome).toBe("kept");
    expect(result.view).toBe("2d");
    expect(tried).toEqual(["3d", "2d"]);
    expect((result.cause as Error).message).toBe("WebGL context lost");
  });

  it("reports broken only when neither view can be built", () => {
    const result = swapWithFallback("3d", "2d", () => {
      throw new Error("no canvas at all");
    });
    expect(result.outcome).toBe("broken");
    expect((result.cause as Error).message).toBe("no canvas at all");
  });

  it("keeps the original cause rather than the failed recovery's", () => {
    // The first failure describes the actual problem; the second is a
    // consequence of it, and reporting it would send the reader after the
    // wrong thing.
    const result = swapWithFallback("3d", "2d", (v) => {
      throw new Error(v === "3d" ? "the real cause" : "consequence");
    });
    expect((result.cause as Error).message).toBe("the real cause");
  });

  it("does not retry when there is no other view to fall back to", () => {
    // The boot path passes the requested view and the default. When they are
    // the same — an ordinary 2D load — retrying would fail identically and
    // twice is not more informative than once.
    let calls = 0;
    const result = swapWithFallback("2d", "2d", () => {
      calls += 1;
      throw new Error("nothing can be built");
    });
    expect(calls).toBe(1);
    expect(result.outcome).toBe("broken");
  });

  it("covers the boot path too: 3D that loads badly degrades to 2D", () => {
    // `createViewEngine` guards only its own construction, so opening
    // `?view=3d` on a document 3D can construct but cannot load would have
    // replaced a perfectly renderable 2D map with an error screen — the
    // opposite of AC-5, reached by the one path AC-5 did not cover.
    const tried: string[] = [];
    const result = swapWithFallback("3d", "2d", (v) => {
      tried.push(v);
      if (v === "3d") throw new Error("load failed after construction");
    });
    expect(result.outcome).toBe("kept");
    expect(result.view).toBe("2d");
    expect(tried).toEqual(["3d", "2d"]);
  });

  it("attempts each view at most once", () => {
    // A retry loop here would rebuild the engine repeatedly on a broken page.
    let calls = 0;
    swapWithFallback("3d", "2d", () => {
      calls += 1;
      throw new Error("nope");
    });
    expect(calls).toBe(2);
  });
});

describe("the return-to-scope offer survives a view swap (5.4 x 5.7)", () => {
  it("carries the offer a search left behind", async () => {
    // Story 5.4: a search that targets a node outside the active scope leaves
    // the scope and flies, and the chrome then offers a way back. While that
    // offer is live `getScope()` is already null — so carrying the scope alone
    // drops the reader's way back while they are still looking at the very
    // search result that created it.
    const canvas = stage();
    document.body.append(canvas);

    // The concrete class, not the interface: this test reads `buildScene` to
    // find a node the scoped frame does not carry, and that is a class member
    // rather than a seam member (deliberately — chrome never sees the scene).
    const twoD = new CanvasGraphEngine({ canvas, reducedMotion: true });
    built.push(twoD);
    twoD.load(analysis);

    const scoped = twoD.nodes.find((node) => node.kind === "module")!;
    twoD.setScope(scoped.id);

    // A module's scope includes its neighbours, so "some other module" is not
    // necessarily outside it. Ask the engine which nodes the scoped frame
    // actually carries and pick one it does not — that is the search target
    // whose flight leaves the scope.
    const inFrame = new Set(
      twoD.buildScene(0)!.nodes.map((item) => item.node.id),
    );
    const outside = twoD.nodes.find((node) => !inFrame.has(node.id));
    expect(outside, "fixture has no node outside the scope").toBeDefined();

    // Reduced motion makes the flight synchronous.
    await twoD.flyTo(outside!.id);

    expect(twoD.getScope()).toBeNull();
    expect(twoD.getReturnScope()).toBe(scoped.id);

    const threeD = createNebula3DEngine({ canvas, reducedMotion: true });
    built.push(threeD);
    threeD.load(analysis);
    expect(threeD.getReturnScope()).toBeNull();

    carry(twoD, threeD);
    expect(threeD.getReturnScope()).toBe(scoped.id);
    // ...and it did not invent a scope to go with it.
    expect(threeD.getScope()).toBeNull();
  });

  it("does not invent an offer where there was none", () => {
    const canvas = stage();
    document.body.append(canvas);
    const twoD = createGraphEngine({ canvas, reducedMotion: true });
    built.push(twoD);
    twoD.load(analysis);
    const threeD = createNebula3DEngine({ canvas, reducedMotion: true });
    built.push(threeD);
    threeD.load(analysis);
    carry(twoD, threeD);
    expect(threeD.getReturnScope()).toBeNull();
  });

  it("restores the offer after the scope, not before it", () => {
    // Entering a scope clears the offer by design (5.4), so restoring the
    // offer first would have the scope restore wipe it straight out again.
    const canvas = stage();
    document.body.append(canvas);
    const engine = createNebula3DEngine({ canvas, reducedMotion: true });
    built.push(engine);
    engine.load(analysis);
    const moduleId = engine.nodes.find((n) => n.kind === "module")!.id;

    engine.setReturnScope(moduleId);
    engine.setScope(moduleId);
    expect(engine.getReturnScope()).toBeNull();

    engine.setReturnScope(moduleId);
    expect(engine.getReturnScope()).toBe(moduleId);
  });

  it("is implemented by both engines, so either can receive the state", () => {
    const canvas = stage();
    document.body.append(canvas);
    for (const engine of [
      createGraphEngine({ canvas, reducedMotion: true }),
      createNebula3DEngine({ canvas, reducedMotion: true }),
    ]) {
      built.push(engine);
      engine.load(analysis);
      const moduleId = engine.nodes.find((n) => n.kind === "module")!.id;
      engine.setReturnScope(moduleId);
      expect(engine.getReturnScope()).toBe(moduleId);
      engine.setReturnScope(null);
      expect(engine.getReturnScope()).toBeNull();
    }
  });
});

describe("failedSwitchReason — a failed switch reports against the right control", () => {
  it("disables 3D when 3D was the view that failed", () => {
    const reason = failedSwitchReason("3d", "2d", "context lost");
    expect(reason).toContain("3D view could not be started");
    expect(reason).toContain("context lost");
  });

  it("leaves the 3D button alone when 3D is the view still running", () => {
    // The defect: switching 3D -> 2D, where 2D throws and 3D is restored,
    // disabled the button for the view the reader is successfully looking at
    // and explained it with a message about the other one.
    expect(failedSwitchReason("2d", "3d", "no canvas")).toBeNull();
  });
});
