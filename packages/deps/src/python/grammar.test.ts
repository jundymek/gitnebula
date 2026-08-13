// AC-1: the committed grammar is the one `scripts/build-grammar.sh` produces,
// and rebuilding it reproduces the same bytes.
//
// The default suite asserts the *checksum*: it is offline and takes no
// toolchain (AD-8). The rebuild itself is opt-in, because it downloads the
// pinned tree-sitter-cli and a wasi-sdk toolchain and takes minutes:
//
//   GITNEBULA_BUILD_GRAMMAR=1 pnpm --filter @gitnebula/deps test
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { grammarPath } from "./parser.js";

const run = promisify(execFile);

const BUILD_SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../../scripts/build-grammar.sh",
);

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

describe("the committed grammar (AC-1)", () => {
  it("matches the checksum the build script recorded", async () => {
    const recorded = await readFile(`${grammarPath}.sha256`, "utf8");

    expect(recorded.trim().split(/\s+/)[0]).toBe(await sha256(grammarPath));
  });

  it("was built by the pinned tree-sitter-cli", async () => {
    const script = await readFile(BUILD_SCRIPT, "utf8");

    // The pin is the ABI contract with web-tree-sitter; a bump here without a
    // matching runtime bump is exactly the failure tree-sitter#5171 describes.
    expect(script).toContain("TREE_SITTER_CLI_VERSION=0.26.12");
    expect(script).toContain("GRAMMAR_VERSION=0.25.0");
  });

  it.skipIf(process.env.GITNEBULA_BUILD_GRAMMAR === undefined)(
    "reproduces byte-identically when rebuilt",
    async () => {
      const { stdout } = await run("sh", [BUILD_SCRIPT, "--check"]);

      expect(stdout).toContain("byte-identical");
    },
    900_000,
  );
});
