import { describe, expect, it } from "vitest";

import { githubNodeUrl, githubRepoUrl } from "./github.js";

describe("GitHub remote detection (AC-3)", () => {
  it("accepts the three shapes git actually reports", () => {
    const expected = "https://github.com/jundymek/gitnebula";
    for (const remote of [
      "https://github.com/jundymek/gitnebula.git",
      "https://github.com/jundymek/gitnebula",
      "git@github.com:jundymek/gitnebula.git",
      "ssh://git@github.com/jundymek/gitnebula.git",
      "https://GitHub.com/jundymek/gitnebula/",
      "  https://github.com/jundymek/gitnebula.git  ",
    ]) {
      expect(githubRepoUrl(remote)).toBe(expected);
    }
  });

  it("refuses every remote that is not GitHub", () => {
    // The path segments differ per host (`-/tree`, `src`), so a guess here
    // ships a link that 404s. AC-3 wants the button absent instead.
    for (const remote of [
      null,
      "",
      "   ",
      "https://gitlab.com/o/r.git",
      "git@bitbucket.org:o/r.git",
      "https://github.example.com/o/r.git",
      "https://github.com/jundymek",
      "https://github.com/",
    ]) {
      expect(githubRepoUrl(remote)).toBeNull();
    }
  });
});

describe("GitHub node URL (AC-3)", () => {
  const remote = "git@github.com:jundymek/gitnebula.git";

  it("uses tree for a module and blob for a file", () => {
    expect(githubNodeUrl(remote, "main", "packages/viz/", "module")).toBe(
      "https://github.com/jundymek/gitnebula/tree/main/packages/viz",
    );
    expect(
      githubNodeUrl(remote, "main", "packages/viz/src/app.ts", "file"),
    ).toBe(
      "https://github.com/jundymek/gitnebula/blob/main/packages/viz/src/app.ts",
    );
  });

  it("points a root-level module at the repository tree", () => {
    expect(githubNodeUrl(remote, "develop", "/", "module")).toBe(
      "https://github.com/jundymek/gitnebula/tree/develop",
    );
  });

  it("encodes path segments without eating the separators", () => {
    // A `/` in a branch name stays a `/` — that is the URL GitHub itself
    // produces for `feat/panel`. Everything else is percent-encoded.
    expect(githubNodeUrl(remote, "feat/panel", "src/a b/c#d.ts", "file")).toBe(
      "https://github.com/jundymek/gitnebula/blob/feat/panel/src/a%20b/c%23d.ts",
    );
  });

  it("is null for a non-GitHub remote and for a missing branch", () => {
    expect(githubNodeUrl(null, "main", "src/", "module")).toBeNull();
    expect(
      githubNodeUrl("https://gitlab.com/o/r.git", "main", "src/", "module"),
    ).toBeNull();
    expect(githubNodeUrl(remote, "  ", "src/", "module")).toBeNull();
  });
});
