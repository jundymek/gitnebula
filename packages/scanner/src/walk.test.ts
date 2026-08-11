import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { classifyEntry } from "./walk.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gitnebula-walk-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/**
 * A `Dirent` from a filesystem that answered `DT_UNKNOWN` — every predicate
 * says false even though the entry is perfectly ordinary. FUSE and some
 * network mounts do this; trusting the predicates would skip the repository.
 */
const unknownDirent = {
  isSymbolicLink: () => false,
  isDirectory: () => false,
  isFile: () => false,
};

describe("classifyEntry", () => {
  it("trusts the directory entry when it knows what it is", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "a.ts"), "const a = 1;\n");

    const lying = {
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => false,
    };

    // No stat call is made, so the entry's own claim stands even here.
    expect(await classifyEntry(lying, join(root, "a.ts"))).toBe("directory");
  });

  it.each([
    ["file", async (path: string) => writeFile(path, "const a = 1;\n")],
    ["directory", async (path: string) => mkdir(path)],
  ])("resolves an unknown entry to %s by stat", async (kind, create) => {
    const root = await temporaryRoot();
    const path = join(root, "entry");
    await create(path);

    expect(await classifyEntry(unknownDirent, path)).toBe(kind);
  });

  it("resolves an unknown entry pointing at a symlink without following it", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "target.ts"), "const a = 1;\n");
    await symlink(join(root, "target.ts"), join(root, "link.ts"));

    expect(await classifyEntry(unknownDirent, join(root, "link.ts"))).toBe(
      "symlink",
    );
  });

  it("reports other when the entry cannot be stat-ed at all", async () => {
    const root = await temporaryRoot();

    expect(await classifyEntry(unknownDirent, join(root, "gone"))).toBe(
      "other",
    );
  });
});
