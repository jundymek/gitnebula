import { expect, test, type Page } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { openViewer } from "../../harness/page-helpers.js";

/**
 * Story 6.2, AC-3 / AC-4 / AC-5 — **the real `swapEngine()` runs.**
 *
 * `src/app-view-swap.test.ts` is a good file and it covers the three *pure*
 * helpers thoroughly. What it cannot cover is the function that uses them.
 * `swapEngine`, `captureState` and `restoreState` are closures inside `boot()`
 * — not exported, not reachable, and `boot()` fetches `analysis.json` before
 * any of them exists. So that test does the only thing available to it: it
 * declares a local `carry()` helper (`app-view-swap.test.ts:50-69`) that
 * re-implements the capture/restore logic by hand, with a comment saying it
 * must be "kept in step with" `app.ts`.
 *
 * The consequence is the sharp one: **deleting a field from `restoreState` in
 * `app.ts` fails no test today.** `carry()` would still copy it, the jsdom
 * tests would still pass, and a reader would silently lose that piece of their
 * frame on every view change.
 *
 * This file closes that. Every assertion below goes through the real
 * `swapEngine` by clicking the real control, and reads the result through the
 * harness handle — so a field dropped from `restoreState` is a red run.
 *
 * **The republish trap, which shapes every test here.**
 * `publishHarnessHandle(engine)` is called *inside* `swapEngine`, so the value
 * at the handle key is replaced on every swap. A test that reads the handle
 * once and keeps the reference is holding a **destroyed** engine afterwards.
 * `destroy()` clears the emitter and removes the canvas listeners but leaves
 * every getter answering (`engine.ts:378-394`), so a stale handle does not
 * throw — it quietly reports the past. Every helper here re-reads the handle,
 * and the AC-4 test demonstrates the trap rather than merely avoiding it.
 */

/** The view switch's two buttons, by the `data-view` attribute they carry. */
const VIEW_BUTTON = {
  "2d": '#view-switch button[data-view="2d"]',
  "3d": '#view-switch button[data-view="3d"]',
} as const;

/**
 * Everything `CarriedState` in `app.ts` carries across a swap, read back
 * through the `GraphEngine` interface.
 *
 * Deliberately the same eight fields in the same shape as `captureState`, so
 * that a field added there and not here is visible as a gap rather than
 * silently uncovered.
 */
interface CarriedReadout {
  mode: string;
  layers: string[];
  scopeId: string | null;
  connectedOnly: boolean;
  selectedId: string | null;
  isolatedId: string | null;
  blastRadius: string[];
  returnScopeId: string | null;
}

interface SwapReadout {
  readonly carried: CarriedReadout;
  readonly is3D: boolean;
  readonly nodeCount: number;
  readonly pressed2D: string | null;
  readonly pressed3D: string | null;
  readonly threeDDisabled: boolean;
  readonly threeDReason: string;
}

/**
 * Read the live engine's carried state and the switch that describes it.
 *
 * Re-reads the handle every time it is called. That is not defensive style: it
 * is the correctness requirement stated above, and caching here would make
 * every assertion in this file a statement about a destroyed engine.
 */
async function readSwapState(page: Page, key: string): Promise<SwapReadout> {
  return page.evaluate(async (handleKey): Promise<SwapReadout> => {
    const handle = (
      globalThis as unknown as Record<
        string,
        {
          engine: {
            nodes: readonly { id: string }[];
            getMode(): string;
            getLayerFilter(): readonly string[];
            getScope(): string | null;
            getConnectedOnly(): boolean;
            getSelected(): { id: string } | null;
            getIsolated(): { id: string } | null;
            getBlastRadius(): readonly string[];
            getReturnScope(): string | null;
            getOrientation?: () => unknown;
          };
          settled: Promise<{ frames: number; durationMs: number }>;
        }
      >
    )[handleKey];
    if (!handle)
      throw new Error(`no harness handle at globalThis.${handleKey}`);
    await handle.settled;
    const engine = handle.engine;
    const threeD: HTMLButtonElement | null = document.querySelector(
      '#view-switch button[data-view="3d"]',
    );
    return {
      carried: {
        mode: engine.getMode(),
        layers: [...engine.getLayerFilter()],
        scopeId: engine.getScope(),
        connectedOnly: engine.getConnectedOnly(),
        selectedId: engine.getSelected()?.id ?? null,
        isolatedId: engine.getIsolated()?.id ?? null,
        blastRadius: [...engine.getBlastRadius()],
        returnScopeId: engine.getReturnScope(),
      },
      is3D: engine.getOrientation !== undefined,
      nodeCount: engine.nodes.length,
      pressed2D:
        document
          .querySelector('#view-switch button[data-view="2d"]')
          ?.getAttribute("aria-pressed") ?? null,
      pressed3D: threeD?.getAttribute("aria-pressed") ?? null,
      threeDDisabled: threeD?.disabled ?? true,
      threeDReason:
        document.querySelector("#view-switch-reason")?.textContent ?? "",
    };
  }, key);
}

