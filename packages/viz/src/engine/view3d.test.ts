// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Nebula3DEngine } from "./engine3d.js";
import { CanvasGraphEngine } from "./engine.js";
import {
  createViewEngine,
  DEFAULT_VIEW,
  isViewKind,
  probe3D,
  viewFromSearch,
} from "./view.js";
import { installFakeCanvas } from "../test-support/fake-canvas.js";
import { loadContractFixture } from "../test-support/fixtures.js";

let canvas: HTMLCanvasElement;
const built: { destroy(): void }[] = [];

function make(): HTMLCanvasElement {
  const element = document.createElement("canvas");
  document.body.append(element);
  return element;
}

beforeEach(() => {
  installFakeCanvas(1200, 800);
  canvas = make();
});

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
  document.body.replaceChildren();
});

describe("view selection", () => {
  it("defaults to 2D (AC-1)", () => {
    expect(DEFAULT_VIEW).toBe("2d");
    const result = createViewEngine({ canvas });
    built.push(result.engine);
    expect(result.view).toBe("2d");
    expect(result.engine).toBeInstanceOf(CanvasGraphEngine);
    expect(result.reason).toBeNull();
  });

  it("builds the 3D view when it is asked for", () => {
    const result = createViewEngine({ canvas, view: "3d" });
    built.push(result.engine);
    expect(result.view).toBe("3d");
    expect(result.engine).toBeInstanceOf(Nebula3DEngine);
    expect(result.reason).toBeNull();
  });

  it("reads the view from a URL query (D6)", () => {
    expect(viewFromSearch("?view=3d")).toBe("3d");
    expect(viewFromSearch("?view=2d")).toBe("2d");
  });

  it("falls back to 2D for an absent, unknown or malformed parameter", () => {
    // The default has to survive a typo: `?view=3D` or `?view=three` is a
    // request nobody should be punished for with a blank page.
    expect(viewFromSearch("")).toBe("2d");
    expect(viewFromSearch("?view=three")).toBe("2d");
    expect(viewFromSearch("?view=")).toBe("2d");
    expect(viewFromSearch("?other=1")).toBe("2d");
  });

  it("recognises exactly the two view kinds", () => {
    expect(isViewKind("2d")).toBe(true);
    expect(isViewKind("3d")).toBe(true);
    expect(isViewKind("3D")).toBe(false);
    expect(isViewKind(null)).toBe(false);
  });
});

describe("AC-5 — 3D degrades to the 2D map with a stated reason", () => {
  it("falls back, rather than blanking, when no rendering context is available", () => {
    // The simulated unavailable path AC-5 asks for. This 3D view uses canvas
    // 2D rather than WebGL (DECISIONS.md D4), so "no usable context" is the
    // shape the criterion's intent takes here.
    const result = createViewEngine({
      canvas,
      view: "3d",
      probe: () => "3D needs a rendering context this browser did not provide.",
    });
    built.push(result.engine);

    expect(result.view).toBe("2d");
    expect(result.engine).toBeInstanceOf(CanvasGraphEngine);
    expect(result.reason).toContain("rendering context");
  });

  it("hands back a WORKING 2D engine, not merely a non-null one", () => {
    // The criterion is "degrades to the 2D map", not "does not crash". A
    // fallback that returned a dead engine would satisfy a null check and
    // still leave the user looking at nothing.
    const result = createViewEngine({
      canvas,
      view: "3d",
      reducedMotion: true,
      probe: () => "no context",
    });
    built.push(result.engine);
    result.engine.load(loadContractFixture("cyclic-imports"));
    expect(result.engine.nodes.length).toBeGreaterThan(0);
    expect(result.engine.getCamera()).toBeTruthy();
  });

  it("states a reason a person can act on, not an error code", () => {
    const result = createViewEngine({ canvas, view: "3d", probe: () => null });
    built.push(result.engine);
    expect(result.reason).toBeNull();

    const blocked = createViewEngine({
      canvas,
      view: "3d",
      probe: (target) => probe3D(target),
    });
    built.push(blocked.engine);
    // With the fake canvas installed a context IS available, so this one
    // succeeds — the probe is not rejecting everything unconditionally.
    expect(blocked.view).toBe("3d");
  });

  it("falls back when the 3D constructor throws despite a passing probe", () => {
    // A probe is a prediction, not a guarantee. Both routes have to end at a
    // working 2D map or the guarantee has a hole in it.
    const result = createViewEngine({
      canvas,
      view: "3d",
      probe: () => null,
      create3D: () => {
        throw new Error("WebGL context lost");
      },
    });
    built.push(result.engine);
    expect(result.view).toBe("2d");
    expect(result.engine).toBeInstanceOf(CanvasGraphEngine);
    expect(result.reason).toContain("could not be started");
    expect(result.reason).toContain("WebGL context lost");
  });

  it("propagates rather than faking a fallback when 2D is impossible too", () => {
    // Deliberately NOT degraded: with no canvas context at all there is
    // nothing left to degrade *to*, and returning a dead engine would satisfy
    // a null check while drawing nothing — the blank canvas AC-5 forbids,
    // arrived at by a different route. `app.ts` turns this into the FR-6
    // error screen, which explains the situation.
    const broken = make();
    broken.getContext = (() =>
      null) as unknown as HTMLCanvasElement["getContext"];
    expect(() =>
      createViewEngine({ canvas: broken, view: "3d", probe: () => null }),
    ).toThrow(/context unavailable/);
  });

  it("never reports a reason when the requested view was actually built", () => {
    const twoD = createViewEngine({ canvas, view: "2d" });
    built.push(twoD.engine);
    expect(twoD.reason).toBeNull();
  });
});

describe("probe3D", () => {
  it("passes when a 2D context and requestAnimationFrame are present", () => {
    expect(probe3D(canvas)).toBeNull();
  });

  it("explains a refused context rather than throwing", () => {
    const hostile = make();
    hostile.getContext = (() => {
      throw new Error("blocked by privacy setting");
    }) as unknown as HTMLCanvasElement["getContext"];
    const reason = probe3D(hostile);
    expect(reason).toContain("blocked by privacy setting");
    expect(reason).toContain("2D map");
  });

  it("explains a missing context", () => {
    const empty = make();
    empty.getContext = (() =>
      null) as unknown as HTMLCanvasElement["getContext"];
    expect(probe3D(empty)).toContain("did not provide one");
  });
});
