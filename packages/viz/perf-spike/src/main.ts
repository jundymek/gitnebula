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
import { FpsRecorder } from "./fps.js";
import { loadFixture, type FixtureEdge } from "./fixture.js";
import { seededRng } from "./prng.js";
import { SETTLE_DISPLACEMENT_PX, SettleDetector } from "./settle.js";
import {
  NonMemberDisplacementTracker,
  UNFOLD_ZOOM,
  unfoldedModules,
  type Camera,
  type ModuleNode,
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
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = "#0a0e1a"; // mockup dark canvas
  ctx.fillRect(0, 0, width, height);
  ctx.save();
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
  const vp = { width: canvas.width, height: canvas.height };

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
  const settle = new SettleDetector();
  let settleFrames = 0;
  recorder.start("a-active-all-nodes");
  await new Promise<void>((resolve) => {
    const frame = (t: number) => {
      const w0 = performance.now();
      globalSim.tick();
      settleFrames++;
      draw(ctx, nodes, allLinks, { cx: 0, cy: 0, k: 0.4 }, () => true);
      recorder.tick(t, performance.now() - w0);
      // Cap the phase so a non-converging layout cannot hang the run.
      if (
        settle.frame(nodes as { x: number; y: number }[]) ||
        settleFrames > 3000
      )
        resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const settledInFrames = settleFrames;

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
    draw(ctx, nodes, moduleLinks, cam, (n) => n.kind === "module");
    recorder.tick(t, performance.now() - w0);
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
    sim: Simulation<SimNode, undefined>;
    members: SimNode[];
    detector: SettleDetector;
    links: SimLink[];
  }

  function startWake(moduleIds: string[]): Wake {
    const members: SimNode[] = [];
    const anchors: SimNode[] = [];
    for (const id of moduleIds) {
      const parent = nodeById.get(id)!;
      anchors.push(parent);
      for (const f of filesByModule.get(id) ?? []) {
        // Members spawn at their module's position (ADR-0006).
        f.x = parent.x! + (rng() - 0.5) * 4;
        f.y = parent.y! + (rng() - 0.5) * 4;
        f.vx = 0;
        f.vy = 0;
        members.push(f);
      }
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
    const sim = forceSimulation([...anchors, ...members])
      .force("charge", forceManyBody().strength(-30))
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(40),
      )
      .alphaDecay(0.02)
      .stop();
    return { sim, members, detector: new SettleDetector(), links };
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
  let peakShownFiles = 0;
  let peakSimulatedNodes = 0;

  recorder.start("c-viewport-unfold");
  await playScript(phaseCScript(layoutBounds), (cam, t) => {
    const w0 = performance.now();

    const want = unfoldedModules(moduleNodes, cam, vp);
    const newly = [...want].filter((id) => !unfolded.has(id));
    if (newly.length > 0) {
      unfoldEvents++;
      for (const id of newly) unfolded.add(id);
      const wake = startWake(newly);
      wakes.push(wake);
      for (const f of wake.members) shownFiles.add(f);
      peakShownFiles = Math.max(peakShownFiles, shownFiles.size);
      shownLinks = [
        ...moduleLinks,
        ...wakes.flatMap((w) => w.links),
        ...[...shownFiles].map((f) => ({
          source: nodeById.get(f.parent!)!,
          target: f,
        })),
      ];
      // Non-members: every file on screen that no live wake is simulating.
      const waking = new Set(wakes.flatMap((w) => w.members));
      nonMemberFiles = [...shownFiles].filter((f) => !waking.has(f));
      cumulativeTracker.capture(
        nodes as { id: string; x: number; y: number }[],
        new Set([...waking].map((n) => n.id)),
      );
      perFrameNonMember.reset();
    }

    let simulatedNow = 0;
    for (const w of wakes) {
      w.sim.tick();
      simulatedNow += w.members.length;
    }
    peakSimulatedNodes = Math.max(peakSimulatedNodes, simulatedNow);
    const afterTicks = performance.now();
    // Freeze-on-settle: a wake that has settled stops being ticked entirely.
    wakes = wakes.filter(
      (w) => !w.detector.frame(w.members as { x: number; y: number }[]),
    );

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
    draw(ctx, nodes, shownLinks, cam, isVisibleAt(cam));
    recorder.tick(t, afterTicks - w0 + (performance.now() - beforeDraw));
  });
  recorder.finish();

  function isVisibleAt(cam: Camera) {
    return (n: SimNode): boolean =>
      n.kind === "module" || (cam.k >= UNFOLD_ZOOM && shownFiles.has(n));
  }

  const results = {
    fixtureSource: fixture.source,
    nodeCount: nodes.length,
    moduleCount: moduleNodes.length,
    fileCount: nodes.length - moduleNodes.length,
    edgeCount: allEdges.length,
    seed: SEED_NAME,
    phases: recorder.results,
    settledInFrames,
    layoutBounds,
    frozenDriftPx: frozenDrift,
    unfoldEvents,
    peakShownFiles,
    peakSimulatedNodes,
    nonMemberMaxPerFrameDisplacementPx: maxNonMemberPerFrame,
    nonMemberMaxCumulativeDisplacementPx: maxNonMemberCumulative,
    pinnedModuleMaxPerFrameDisplacementPx: maxModulePerFrame,
    settledBoundPx: SETTLE_DISPLACEMENT_PX,
    canvas: { width: canvas.width, height: canvas.height, devicePixelRatio },
    userAgent: navigator.userAgent,
  };

  status.textContent = "done";
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