/**
 * Click a view button and wait until a *different* engine object is published.
 *
 * The swap is synchronous inside the click handler, so this would almost
 * always be satisfied immediately — but "almost always" is how a suite earns
 * an intermittent failure, and waiting on the identity change states the
 * actual postcondition: a new engine is at the handle. Comparing object
 * identity rather than a flag is what makes it a real wait.
 */
async function clickView(
  page: Page,
  view: "2d" | "3d",
  key: string,
): Promise<void> {
  const previousEngine = await page.evaluateHandle((handleKey) => {
    const handle = (
      globalThis as unknown as Record<string, { engine: object } | undefined>
    )[handleKey];
    if (!handle) throw new Error("no harness handle");
    return handle.engine;
  }, key);
  await page.click(VIEW_BUTTON[view]);
  await page.waitForFunction(
    ([handleKey, before]) => {
      const handle = (
        globalThis as unknown as Record<string, { engine: object } | undefined>
      )[handleKey as string];
      return handle !== undefined && handle.engine !== before;
    },
    [key, previousEngine] as const,
  );
  await previousEngine.dispose();
}

/** The state a reader builds up before flipping the view. */
async function applyReaderState(
  page: Page,
  key: string,
  state: {
    mode?: string;
    layers?: string[];
    scopeId?: string | null;
    connectedOnly?: boolean;
    selectedId?: string | null;
    isolatedId?: string | null;
    blastRadius?: string[];
    returnScopeId?: string | null;
  },
): Promise<void> {
  await page.evaluate(
    async ([handleKey, wanted]) => {
      const handle = (
        globalThis as unknown as Record<
          string,
          {
            engine: {
              setMode(mode: string): void;
              setLayerFilter(layers: readonly string[]): void;
              setScope(id: string | null): void;
              setConnectedOnly(value: boolean): void;
              setSelected(id: string | null): void;
              setIsolated(id: string | null): void;
              setBlastRadius(ids: readonly string[] | null): void;
              setReturnScope(id: string | null): void;
            };
            settled: Promise<unknown>;
          }
        >
      )[handleKey as string];
      if (!handle) throw new Error("no harness handle");
      await handle.settled;
      const engine = handle.engine;
      const want = wanted as Record<string, unknown>;
      // Applied in `restoreState`'s own order, and for its reasons: the mode
      // and the two filters decide what is in the frame, so they go first;
      // selection and isolate go after, because the engine drops interaction
      // state whose node the filters have removed. `setReturnScope` is last,
      // after `setScope`, since entering a scope clears the offer by design.
      if (want.mode !== undefined) engine.setMode(want.mode as string);
      if (want.layers !== undefined)
        engine.setLayerFilter(want.layers as string[]);
      if (want.scopeId !== undefined)
        engine.setScope(want.scopeId as string | null);
      if (want.connectedOnly !== undefined)
        engine.setConnectedOnly(want.connectedOnly as boolean);
      if (want.selectedId !== undefined)
        engine.setSelected(want.selectedId as string | null);
      if (want.isolatedId !== undefined)
        engine.setIsolated(want.isolatedId as string | null);
      if (want.blastRadius !== undefined)
        engine.setBlastRadius(want.blastRadius as string[]);
      if (want.returnScopeId !== undefined)
        engine.setReturnScope(want.returnScopeId as string | null);
    },
    [key, state] as const,
  );
}

/** The state a freshly loaded engine holds, for the "is this vacuous?" guard. */
const DEFAULT_CARRIED: CarriedReadout = {
  mode: "structure",
  layers: ["backend", "frontend", "infra", "test", "other"],
  scopeId: null,
  connectedOnly: false,
  selectedId: null,
  isolatedId: null,
  blastRadius: [],
  returnScopeId: null,
};

