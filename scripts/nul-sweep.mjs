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

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname } from "node:path";
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

/**
 * Every file git tracks, as raw path **buffers**.
 *
 * Deliberately not decoded to UTF-8. A POSIX filename is an arbitrary sequence
 * of non-NUL bytes, and decoding one that is not valid UTF-8 substitutes
 * U+FFFD — after which the string no longer names the file, the read fails,
 * and the sweep skips exactly the kind of file it is supposed to inspect. That
 * is this story's own defect wearing a different hat, and it is why the paths
 * stay bytes all the way to `readFileSync`, which accepts a Buffer path.
 *
 * `-z` is what makes it safe to split: NUL is the one byte a path cannot
 * contain, so it is the only sound delimiter.
 */
export function trackedFiles(repoRoot = REPO_ROOT) {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });

  const paths = [];
  let start = 0;
  for (let index = 0; index < out.length; index += 1) {
    if (out[index] !== 0) continue;
    if (index > start) paths.push(out.subarray(start, index));
    start = index + 1;
  }
  if (out.length > start) paths.push(out.subarray(start));
  return paths;
}

/**
 * The extension of a raw path buffer, lowercased.
 *
 * `latin1` rather than `utf8` because it maps every byte to exactly one code
 * unit and back — so a filename this process cannot decode still gets its
 * extension compared correctly. Extensions worth matching are ASCII.
 */
function extensionOf(pathBuffer) {
  return extname(pathBuffer.toString("latin1")).toLowerCase();
}

/**
 * Every tracked text file carrying a NUL byte, with the offset of the first
 * one and the line it falls on — the byte is invisible in every other tool a
 * reviewer looks through, so "which file" is not enough to act on.
 */
export function findNulBytes(repoRoot = REPO_ROOT) {
  const prefix = Buffer.from(`${repoRoot}/`);
  const findings = [];

  for (const path of trackedFiles(repoRoot)) {
    if (BINARY_EXTENSIONS.has(extensionOf(path))) continue;

    // Lossy only for the message; the read below uses the raw bytes.
    const display = path.toString("utf8");

    let bytes;
    try {
      bytes = readFileSync(Buffer.concat([prefix, path]));
    } catch (error) {
      // Reported, never skipped. A tracked file the sweep could not read is a
      // file the sweep cannot vouch for, and quietly passing over it is the
      // failure this check exists to prevent.
      findings.push({
        path: display,
        unreadable: String(error.message ?? error),
      });
      continue;
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
    findings.push({ path: display, offset, line, count });
  }
  return findings;
}

/** Human-readable one-liner per finding, for the tooling check and the CLI. */
export function formatFinding(finding) {
  if (finding.unreadable !== undefined) {
    return `${finding.path} — tracked but unreadable, so unchecked: ${finding.unreadable}`;
  }
  return (
    `${finding.path}:${finding.line} — literal NUL byte at offset ${finding.offset}` +
    (finding.count > 1 ? ` (${finding.count} in this file)` : "")
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = findNulBytes();
  if (findings.length > 0) {
    process.stderr.write(
      `nul-sweep: ${findings.length} tracked text file(s) failed the sweep\n`,
    );
    for (const finding of findings) {
      process.stderr.write(`  ${formatFinding(finding)}\n`);
    }
    process.exit(1);
  }
  process.stdout.write("nul-sweep: no tracked text file carries a NUL byte\n");
}
