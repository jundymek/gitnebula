// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CanvasGraphEngine } from "./engine.js";
import {
  installFakeCanvas,
  type DrawCall,
  type FakeContext,
} from "../test-support/fake-canvas.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";

/**
 * `exportPNG` at the engine level: does the export reproduce the frame that is
 * on screen? The pixels themselves are asserted by the Playwright spec in
 * `perf/tests/export.pw.ts` (jsdom has no rasteriser); what is checkable here
 * is the stronger structural claim — the export issues the *same draw calls*
 * as the live frame, because both come from one scene.
 */

const FRAME_MS = 1000 / 60;

let fake: FakeContext;
let engine: CanvasGraphEngine;

function create(): CanvasGraphEngine {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  return new CanvasGraphEngine({ canvas });
}

/** jsdom has no rasteriser, so the encode step is stubbed at the canvas API. */
function stubToBlob(): void {
  HTMLCanvasElement.prototype.toBlob = function toBlob(
    callback: BlobCallback,
    type?: string,
  ): void {
    callback(new Blob(["fake-png"], { type: type ?? "image/png" }));
  };
}

/** Draw calls with their arguments, as a comparable string. */
function signature(calls: readonly DrawCall[]): string[] {
  return calls
    .filter((call) => call.op !== "setTransform")
    .map((call) => `${call.op}(${JSON.stringify(call.args)})`);
}

beforeEach(() => {
  fake = installFakeCanvas(1200, 800);
  stubToBlob();
});

afterEach(() => {
  engine?.destroy();
  document.body.replaceChildren();
});

describe("CanvasGraphEngine.exportPNG (FR-22, AD-5)", () => {
  it("refuses to export before a document is loaded", async () => {
    engine = create();
    await expect(engine.exportPNG()).rejects.toThrow(/nothing to export/);
  });

  it("resolves with a PNG blob once the map is drawn", async () => {
    engine = create();
    engine.load(loadSyntheticFixture());
    engine.frame(0);
    const blob = await engine.exportPNG();
    expect(blob.type).toBe("image/png");
  });

  it("re-renders the SAME scene the last frame drew", async () => {
    engine = create();
    engine.load(loadSyntheticFixture());
    // Two frames so the layout has moved between them: an export that rebuilt
    // the scene from scratch, or read a different clock, would diverge here.
    engine.frame(0);
    fake.calls.length = 0;
    engine.frame(FRAME_MS);
    const live = signature(fake.calls);

    fake.calls.length = 0;
    await engine.exportPNG();
    const exported = signature(fake.calls);

    expect(exported).toEqual(live);
  });

  it("carries hover/isolate highlight and mode into the export", async () => {
    engine = create();
    engine.load(loadSyntheticFixture());
    engine.setMode("heat");
    engine.setIsolated("mod-000/");
    engine.frame(0);
    const live = signature(fake.calls);

    fake.calls.length = 0;
    await engine.exportPNG();
    expect(signature(fake.calls)).toEqual(live);

    // And the highlight is genuinely in there — a scene with no chain would
    // never dim a node, so an all-opaque export would pass the equality above
    // while failing AC-1.
    expect(
      fake.calls.some(
        (call) =>
          call.op === "set:fillStyle" &&
          typeof call.args[0] === "string" &&
          (call.args[0] as string).includes("0.16"),
      ),
    ).toBe(true);
  });

  it("scales the surface, not the world: the drawing calls are unchanged at 4x", async () => {
    engine = create();
    engine.load(loadSyntheticFixture());
    engine.frame(0);
    const live = signature(fake.calls);

    fake.calls.length = 0;
    await engine.exportPNG({ scale: 4 });
    const exported = fake.calls;
    // Density lives in the transform...
    expect(exported.find((call) => call.op === "setTransform")?.args).toEqual([
      4, 0, 0, 4, 0, 0,
    ]);
    // ...and nowhere else: every coordinate is still in CSS pixels, so a 4x
    // export frames exactly the same region of the map as the screen.
    expect(signature(exported)).toEqual(live);
  });

  it("rejects a scale below the AD-5 floor", async () => {
    engine = create();
    engine.load(loadSyntheticFixture());
    engine.frame(0);
    await expect(engine.exportPNG({ scale: 1 })).rejects.toThrow(/AD-5/);
  });
});
