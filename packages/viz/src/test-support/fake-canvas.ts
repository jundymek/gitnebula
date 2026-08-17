/**
 * Test-only: a recording 2D context.
 *
 * jsdom has no canvas implementation, and pixels are the wrong assertion
 * anyway — the encoding rules are "this colour, this radius, this curve", so
 * the tests read the calls the renderer made rather than the image it drew.
 */

export interface DrawCall {
  readonly op: string;
  readonly args: readonly unknown[];
}

export interface FakeContext {
  readonly calls: DrawCall[];
  /** Fill styles in the order they were assigned. */
  readonly fillStyles: string[];
  readonly strokeStyles: string[];
  /** Colour stops of every radial gradient created, in creation order. */
  readonly gradients: { offset: number; color: string }[][];
  readonly context: CanvasRenderingContext2D;
}

export function createFakeContext(): FakeContext {
  const calls: DrawCall[] = [];
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const gradients: { offset: number; color: string }[][] = [];

  const record =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args });
    };

  const context = {
    globalAlpha: 1,
    lineWidth: 1,
    font: "",
    textAlign: "start",
    set fillStyle(value: string | CanvasGradient) {
      if (typeof value === "string") fillStyles.push(value);
      calls.push({ op: "set:fillStyle", args: [value] });
    },
    get fillStyle(): string {
      return fillStyles[fillStyles.length - 1] ?? "";
    },
    set strokeStyle(value: string) {
      strokeStyles.push(value);
      calls.push({ op: "set:strokeStyle", args: [value] });
    },
    get strokeStyle(): string {
      return strokeStyles[strokeStyles.length - 1] ?? "";
    },
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    quadraticCurveTo: record("quadraticCurveTo"),
    arc: record("arc"),
    fill: record("fill"),
    stroke: record("stroke"),
    // Story 5.6's co-change ring is dashed, and the dash is the encoding —
    // so the recorder has to see it. A context that silently lacks a call the
    // renderer makes is a hole in the recorder, not a reason to draw dashes
    // by hand.
    setLineDash: record("setLineDash"),
    fillText: record("fillText"),
    setTransform: record("setTransform"),
    /**
     * Text metrics (story 5.7). The 2D renderer draws labels without measuring
     * them, so nothing needed this before; the 3D view budgets labels against
     * an occupancy grid and has to know how wide one is.
     *
     * A monospace approximation rather than a real measurement — the renderer
     * asks for a monospace font, and the tests assert on *which* labels were
     * drawn and where, never on their exact pixel width.
     */
    measureText(text: unknown) {
      const size = Number.parseFloat(String(context.font)) || 10;
      calls.push({ op: "measureText", args: [text] });
      return { width: String(text).length * size * 0.6 };
    },
    createRadialGradient(...args: unknown[]) {
      const stops: { offset: number; color: string }[] = [];
      gradients.push(stops);
      calls.push({ op: "createRadialGradient", args });
      return {
        addColorStop(offset: number, color: string) {
          stops.push({ offset, color });
        },
      };
    },
  };

  return {
    calls,
    fillStyles,
    strokeStyles,
    gradients,
    context: context as unknown as CanvasRenderingContext2D,
  };
}

/**
 * Points every canvas in the document at a recording context and gives it a
 * size, so `CanvasGraphEngine` can be constructed under jsdom.
 */
export function installFakeCanvas(width = 1200, height = 800): FakeContext {
  const fake = createFakeContext();
  HTMLCanvasElement.prototype.getContext = (() =>
    fake.context) as unknown as HTMLCanvasElement["getContext"];
  HTMLElement.prototype.getBoundingClientRect = (() => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  })) as HTMLElement["getBoundingClientRect"];
  return fake;
}
