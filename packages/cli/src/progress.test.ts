import { describe, expect, it } from "vitest";

import { StageError } from "./errors.js";
import { createReporter, formatElapsed } from "./progress.js";

/** A clock that advances a fixed step per read, so elapsed times are exact. */
function steppedClock(stepMs: number): () => number {
  let value = 0;
  return () => {
    const current = value;
    value += stepMs;
    return current;
  };
}

function capture(options: { isTty?: boolean; stepMs?: number } = {}) {
  const chunks: string[] = [];
  const reporter = createReporter({
    write: (chunk) => chunks.push(chunk),
    isTty: options.isTty ?? false,
    now: steppedClock(options.stepMs ?? 250),
  });
  return { reporter, chunks, output: () => chunks.join("") };
}

describe("formatElapsed", () => {
  it("renders sub-minute durations in seconds", () => {
    expect(formatElapsed(420)).toBe("0.42s");
    expect(formatElapsed(59_994)).toBe("59.99s");
  });

  it("renders longer durations in minutes and seconds", () => {
    expect(formatElapsed(63_500)).toBe("1m 3.5s");
  });
});

describe("stage reporting (AC-2)", () => {
  it("prints a start line and an end line carrying the elapsed time", async () => {
    const { reporter, output } = capture({ stepMs: 250 });

    await reporter.runStage("scan", async () => "done");

    expect(output()).toBe("▸ scan\n✔ scan (0.25s)\n");
  });

  it("returns the stage's value to the caller", async () => {
    const { reporter } = capture();
    await expect(reporter.runStage("scan", async () => 41 + 1)).resolves.toBe(
      42,
    );
  });

  it("renders within-stage counts from onProgress", async () => {
    const { reporter, output } = capture();

    await reporter.runStage("scan", async (onProgress) => {
      onProgress(0, 10);
      onProgress(5, 10);
      onProgress(10, 10);
    });

    expect(output()).toContain("  scan 0/10\n");
    expect(output()).toContain("  scan 5/10\n");
    expect(output()).toContain("  scan 10/10\n");
  });

  it("steps non-TTY counts by decile instead of printing every file", async () => {
    const { reporter, chunks } = capture();

    await reporter.runStage("scan", async (onProgress) => {
      for (let done = 0; done <= 1000; done += 1) onProgress(done, 1000);
    });

    const counts = chunks.filter((chunk) => chunk.startsWith("  scan "));
    expect(counts).toHaveLength(11);
  });

  it("ignores a zero total rather than dividing by it", async () => {
    const { reporter, output } = capture();

    await reporter.runStage("scan", async (onProgress) => onProgress(0, 0));

    expect(output()).toBe("▸ scan\n✔ scan (0.25s)\n");
  });

  it("rewrites one line on a TTY", async () => {
    const { reporter, output } = capture({ isTty: true });

    await reporter.runStage("scan", async (onProgress) => {
      onProgress(1, 2);
      onProgress(2, 2);
    });

    expect(output()).toBe("▸ scan\n\r  scan 1/2\r  scan 2/2\n✔ scan (0.25s)\n");
  });

  it("marks a failed stage and re-throws the StageError untouched", async () => {
    const { reporter, output } = capture();
    const failure = new StageError("scan", "cause", "remedy");

    await expect(
      reporter.runStage("scan", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(output()).toBe("▸ scan\n✖ scan (0.25s)\n");
  });

  it("wraps a bare throw in the AD-7 shape, named after the stage", async () => {
    const { reporter } = capture();

    const error = await reporter
      .runStage("deps", async () => {
        throw new Error("cannot read tsconfig.json");
      })
      .catch((thrown: unknown) => thrown as StageError);

    expect(error).toBeInstanceOf(StageError);
    expect(error.stage).toBe("deps");
    expect(error.message).toMatch(/^deps: cannot read tsconfig\.json — .+$/);
  });

  it("degrades to plain lines while two stages overlap", async () => {
    const { reporter, output } = capture({ isTty: true });

    let releaseFirst: () => void = () => {};
    const blocked = new Promise<void>((resolveBlocked) => {
      releaseFirst = resolveBlocked;
    });

    const first = reporter.runStage("deps", async (onProgress) => {
      await blocked;
      onProgress(1, 2);
    });
    const second = reporter.runStage("githist", async (onProgress) => {
      onProgress(1, 2);
      releaseFirst();
    });

    await Promise.all([first, second]);

    expect(output()).not.toContain("\r");
    expect(output()).toContain("  githist 1/2\n");
    expect(output()).toContain("  deps 1/2\n");
  });
});
