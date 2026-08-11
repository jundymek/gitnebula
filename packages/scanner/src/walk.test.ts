import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { classifyEntry, countLoc } from "./walk.js";

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

// Written as escapes throughout: a literal no-break space in a source file is
// invisible to a reviewer and to the linter's irregular-whitespace rule alike.
describe("countLoc — Unicode whitespace", () => {
  async function locOf(contents: string | Buffer): Promise<number> {
    const root = await temporaryRoot();
    const path = join(root, "file.txt");
    await writeFile(path, contents);
    return (await countLoc(path)).loc;
  }

  it.each([
    ["no-break space", "\u00A0"],
    ["next line", "\u0085"],
    ["ogham space mark", "\u1680"],
    ["en quad", "\u2000"],
    ["em space", "\u2003"],
    ["hair space", "\u200A"],
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
    ["narrow no-break space", "\u202F"],
    ["medium mathematical space", "\u205F"],
    ["ideographic space", "\u3000"],
    ["byte-order mark", "\uFEFF"],
  ])("does not count a line holding only a %s", async (_name, character) => {
    expect(await locOf(`a = 1\n${character}\nb = 2\n`)).toBe(2);
    expect(await locOf(` ${character}\t${character} \n`)).toBe(0);
  });

  it("still counts a line where such a space sits next to real content", async () => {
    expect(await locOf("\u00A0a = 1\n")).toBe(1);
    expect(await locOf("a\u3000= 1\n")).toBe(1);
  });

  it("counts non-whitespace characters sharing a lead byte", async () => {
    // U+00E9 is C3 A9 and U+20AC is E2 82 AC — near neighbours of the
    // sequences above, and neither is whitespace.
    expect(await locOf("é\n€\n")).toBe(2);
    // U+2010 HYPHEN shares the E2 80 prefix with the U+2000..U+200A spaces.
    expect(await locOf("‐\n")).toBe(1);
    // U+FEFF is EF BB BF; U+FE0F VARIATION SELECTOR-16 is EF B8 8F.
    expect(await locOf("\uFE0F\n")).toBe(1);
  });

  it("recognizes a space split across a chunk boundary", async () => {
    // The reader works in 64 KB chunks. Pad so the no-break space's lead byte
    // is the last byte of the first chunk and its continuation the first byte
    // of the second — the case a per-chunk reset would get wrong.
    const padding = "x".repeat(64 * 1024 - 2);
    expect(await locOf(`${padding}\n\u00A0\n`)).toBe(1);
  });

  it("counts a bare carriage return as a line ending", async () => {
    // Pre-OS X Mac files use CR alone. Treating it as blank filler would
    // report the whole file as a single line.
    expect(await locOf("a = 1\rb = 2\rc = 3\r")).toBe(3);
    expect(await locOf("a = 1\r\rb = 2\r")).toBe(2);
  });

  it("counts a CRLF pair as one line ending, not two", async () => {
    expect(await locOf("a = 1\r\nb = 2\r\n")).toBe(2);
    expect(await locOf("a = 1\r\n\r\nb = 2\r\n")).toBe(2);
  });

  it("counts a CRLF split across a chunk boundary as one line ending", async () => {
    const padding = "x".repeat(64 * 1024 - 1);
    expect(await locOf(`${padding}\r\ny = 2\r\n`)).toBe(2);
  });

  it("treats a truncated sequence at end of file as content", async () => {
    // A lone 0xC2 is not valid UTF-8 — it is bytes, so the line is not blank.
    expect(await locOf(Buffer.from([0xc2]))).toBe(1);
  });

  it("treats a truncated sequence before a line ending as content", async () => {
    // 0xC2 then a newline: the candidate never completed, so it is not a
    // space and the line it sat on is not blank.
    expect(await locOf(Buffer.from([0xc2, 0x0a]))).toBe(1);
    // Same for a three-byte candidate cut off after two: "a\n", E2 80, "\n".
    expect(await locOf(Buffer.from([0x61, 0x0a, 0xe2, 0x80, 0x0a]))).toBe(2);
  });
});
