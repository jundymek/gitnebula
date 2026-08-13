import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StageError } from "./errors.js";
import { resolveRepo } from "./repo.js";
import { fixtureRepo, git, makeTempDir, removeAll } from "./test-support.js";

const temps: string[] = [];
afterEach(() => removeAll(temps));

function bareRepo(remoteUrl?: string): string {
  const dir = makeTempDir(temps, "gitnebula-repo-");
  git(dir, "init", "--quiet", "--template=", "-b", "trunk");
  if (remoteUrl !== undefined) git(dir, "remote", "add", "origin", remoteUrl);
  return dir;
}

describe("resolveRepo (metadata the contract needs and no analyzer produces)", () => {
  it("resolves the fixture repository's root, name and branch", () => {
    const info = resolveRepo(fixtureRepo);

    expect(info.root).toBe(git(fixtureRepo, "rev-parse", "--show-toplevel"));
    expect(info.name).toBe("history-repo");
    expect(info.remoteUrl).toBeNull();
    expect(info.defaultBranch).toBe("main");
  });

  it("resolves the root from a subdirectory of the working tree", () => {
    const info = resolveRepo(`${fixtureRepo}/core`);
    expect(basename(info.root)).toBe("history-repo");
  });

  it("takes the name from an SSH remote", () => {
    const info = resolveRepo(bareRepo("git@github.com:jundymek/gitnebula.git"));
    expect(info.name).toBe("gitnebula");
    expect(info.remoteUrl).toBe("git@github.com:jundymek/gitnebula.git");
  });

  it("takes the name from an HTTPS remote, with or without a .git suffix", () => {
    expect(
      resolveRepo(bareRepo("https://github.com/owner/thing.git")).name,
    ).toBe("thing");
    expect(resolveRepo(bareRepo("https://github.com/owner/thing/")).name).toBe(
      "thing",
    );
  });

  it("names a remoteless repository after its directory", () => {
    const dir = bareRepo();
    expect(resolveRepo(dir).name).toBe(basename(dir));
  });

  it("reads the branch of an unborn HEAD rather than guessing", () => {
    expect(resolveRepo(bareRepo()).defaultBranch).toBe("trunk");
  });

  it("says a mistyped path does not exist, rather than blaming git", () => {
    // A missing cwd and a missing git binary both surface as ENOENT from
    // execFileSync, so the naive handler told anyone who mistyped a path to
    // install git.
    let thrown: unknown;
    try {
      resolveRepo("/does/not/exist");
    } catch (error) {
      thrown = error;
    }

    expect((thrown as StageError).cause).toBe("/does/not/exist does not exist");
    expect((thrown as StageError).remedy).not.toMatch(/install git/);
  });

  it("rejects a file the way it rejects a missing path", () => {
    const dir = makeTempDir(temps, "gitnebula-file-");
    const file = join(dir, "not-a-repo.txt");
    writeFileSync(file, "");

    expect(() => resolveRepo(file)).toThrow(
      /^repo: .+not-a-repo\.txt is not a directory — /,
    );
  });

  it("fails in the AD-7 shape on a directory that is not a repository (AC-2)", () => {
    const dir = makeTempDir(temps, "gitnebula-plain-");

    let thrown: unknown;
    try {
      resolveRepo(dir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StageError);
    const error = thrown as StageError;
    expect(error.stage).toBe("repo");
    expect(error.cause).toBe(`${dir} is not a git repository`);
    expect(error.remedy).toBe(
      "run gitnebula inside a git repository, or pass the path to one",
    );
    expect(error.message).toBe(
      `repo: ${dir} is not a git repository — run gitnebula inside a git repository, or pass the path to one`,
    );
  });
});
