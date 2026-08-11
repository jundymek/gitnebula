import { describe, expect, it } from "vitest";
import {
  SETTLE_DISPLACEMENT_PX,
  SETTLE_FRAMES,
  SettleDetector,
  SettleGate,
} from "./settle.js";

function nodesAt(offset: number) {
  return [
    { x: 0 + offset, y: 0 },
    { x: 10 + offset, y: 10 },
  ];
}

describe("Settled constants", () => {
  // AD-6 fixes these numbers; the FR-12 test, the replay control and the
  // reduced-motion path all read them. Pinning the literals here means a
  // silent retune shows up as a failing test rather than as drifting evidence.
  it("match AD-6: < 0.5 px/frame for 30 consecutive frames", () => {
    expect(SETTLE_DISPLACEMENT_PX).toBe(0.5);
    expect(SETTLE_FRAMES).toBe(30);
  });
});

describe("SettleDetector", () => {
  it("settles on the 30th consecutive quiet frame, not before", () => {
    const d = new SettleDetector();
    d.frame(nodesAt(0)); // baseline frame establishes previous positions
    for (let i = 0; i < 29; i++) {
      expect(d.frame(nodesAt(0))).toBe(false);
    }
    expect(d.frame(nodesAt(0))).toBe(true);
  });

  it("does not settle while any node moves >= 0.5 px/frame", () => {
    const d = new SettleDetector();
    d.frame(nodesAt(0));
    for (let i = 1; i <= 60; i++) {
      expect(d.frame(nodesAt(i * 0.6))).toBe(false);
    }
  });

  it("treats displacement just under the bound as quiet", () => {
    const d = new SettleDetector();
    d.frame(nodesAt(0));
    for (let i = 1; i < 30; i++) {
      expect(d.frame(nodesAt(i * 0.49))).toBe(false);
    }
    expect(d.frame(nodesAt(30 * 0.49))).toBe(true);
  });

  it("resets the quiet streak on a single loud frame", () => {
    const d = new SettleDetector();
    d.frame(nodesAt(0));
    for (let i = 0; i < 29; i++) d.frame(nodesAt(0));
    expect(d.frame(nodesAt(5))).toBe(false); // loud frame breaks the streak
    for (let i = 0; i < 29; i++) {
      expect(d.frame(nodesAt(5))).toBe(false); // streak restarts from zero
    }
    expect(d.frame(nodesAt(5))).toBe(true);
  });

  it("measures displacement in 2D, not per axis", () => {
    const d = new SettleDetector();
    d.frame([{ x: 0, y: 0 }]);
    d.frame([{ x: 3, y: 4 }]);
    expect(d.lastMaxDisplacement).toBeCloseTo(5); // hypot, not max(dx, dy)
  });
});

describe("SettleGate", () => {
  it("stops on Settled and reports no timeout", () => {
    const gate = new SettleGate(1000);
    let frames = 0;
    while (!gate.frame(nodesAt(0))) frames++;
    expect(gate.settled).toBe(true);
    expect(gate.timedOut).toBe(false);
    expect(gate.frames).toBe(frames + 1);
  });

  it("stops at the cap and reports a timeout instead of a false Settled", () => {
    const gate = new SettleGate(50);
    let i = 0;
    // Never quiet: every frame moves far more than the Settled bound.
    while (!gate.frame(nodesAt((i += 100)))) {
      if (gate.frames > 200) throw new Error("gate never stopped");
    }
    expect(gate.frames).toBe(50);
    expect(gate.settled).toBe(false);
    expect(gate.timedOut).toBe(true);
  });

  it("keeps the cap out of the way of a genuine late settle", () => {
    const gate = new SettleGate(SETTLE_FRAMES + 10);
    for (let i = 0; i < 5; i++) gate.frame(nodesAt(i * 100)); // loud start
    let done = false;
    while (!done && gate.frames < SETTLE_FRAMES + 10)
      done = gate.frame(nodesAt(500));
    expect(done).toBe(true);
    expect(gate.timedOut).toBe(false);
  });
});
