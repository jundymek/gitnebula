import { describe, expect, it } from "vitest";

import type { RawChange, RawCommit } from "./git-log.js";
import { RenameChain, resolvedPaths } from "./renames.js";

function commit(hash: string, ...changes: RawChange[]): RawCommit {
  return { hash, committedAt: 1, authorEmail: "a@b.c", changes };
}

const renamed = (oldPath: string, path: string): RawChange => ({
  status: "R",
  oldPath,
  path,
});

const modified = (path: string): RawChange => ({ status: "M", path });

describe("RenameChain", () => {
  it("leaves a path that was never renamed alone", () => {
    expect(new RenameChain().resolve("web/api.ts")).toBe("web/api.ts");
  });

  it("maps a pre-rename path to its present-day name", () => {
    const chain = new RenameChain();
    chain.observe(commit("r", renamed("core/score.py", "core/scoring.py")));
    expect(chain.resolve("core/score.py")).toBe("core/scoring.py");
  });

  it("collapses a chain of renames seen newest first", () => {
    const chain = new RenameChain();
    // git emits newest first, so b -> c is observed before a -> b.
    chain.observe(commit("r2", renamed("b.ts", "c.ts")));
    chain.observe(commit("r1", renamed("a.ts", "b.ts")));
    expect(chain.resolve("a.ts")).toBe("c.ts");
    expect(chain.resolve("b.ts")).toBe("c.ts");
  });

  it("attributes the renaming commit itself to the new name", () => {
    const chain = new RenameChain();
    const renaming = commit("r", renamed("core/score.py", "core/scoring.py"));
    // resolvedPaths runs before observe, exactly as the analyzer does it.
    expect(resolvedPaths(renaming, chain)).toEqual(["core/scoring.py"]);
    chain.observe(renaming);
    expect(
      resolvedPaths(commit("older", modified("core/score.py")), chain),
    ).toEqual(["core/scoring.py"]);
  });
});

describe("resolvedPaths", () => {
  it("deduplicates paths that resolve to the same present-day file", () => {
    const chain = new RenameChain();
    chain.observe(commit("r", renamed("old.ts", "new.ts")));
    const paths = resolvedPaths(
      commit("c", modified("old.ts"), modified("new.ts")),
      chain,
    );
    expect(paths).toEqual(["new.ts"]);
  });
});