test("a 2D -> 3D -> 2D round trip carries the reader's frame (AC-3)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await openViewer(page);

  // The five fields AC-3 names. `fp/proxy.py` is chosen for the selection
  // because it survives every filter applied here: it is a `backend` node, it
  // is a member of the `fp/` scope, and it has three edges so connected-only
  // does not drop it. `fp/util.py` would have been silently reconciled away.
  await applyReaderState(page, HARNESS_HANDLE_KEY, {
    mode: "heat",
    layers: ["backend", "infra"],
    scopeId: "fp/",
    connectedOnly: true,
    selectedId: "fp/proxy.py",
  });

  const before = await readSwapState(page, HARNESS_HANDLE_KEY);

  // Asserting against what the engine *actually holds*, not against what was
  // asked for. The engine reconciles interaction state against the filters, so
  // treating the input as the expectation would be asserting a fiction — and
  // would hide a restore that dropped a field the filters happened to drop
  // too.
  expect(
    before.carried,
    "the state this test sets did not survive being set, before any swap " +
      "happened — the round trip below would be measuring the wrong thing",
  ).not.toEqual(DEFAULT_CARRIED);
  expect(
    {
      mode: before.carried.mode,
      layers: before.carried.layers,
      scopeId: before.carried.scopeId,
      connectedOnly: before.carried.connectedOnly,
      selectedId: before.carried.selectedId,
    },
    "the five fields AC-3 names were not all set on the 2D engine, so a " +
      "round trip that preserved them would prove nothing",
  ).toEqual({
    mode: "heat",
    layers: ["backend", "infra"],
    scopeId: "fp/",
    connectedOnly: true,
    selectedId: "fp/proxy.py",
  });

  await clickView(page, "3d", HARNESS_HANDLE_KEY);
  const in3D = await readSwapState(page, HARNESS_HANDLE_KEY);

  expect(
    in3D.is3D,
    "clicking the 3D button did not leave the 3D engine running, so what " +
      "follows is not a view swap at all",
  ).toBe(true);
  expect(
    in3D.carried,
    "the 3D view did not receive the frame the reader had built in 2D. " +
      "This runs against the real captureState/restoreState in app.ts, so a " +
      "field dropped from restoreState fails here",
  ).toEqual(before.carried);

  await clickView(page, "2d", HARNESS_HANDLE_KEY);
  const backIn2D = await readSwapState(page, HARNESS_HANDLE_KEY);

  expect(backIn2D.is3D, "clicking 2D did not return to the 2D engine").toBe(
    false,
  );
  expect(
    backIn2D.carried,
    "the frame did not survive the return trip to 2D. A view change is meant " +
      "to be a different view of the same frame, not a reset",
  ).toEqual(before.carried);

  // Positions are deliberately *not* carried (a 3D layout has an axis 2D has
  // no place for), but the document is — both engines are seeded from it.
  expect(
    { in3D: in3D.nodeCount, backIn2D: backIn2D.nodeCount },
    "the node count changed across the swap; both views are meant to be the " +
      "same map",
  ).toEqual({ in3D: before.nodeCount, backIn2D: before.nodeCount });

  expect(pageErrors, "the page threw during the round trip").toEqual([]);
});

test("the three carried fields AC-3 does not name survive a swap too (AC-3)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await openViewer(page);

  // `CarriedState` has eight fields; AC-3 names five. Without this test,
  // deleting `to.setBlastRadius(...)` or `to.setReturnScope(...)` from
  // `restoreState` would still fail nothing — which is the exact hole this
  // story exists to close, so covering only the five would half-close it.
  //
  // Scope is left null on purpose. The return-scope offer is what the chrome
  // shows after a search flew *out* of a scope, so `getScope()` is null while
  // the offer is live; that is the shape reality produces, and it is what the
  // `returnScopeId` comment in app.ts describes.
  await applyReaderState(page, HARNESS_HANDLE_KEY, {
    isolatedId: "fp/proxy.py",
    blastRadius: ["test_proxy.py"],
    returnScopeId: "fp/",
  });

  const before = await readSwapState(page, HARNESS_HANDLE_KEY);
  expect(
    {
      isolatedId: before.carried.isolatedId,
      blastRadius: before.carried.blastRadius,
      returnScopeId: before.carried.returnScopeId,
    },
    "the isolate, the co-change mark and the return-scope offer were not all " +
      "set before the swap, so preserving them would prove nothing",
  ).toEqual({
    isolatedId: "fp/proxy.py",
    blastRadius: ["test_proxy.py"],
    returnScopeId: "fp/",
  });

  await clickView(page, "3d", HARNESS_HANDLE_KEY);
  const in3D = await readSwapState(page, HARNESS_HANDLE_KEY);

  expect(
    in3D.carried,
    "the isolate, the blast radius or the return-scope offer was dropped on " +
      "the way to 3D. Story 5.6 argued a blast radius that vanished on a view " +
      "switch would falsify the claim that both views are the same map; the " +
      "return-scope offer is the reader's way back and its loss is silent",
  ).toEqual(before.carried);

  await clickView(page, "2d", HARNESS_HANDLE_KEY);
  const backIn2D = await readSwapState(page, HARNESS_HANDLE_KEY);
  expect(
    backIn2D.carried,
    "one of the three fields was dropped on the way back to 2D",
  ).toEqual(before.carried);

  expect(pageErrors, "the page threw during the round trip").toEqual([]);
});

