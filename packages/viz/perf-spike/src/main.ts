/**
 * Perf spike page (story 1.4). The page is throwaway; the measurement parts
 * (fps.ts, settle.ts, camera-script.ts) are meant to survive into story 3.5's
 * CI harness.
 *
 * Three measured phases per AC-1:
 *  (a) active d3-force simulation of ALL nodes (2,000 files + 100 modules),
 *  (b) frozen simulation + scripted pan/zoom,
 *  (c) viewport-scoped unfold while panning at >= 1.8x zoom (local wake).
 *
 * The run is fully scripted (AC-2): no pointer input takes part. Results land
 * in #results as JSON and in the console as one `SPIKE_RESULTS {...}` line.
 */

import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import type { Simulation, SimulationNodeDatum } from "d3-force";
import {
  cameraAt,
  phaseBScript,
  phaseCScript,
  scriptDurationMs,
  type CameraKeyframe,
} from "./camera-script.js";
import { FpsRecorder, VisibilityWatch } from "./fps.js";
import { loadFixture, type FixtureEdge } from "./fixture.js";
import { seededRng } from "./prng.js";
import {
  SETTLE_DISPLACEMENT_PX,
  SettleDetector,
  SettleGate,
} from "./settle.js";
import {
  NonMemberDisplacementTracker,
  UNFOLD_ZOOM,
  cssViewport,
  unfoldTransition,
  unfoldedModules,
  type Camera,
  type ModuleNode,
  type Viewport,
} from "./unfold.js";

interface SimNode extends SimulationNodeDatum {
  id: string;
  kind: "module" | "file";
  parent?: string;
  r: number;
}

type SimLink = { source: SimNode | string; target: SimNode | string };

/** Radius of the seeded initial scatter; the settled extent is measured. */
const INITIAL_SCATTER_RADIUS = 600;
const MODULE_RADIUS = 14;
const FILE_RADIUS = 3;
const SEED_NAME = "gitnebula-spike";
/** Frames phase (a) may run before the run is declared non-converging. */
const SETTLE_FRAME_CAP = 3000;

