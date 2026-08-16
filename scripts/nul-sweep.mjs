#!/usr/bin/env node
// Story 5.10: no tracked text file may contain a literal NUL byte.
//
// A NUL in a source file makes the scanner read it as binary — gitnebula's own
// map showed its force-layout engine at loc 0, and a run on a clean clone
// warned a stranger about our own source. The byte survived a code review, a
// GitHub diff and three agents reading the line, because every one of those
// renders it as nothing at all.
//
// The sweep reads bytes itself rather than shelling out, because the byte
// hides from the obvious tools:
//
//   - `grep` treats a file containing NUL as binary and suppresses matches, so
//     `grep -rn` over the repository reports clean while the file sits there.
//     `grep -a` sees it; a plain sweep does not.
//   - `tr -dc '\0'` fails with "Illegal byte sequence" on non-UTF-8 input under
//     a UTF-8 locale, so a shell loop silently skips the very files most likely
//     to contain the byte unless it sets `LC_ALL=C`.
//
// Both were observed on this repository while writing this check. Buffer
// scanning has neither property.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Extensions whose files are genuinely binary and legitimately contain NUL.
 *
 * The rule is **content-independent by construction**, which is the whole
 * point: git calls a file binary *because* it contains a NUL, so asking git
 * would exclude from the sweep exactly the file the sweep exists to catch.
 *
 * It is a deny-list rather than an allow-list of text extensions so that it
 * fails closed: a source file in a language nobody has added here yet is
 * checked by default, where an allow-list would skip it in silence — the same
 * shape of quiet miss this check exists to prevent. Adding a genuine binary
 * asset therefore means adding its extension here, deliberately.
 */
export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".wasm",
  ".zip",
  ".gz",
  ".mp4",
  ".mov",
]);

/** Every file git tracks, repository-relative, NUL-delimited so paths survive. */
export function trackedFiles(repoRoot = REPO_ROOT) {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((path) => path.length > 0);
}

/**
 * Every tracked text file carrying a NUL byte, with the offset of the first
 * one and the line it falls on — the byte is invisible in every other tool a
 * reviewer looks through, so "which file" is not enough to act on.
 */
export function findNulBytes(repoRoot = REPO_ROOT) {
  const findings = [];
  for (const path of trackedFiles(repoRoot)) {
    if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) continue;

    let bytes;
    try {
      bytes = readFileSync(join(repoRoot, path));
    } catch {
      continue; // tracked but not in the working tree; nothing to read
    }

    const offset = bytes.indexOf(0);
    if (offset === -1) continue;

    let count = 0;
    for (const byte of bytes) if (byte === 0) count += 1;
    // Lines are 1-based, counted the way an editor counts them.
    let line = 1;
    for (let index = 0; index < offset; index += 1) {
      if (bytes[index] === 0x0a) line += 1;
    }
    findings.push({ path, offset, line, count });
  }
  return findings;
}

/** Human-readable one-liner per finding, for the tooling check and the CLI. */
export function formatFinding(finding) {
  return (
    `${finding.path}:${finding.line} — literal NUL byte at offset ${finding.offset}` +
    (finding.count > 1 ? ` (${finding.count} in this file)` : "")
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = findNulBytes();
  if (findings.length > 0) {
    process.stderr.write(
      `nul-sweep: ${findings.length} tracked text file(s) carry a NUL byte\n`,
    );
    for (const finding of findings) {
      process.stderr.write(`  ${formatFinding(finding)}\n`);
    }
    process.exit(1);
  }
  process.stdout.write("nul-sweep: no tracked text file carries a NUL byte\n");
}