test("a handle cached across a swap refers to a destroyed engine (AC-4)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await openViewer(page);

  // Hold the pre-swap engine the way a careless spec would: read the handle
  // once, keep the reference. Stored under a key of this test's own so the
  // Viewer's republish cannot reach it.
  await page.evaluate((handleKey) => {
    const store = globalThis as unknown as Record<string, unknown>;
    store.__cachedByTest = (store[handleKey] as { engine: unknown }).engine;
  }, HARNESS_HANDLE_KEY);

  await clickView(page, "3d", HARNESS_HANDLE_KEY);

  const trap = await page.evaluate(async (handleKey) => {
    const store = globalThis as unknown as Record<string, unknown>;
    const cached = store.__cachedByTest as {
      setSelected(id: string | null): void;
      getSelected(): { id: string } | null;
      getOrientation?: () => unknown;
    };
    const live = (
      store[handleKey] as {
        engine: {
          setSelected(id: string | null): void;
          getSelected(): { id: string } | null;
          getOrientation?: () => unknown;
        };
        settled: Promise<unknown>;
      }
    ).engine;
    await (store[handleKey] as { settled: Promise<unknown> }).settled;

    // A selection made on the *live* engine is what the reader now sees.
    live.setSelected("test_proxy.py");

    return {
      sameObject: (cached as unknown) === (live as unknown),
      cachedIs3D: cached.getOrientation !== undefined,
      liveIs3D: live.getOrientation !== undefined,
      // The trap in one line: the destroyed engine still answers, and answers
      // the past. It does not throw, which is exactly why this is worth a
      // test rather than a comment.
      cachedSelection: cached.getSelected()?.id ?? null,
      liveSelection: live.getSelected()?.id ?? null,
    };
  }, HARNESS_HANDLE_KEY);

  expect(
    trap.sameObject,
    "the engine at the handle key is the same object it was before the view " +
      "swap — publishHarnessHandle is called inside swapEngine, so a swap " +
      "must replace it",
  ).toBe(false);

  expect(
    { cached: trap.cachedIs3D, live: trap.liveIs3D },
    "after a 2D -> 3D swap the cached reference should still be the 2D " +
      "engine and the live one the 3D engine; if both agree, nothing was " +
      "actually swapped",
  ).toEqual({ cached: false, live: true });

  // The whole point. The destroyed engine answered a getter, gave a plausible
  // answer, and the answer was wrong. A spec that cached the handle would
  // assert against this and be green while describing a map nobody is
  // looking at. Re-reading the handle after every swap is the fix, and it is
  // what every other test in this file does.
  expect(
    { cached: trap.cachedSelection, live: trap.liveSelection },
    "the destroyed engine did not report stale state, so this test is no " +
      "longer demonstrating the republish trap it exists to demonstrate — " +
      "check whether destroy() now clears the graph, and re-state the trap",
  ).toEqual({ cached: null, live: "test_proxy.py" });

  expect(pageErrors, "the page threw during the swap").toEqual([]);
});

test("after a successful 3D swap the switch shows the view that was built (AC-5)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await openViewer(page);
  await clickView(page, "3d", HARNESS_HANDLE_KEY);
  const after = await readSwapState(page, HARNESS_HANDLE_KEY);

  // `viewSwitch.setCurrent(built.view)` — built, not requested. Here they
  // coincide, and that is the case worth pinning first: the control and the
  // engine agree when nothing went wrong. The interesting half is below.
  expect(
    {
      is3D: after.is3D,
      pressed2D: after.pressed2D,
      pressed3D: after.pressed3D,
      disabled: after.threeDDisabled,
      reason: after.threeDReason,
    },
    "a successful 3D swap did not leave the 3D engine running with the 3D " +
      "button pressed, enabled and carrying no reason",
  ).toEqual({
    is3D: true,
    pressed2D: "false",
    pressed3D: "true",
    disabled: false,
    reason: "",
  });

  expect(pageErrors, "the page threw during the swap").toEqual([]);
});