function makeSimulation(
  nodes: SimNode[],
  links: SimLink[],
): Simulation<SimNode, undefined> {
  return (
    forceSimulation(nodes)
      // forceManyBody is Barnes-Hut (quadtree approximation, theta 0.9 default).
      .force("charge", forceManyBody().strength(-30))
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(40),
      )
      .force("center", forceCenter(0, 0))
      .alphaDecay(0.02)
      // Ticked manually on rAF so measured fps covers simulation AND render.
      .stop()
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  nodes: readonly SimNode[],
  links: readonly SimLink[],
  cam: Camera,
  visible: (n: SimNode) => boolean,
  vp: Viewport,
): void {
  // Everything below is in CSS pixels; the DPR transform is what turns them
  // into the canvas's device pixels. Drawing in device pixels instead would
  // divide the effective zoom by the DPR, so a Retina run would cover more
  // world, unfold more modules and draw smaller nodes than a DPR-1 run —
  // native rasterisation is wanted, a different camera is not.
  const { width, height } = vp;
  ctx.save();
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = "#0a0e1a"; // mockup dark canvas
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.scale(cam.k, cam.k);
  ctx.translate(-cam.cx, -cam.cy);

  ctx.strokeStyle = "rgba(120,140,190,0.25)";
  ctx.lineWidth = 1 / cam.k;
  ctx.beginPath();
  for (const l of links) {
    const s = l.source as SimNode;
    const t = l.target as SimNode;
    if (!visible(s) || !visible(t)) continue;
    ctx.moveTo(s.x!, s.y!);
    ctx.lineTo(t.x!, t.y!);
  }
  ctx.stroke();

  for (const n of nodes) {
    if (!visible(n)) continue;
    ctx.fillStyle = n.kind === "module" ? "#7aa2f7" : "#9ece6a";
    ctx.beginPath();
    ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function playScript(
  script: readonly CameraKeyframe[],
  onFrame: (cam: Camera, tMs: number) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let start: number | null = null;
    const frame = (t: number) => {
      if (start === null) start = t;
      const elapsed = t - start;
      onFrame(cameraAt(script, elapsed), t);
      if (elapsed >= scriptDurationMs(script)) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function run(): Promise<void> {
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const ctx = canvas.getContext("2d")!;
  const status = document.getElementById("status")!;

  const rng = seededRng(SEED_NAME);
  const fixture = await loadFixture(rng);

  const nodes: SimNode[] = fixture.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    parent: n.parent,
    r: n.kind === "module" ? MODULE_RADIUS : FILE_RADIUS,
    x: (rng() - 0.5) * INITIAL_SCATTER_RADIUS * 2,
    y: (rng() - 0.5) * INITIAL_SCATTER_RADIUS * 2,
  }));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const allEdges: FixtureEdge[] = fixture.edges.filter(
    (e) => nodeById.has(e.source) && nodeById.has(e.target),
  );

  const recorder = new FpsRecorder();
  // Every measured frame is checked: a hidden tab throttles rAF and would
  // otherwise produce a normal-looking, entirely fictional result.
  const visibility = new VisibilityWatch(() => document.hidden);
  // rAF can be suspended outright on a background tab, in which case no frame
  // callback ever observes the hidden state — the event is the only witness.
  document.addEventListener("visibilitychange", () =>
    visibility.visibilityChanged(),
  );
  // CSS pixels, not the canvas backing store — see cssViewport.
  const vp = cssViewport(canvas, devicePixelRatio);

  // ---- Phase (a): every node active until Settled --------------------------
  // Deliberately the worst case ADR-0006 exists to avoid — measured to show
  // what the mechanism buys.
  status.textContent = "phase a — active simulation, all nodes";
  // Membership is `parent` in the contract, not an edge (ADR-0005) — the
  // viewer derives member relations. The layout needs them too: without a
  // module-to-member attraction the module graph and the file graph are two
  // disconnected components and drift apart into separate clusters.
  const memberLinks: SimLink[] = nodes
    .filter((n) => n.kind === "file" && n.parent !== undefined)
    .map((n) => ({ source: n.parent!, target: n.id }));
  const importLinks: SimLink[] = allEdges.map((e) => ({
    source: e.source,
    target: e.target,
  }));
  const allLinks: SimLink[] = [...importLinks, ...memberLinks];
  const globalSim = makeSimulation(nodes, allLinks);
  // The cap stops a non-converging layout from hanging the run. It is NOT a
  // success path: phases (b) and (c) both assume a frozen, settled layout, so
  // a capped run's numbers are not this story's evidence and the gate records
  // that distinction (see settleTimedOut in the results).
  const settleGate = new SettleGate(SETTLE_FRAME_CAP);
  recorder.start("a-active-all-nodes");
  await new Promise<void>((resolve) => {
    const frame = (t: number) => {
      const w0 = performance.now();
      globalSim.tick();
      draw(ctx, nodes, allLinks, { cx: 0, cy: 0, k: 0.4 }, () => true, vp);
      recorder.tick(t, performance.now() - w0);
      visibility.frame();
      if (settleGate.frame(nodes as { x: number; y: number }[])) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const settledInFrames = settleGate.frames;
  if (settleGate.timedOut) {
    console.error(
      `SPIKE_INVALID: global layout did not settle within ${SETTLE_FRAME_CAP} ` +
        `frames (last max displacement ${settleGate.lastMaxDisplacement.toFixed(2)} px). ` +
        "Phases b and c assume a settled layout — these numbers are not evidence.",
    );
  }

  // ---- Phase (b): frozen layout + scripted pan/zoom ------------------------
  status.textContent = "phase b — frozen, scripted pan/zoom";
  const moduleSimNodes = nodes.filter((n) => n.kind === "module");
  const moduleNodes: ModuleNode[] = moduleSimNodes.map((n) => ({
    id: n.id,
    x: n.x!,
    y: n.y!,
    r: n.r,
  }));
  const moduleLinks: SimLink[] = allLinks.filter(
    (l) =>
      (nodeById.get(l.source as string) ?? (l.source as SimNode)).kind ===
        "module" &&
      (nodeById.get(l.target as string) ?? (l.target as SimNode)).kind ===
        "module",
  );
  const layoutBounds = {
    minX: Math.min(...moduleNodes.map((m) => m.x)),
    maxX: Math.max(...moduleNodes.map((m) => m.x)),
    minY: Math.min(...moduleNodes.map((m) => m.y)),
    maxY: Math.max(...moduleNodes.map((m) => m.y)),
  };
  const frozenAt = moduleSimNodes.map((n) => ({ x: n.x!, y: n.y! }));
  recorder.start("b-frozen-pan-zoom");
  await playScript(phaseBScript(layoutBounds), (cam, t) => {
    const w0 = performance.now();
    // Frozen: the simulation is never ticked in this phase.
    draw(ctx, nodes, moduleLinks, cam, (n) => n.kind === "module", vp);
    recorder.tick(t, performance.now() - w0);
    visibility.frame();
  });
  const frozenDrift = Math.max(
    ...moduleSimNodes.map((n, i) =>
      Math.hypot(n.x! - frozenAt[i]!.x, n.y! - frozenAt[i]!.y),
    ),
  );

  // ---- Phase (c): viewport-scoped unfold while panning at 2.2x -------------
  status.textContent = "phase c — viewport unfold while panning";
  // Module positions stay pinned during local settle (ADR-0006 consequence).
  for (const m of moduleSimNodes) {
    m.fx = m.x;
    m.fy = m.y;
  }

  const filesByModule = new Map<string, SimNode[]>();
  for (const n of nodes) {
    if (n.kind === "file" && n.parent) {
      const list = filesByModule.get(n.parent);
      if (list) list.push(n);
      else filesByModule.set(n.parent, [n]);
    }
  }

  /**
   * One wake = one short-lived simulation over the members of the modules
   * that just entered the viewport, plus their pinned modules as anchors.
   * It runs until Settled and is then dropped (freeze-on-settle, addendum
   * A4). Nothing else is ever ticked, which is what makes the wake local.
   *
   * Two things that look like details are the whole mechanism:
   *  - no forceCenter here: centering acts on every node in the simulation,
   *    so it drags already-settled files across the map on every wake;
   *  - only the newly woken members are simulation nodes, so previously
   *    unfolded files are untouchable by construction.
   */
  interface Wake {
    moduleId: string;
    sim: Simulation<SimNode, undefined>;
    members: SimNode[];
    detector: SettleDetector;
    links: SimLink[];
  }

  /**
   * One wake per module, not per batch of modules entering together: a module
   * leaving the viewport must collapse on its own (ADR-0006), and a wake that
   * spanned several modules could not be taken apart without re-seeding the
   * survivors' positions. Simulated links are therefore the module's member
   * links plus its intra-module imports; imports that cross to another
   * unfolded module are still *drawn* (see shownLinks) but are not a force —
   * which is also exactly what AC-5 claims, that unfolding a module wakes only
   * its own members.
   */
  function startWake(moduleId: string): Wake {
    const parent = nodeById.get(moduleId)!;
    const members: SimNode[] = [];
    for (const f of filesByModule.get(moduleId) ?? []) {
      // Members spawn at their module's position (ADR-0006).
      f.x = parent.x! + (rng() - 0.5) * 4;
      f.y = parent.y! + (rng() - 0.5) * 4;
      f.vx = 0;
      f.vy = 0;
      members.push(f);
    }
    const memberSet = new Set(members);
    const links: SimLink[] = [
      ...members.map((f) => ({ source: nodeById.get(f.parent!)!, target: f })),
      ...allEdges
        .map((e) => ({
          source: nodeById.get(e.source)!,
          target: nodeById.get(e.target)!,
        }))
        .filter((l) => memberSet.has(l.source) && memberSet.has(l.target)),
    ];
    const sim = forceSimulation([parent, ...members])
      .force("charge", forceManyBody().strength(-30))
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(40),
      )
      .alphaDecay(0.02)
      .stop();
    return { moduleId, sim, members, detector: new SettleDetector(), links };
  }

  const unfolded = new Set<string>();
  const shownFiles = new Set<SimNode>();
  let wakes: Wake[] = [];
  let shownLinks: SimLink[] = [];

  // AC-5 evidence: per-frame displacement (directly comparable to the Settled
  // bound) and cumulative drift, measured over nodes that are NOT members of
  // any currently-waking module. Modules are reported separately because
  // pinning makes their zero trivial — the interesting number is the one for
  // already-unfolded files.
  const cumulativeTracker = new NonMemberDisplacementTracker();
  const perFrameNonMember = new SettleDetector();
  let nonMemberFiles: SimNode[] = [];
  let maxNonMemberPerFrame = 0;
  let maxNonMemberCumulative = 0;
  let maxModulePerFrame = 0;
  const modulePerFrame = new SettleDetector();
  let unfoldEvents = 0;
  let collapseEvents = 0;
  let peakShownFiles = 0;
  let peakSimulatedNodes = 0;
  let peakShownLinks = 0;
  let peakUnfoldedModules = 0;

  /**
   * Re-partitions the on-screen files into "a live wake is simulating this"
   * and "this is frozen" — the latter is what AC-5 measures.
   *
   * Must run on every change to the wake set, not only on viewport
   * transitions. A wake also disappears when it settles, and its files become
   * frozen non-members at that moment; leaving them out until the next unfold
   * or collapse would exclude them from the measurement for exactly the
   * interval where they are most likely to still be drifting, which
   * under-reports the number AC-5 rests on.
   */
  function refreshNonMembers(): void {
    const waking = new Set(wakes.flatMap((w) => w.members));
    nonMemberFiles = [...shownFiles].filter((f) => !waking.has(f));
    cumulativeTracker.capture(
      nodes as { id: string; x: number; y: number }[],
      new Set([...waking].map((n) => n.id)),
    );
    perFrameNonMember.reset();
  }

  recorder.start("c-viewport-unfold");
  await playScript(phaseCScript(layoutBounds), (cam, t) => {
    const w0 = performance.now();

    const want = unfoldedModules(moduleNodes, cam, vp);
    const { entered, left, changed } = unfoldTransition(unfolded, want);
    if (changed) {
      for (const id of entered) {
        unfoldEvents++;
        unfolded.add(id);
        const wake = startWake(id);
        wakes.push(wake);
        for (const f of wake.members) shownFiles.add(f);
      }
      for (const id of left) {
        collapseEvents++;
        unfolded.delete(id);
        // Collapsing drops the module's wake outright — its members stop being
        // simulated and stop being drawn, which is the whole point of the
        // viewport scope. Their positions are left where they were; a module
        // re-entering the viewport re-spawns its members at the module anyway.
        for (const f of filesByModule.get(id) ?? []) shownFiles.delete(f);
      }
      if (left.size > 0) wakes = wakes.filter((w) => unfolded.has(w.moduleId));
      peakShownFiles = Math.max(peakShownFiles, shownFiles.size);
      peakUnfoldedModules = Math.max(peakUnfoldedModules, unfolded.size);
      // Rendered links must describe everything currently unfolded, not just
      // what is still being simulated: a wake is dropped once it settles, so
      // deriving the rendered set from live wakes silently stops drawing the
      // import edges of every module that already came to rest, and the
      // measured render cost drifts below the real one. Rebuilt from
      // shownFiles instead, which also picks up imports that cross between two
      // unfolded modules — those belong to no single wake.
      shownLinks = [
        ...moduleLinks,
        ...[...shownFiles].map((f) => ({
          source: nodeById.get(f.parent!)!,
          target: f,
        })),
        ...allEdges
          .map((e) => ({
            source: nodeById.get(e.source)!,
            target: nodeById.get(e.target)!,
          }))
          .filter((l) => shownFiles.has(l.source) && shownFiles.has(l.target)),
      ];
      refreshNonMembers();
    }

    let simulatedNow = 0;
    for (const w of wakes) {
      w.sim.tick();
      simulatedNow += w.members.length;
    }
    peakSimulatedNodes = Math.max(peakSimulatedNodes, simulatedNow);
    peakShownLinks = Math.max(peakShownLinks, shownLinks.length);
    const afterTicks = performance.now();
    // Freeze-on-settle: a wake that has settled stops being ticked entirely.
    const wakesBefore = wakes.length;
    wakes = wakes.filter(
      (w) => !w.detector.frame(w.members as { x: number; y: number }[]),
    );
    // Its files are frozen non-members from this frame on, so the AC-5
    // partition has to follow — see refreshNonMembers.
    if (wakes.length !== wakesBefore) refreshNonMembers();

    if (nonMemberFiles.length > 0) {
      perFrameNonMember.frame(nonMemberFiles as { x: number; y: number }[]);
      const d = perFrameNonMember.lastMaxDisplacement;
      if (Number.isFinite(d) && d > maxNonMemberPerFrame)
        maxNonMemberPerFrame = d;
      maxNonMemberCumulative = Math.max(
        maxNonMemberCumulative,
        cumulativeTracker.maxDisplacement(
          nodes as { id: string; x: number; y: number }[],
        ),
      );
    }
    modulePerFrame.frame(moduleSimNodes as { x: number; y: number }[]);
    if (Number.isFinite(modulePerFrame.lastMaxDisplacement)) {
      maxModulePerFrame = Math.max(
        maxModulePerFrame,
        modulePerFrame.lastMaxDisplacement,
      );
    }

    // AC-5 instrumentation above is spike-only, so it is excluded from the
    // frame budget: work = wake handling + simulation ticks + render.
    const beforeDraw = performance.now();
    draw(ctx, nodes, shownLinks, cam, isVisibleAt(cam), vp);
    recorder.tick(t, afterTicks - w0 + (performance.now() - beforeDraw));
    visibility.frame();
  });
  recorder.finish();

  function isVisibleAt(cam: Camera) {
    return (n: SimNode): boolean =>
      n.kind === "module" || (cam.k >= UNFOLD_ZOOM && shownFiles.has(n));
  }

  if (!visibility.valid) {
    console.error(
      `SPIKE_INVALID: the tab was hidden during the run ` +
        `(${visibility.hiddenFrames} throttled frame(s) observed). ` +
        "Chrome throttles or suspends requestAnimationFrame in the background — " +
        "re-run with the spike tab visible and in front.",
    );
  }
  // The three ways a run can look normal and mean nothing. Recorded in the
  // results, so a committed results file cannot quietly be one of them.
  const runValid =
    !settleGate.timedOut &&
    visibility.valid &&
    fixture.source === "contract-fixture";

  const results = {
    runValid,
    fixtureSource: fixture.source,
    nodeCount: nodes.length,
    moduleCount: moduleNodes.length,
    fileCount: nodes.length - moduleNodes.length,
    edgeCount: allEdges.length,
    seed: SEED_NAME,
    phases: recorder.results,
    settledInFrames,
    // True means phase (a) hit SETTLE_FRAME_CAP without ever going quiet. The
    // whole run is then invalid as evidence, because (b) and (c) measure a
    // layout that was frozen mid-motion rather than a settled one.
    settleTimedOut: settleGate.timedOut,
    settleFrameCap: SETTLE_FRAME_CAP,
    // Non-zero means the tab was backgrounded mid-run: rAF was throttled and
    // every fps number below describes the throttle, not the renderer.
    hiddenFrames: visibility.hiddenFrames,
    documentEverHidden: visibility.everHidden,
    layoutBounds,
    frozenDriftPx: frozenDrift,
    unfoldEvents,
    collapseEvents,
    peakUnfoldedModules,
    peakShownFiles,
    peakShownLinks,
    peakSimulatedNodes,
    nonMemberMaxPerFrameDisplacementPx: maxNonMemberPerFrame,
    nonMemberMaxCumulativeDisplacementPx: maxNonMemberCumulative,
    pinnedModuleMaxPerFrameDisplacementPx: maxModulePerFrame,
    settledBoundPx: SETTLE_DISPLACEMENT_PX,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      cssWidth: vp.width,
      cssHeight: vp.height,
      devicePixelRatio,
    },
    userAgent: navigator.userAgent,
  };

  status.textContent = runValid ? "done" : "done — INVALID RUN, see console";
  document.getElementById("results")!.textContent = JSON.stringify(
    results,
    null,
    2,
  );
  console.log("SPIKE_RESULTS " + JSON.stringify(results));
  // Hand the numbers to the dev server so a scripted run does not depend on
  // copying them out of the console by hand (dev-only sink, see vite.config).
  void fetch("/spike-results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(results),
  }).catch(() => undefined);
}

run().catch((err: unknown) => {
  document.getElementById("status")!.textContent = "ERROR: " + String(err);
  console.error(err);
});