test("a 3D constructor that throws leaves a working 2D map and the constructor's own reason (AC-5)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  // **Why this needs an init script rather than a browser without 3D.**
  //
  // `probe3D` (`view.ts:78`) and the `Nebula3DEngine` constructor
  // (`engine3d.ts:212`) ask the *same* canvas the *same* question — both call
  // `getContext("2d")`, because this 3D view is a perspective projection onto
  // a 2D canvas and there is no WebGL anywhere in it. So no environment can
  // produce "probe passes, constructor throws": anything that fails the
  // constructor fails the probe first, and the probe short-circuits.
  //
  // That case is nonetheless the one story 5.7's AC-5 exists for, and the one
  // the ordering comment in `app.ts` says a defect was found in: probe passes,
  // constructor throws, fall back to 2D, and the reader is shown an *enabled*
  // 3D button and no explanation at all.
  //
  // Reaching it means failing the **second** call on the stage canvas. Within
  // one `swapEngine` the sequence is exactly three calls — probe, 3D
  // constructor, 2D fallback constructor — because chrome may not acquire a
  // rendering context at all (`chrome/boundary.test.ts` bans it) and the two
  // calls in `export.ts` are on offscreen canvases during `exportPNG`, which
  // this test never invokes. The count is asserted below rather than assumed:
  // if that sequence ever changes, this test fails loudly instead of quietly
  // measuring something else.
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    const counter = globalThis as unknown as { __stageContextCalls: number };
    counter.__stageContextCalls = 0;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) {
      if (this.id === "stage" && args[0] === "2d") {
        counter.__stageContextCalls += 1;
        // Call 1 is the probe (passes). Call 2 is the 3D constructor, which
        // throws `viz: canvas 2D context unavailable` on a null context. Call
        // 3 is the 2D fallback, which must succeed or there is no map left.
        if (counter.__stageContextCalls === 2) return null;
      }
      return (real as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await openViewer(page, { view: "3d" });
  const after = await readSwapState(page, HARNESS_HANDLE_KEY);
  const contextCalls = await page.evaluate(
    () =>
      (globalThis as unknown as { __stageContextCalls: number })
        .__stageContextCalls,
  );

  expect(
    contextCalls,
    "the stage canvas was not asked for a 2D context exactly three times " +
      "(probe, 3D constructor, 2D fallback), so this test is no longer " +
      "failing the call it means to fail and its result cannot be trusted",
  ).toBe(3);

  // The reader is left with a *working map*, not an error screen. Degrading
  // to 2D with a stated reason is a degradation, not a failure: product
  // principle 1 says the tool always produces a useful result.
  expect(
    { is3D: after.is3D, nodeCount: after.nodeCount },
    "the 3D constructor threw and the reader was not left on a working 2D " +
      "map of the same document",
  ).toEqual({ is3D: false, nodeCount: 6 });

  expect(
    { pressed2D: after.pressed2D, pressed3D: after.pressed3D },
    "3D was requested and could not be built, so the switch must show 2D — " +
      "the view that was built, not the view that was asked for",
  ).toEqual({ pressed2D: "true", pressed3D: "false" });

  expect(
    after.threeDDisabled,
    "the 3D button was left enabled after 3D failed to build. That is the " +
      "defect the setUnavailable ordering in swapEngine exists to prevent: a " +
      "control that does nothing when clicked",
  ).toBe(true);

  // The two halves that make this AC-5 rather than a generic "3D is off".
  //
  // A reason produced by the constructor beats a probe's verdict, because it
  // describes a 3D view that was actually attempted and failed. If
  // `setUnavailable` were changed to probe unconditionally after the swap, the
  // probe would run as a fourth call against a canvas that answers normally,
  // return null, and re-enable the button with an empty reason — so these two
  // assertions are also the negative control for that ordering.
  expect(
    after.threeDReason,
    "the reason shown to the reader is not the one the 3D constructor gave. " +
      "The constructor's message is strictly better evidence than a probe's " +
      "prediction, and unavailabilityAfterSwap prefers it for that reason",
  ).toContain("viz: canvas 2D context unavailable");
  expect(
    after.threeDReason,
    "the reader is being shown the probe's verdict instead of the " +
      "constructor's. The probe passed on this page — it ran first and got a " +
      "real context — so its wording appearing here means the constructor's " +
      "reason was overwritten by a probe run after the swap",
  ).not.toContain("privacy setting");

  expect(
    pageErrors,
    "the page threw; a 3D constructor failure is meant to be caught and " +
      "degraded, never surfaced as an unhandled error",
  ).toEqual([]);
});
