// Tree walk and LOC counting.
//
// Two passes on purpose: collecting paths is cheap (directory entries only,
// no file contents) and gives `onProgress` an honest total before the
// expensive pass starts (AD-3).

import type { Dirent } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { WarningCollector } from "./warnings.js";

import type { ExcludeMatcher } from "./excludes.js";

/** Read size for the LOC pass. Contents are never retained past the chunk. */
const CHUNK_BYTES = 64 * 1024;

const TAB = 0x09;
const LINE_FEED = 0x0a;
const VERTICAL_TAB = 0x0b;
const FORM_FEED = 0x0c;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const NUL = 0x00;

function isBlankByte(byte: number): boolean {
  return (
    byte === SPACE ||
    byte === TAB ||
    byte === CARRIAGE_RETURN ||
    byte === VERTICAL_TAB ||
    byte === FORM_FEED
  );
}

// Unicode has whitespace beyond ASCII — a no-break space, the em and en
// spaces, the ideographic space, the byte-order mark. A line holding only
// those is blank to a reader, so counting it as a line of code would
// contradict the rule this file documents. Rather than decode UTF-8 (a
// decoder in the hot loop, for this), the counter recognizes the handful of
// byte sequences those characters encode to. Every one of them starts with a
// lead byte no other whitespace uses, so the lookahead is at most two bytes
// and only ever entered on a byte that is already non-ASCII.

/** Sequence verdicts while a multi-byte whitespace candidate is buffered. */
type SequenceVerdict = "whitespace" | "prefix" | "content";

function isWhitespaceLead(byte: number): boolean {
  return (
    byte === 0xc2 ||
    byte === 0xe1 ||
    byte === 0xe2 ||
    byte === 0xe3 ||
    byte === 0xef
  );
}

/** Second byte of a candidate: completes U+0085/U+00A0, or continues. */
function classifyPair(lead: number, byte: number): SequenceVerdict {
  switch (lead) {
    // U+0085 NEL, U+00A0 NO-BREAK SPACE
    case 0xc2:
      return byte === 0x85 || byte === 0xa0 ? "whitespace" : "content";
    // U+1680 OGHAM SPACE MARK
    case 0xe1:
      return byte === 0x9a ? "prefix" : "content";
    // U+2000..U+200A, U+2028, U+2029, U+202F, U+205F
    case 0xe2:
      return byte === 0x80 || byte === 0x81 ? "prefix" : "content";
    // U+3000 IDEOGRAPHIC SPACE
    case 0xe3:
      return byte === 0x80 ? "prefix" : "content";
    // U+FEFF ZERO WIDTH NO-BREAK SPACE (byte-order mark)
    case 0xef:
      return byte === 0xbb ? "prefix" : "content";
    default:
      return "content";
  }
}

/** Third byte of a candidate: the sequence is whitespace, or it is content. */
function isWhitespaceTriple(
  lead: number,
  second: number,
  byte: number,
): boolean {
  if (lead === 0xe1) return second === 0x9a && byte === 0x80;
  if (lead === 0xe3) return second === 0x80 && byte === 0x80;
  if (lead === 0xef) return second === 0xbb && byte === 0xbf;
  if (lead === 0xe2) {
    if (second === 0x80) {
      // U+2000..U+200A, then the two separators and the narrow no-break space.
      return (
        (byte >= 0x80 && byte <= 0x8a) ||
        byte === 0xa8 ||
        byte === 0xa9 ||
        byte === 0xaf
      );
    }
    // U+205F MEDIUM MATHEMATICAL SPACE
    if (second === 0x81) return byte === 0x9f;
  }
  return false;
}

/**
 * What one directory entry turned out to be.
 *
 * Not every filesystem answers that from the directory read. FUSE and some
 * network mounts return `DT_UNKNOWN`, and then every `Dirent` predicate says
 * false — ordinary files and directories included. Trusting the predicates
 * there would report a whole repository as irregular and skip it, so an entry
 * that claims to be nothing gets an `lstat` before it is written off.
 */
export type EntryKind = "file" | "directory" | "symlink" | "other";

export async function classifyEntry(
  entry: Pick<Dirent, "isSymbolicLink" | "isDirectory" | "isFile">,
  absolutePath: string,
): Promise<EntryKind> {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";

  try {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
  } catch {
    return "other";
  }
  return "other";
}

/**
 * Walks `root` depth-first, returning repository-relative POSIX paths of every
 * file that survives the exclude globs.
 *
 * A directory that matches an exclude glob is pruned whole — one test skips
 * the entire subtree, which is what makes `node_modules` cheap rather than
 * merely absent from the result.
 *
 * Symlinks are skipped and counted: a symlink is not an independent unit of
 * code, and following one invites a cycle. Anything that is neither a regular
 * file nor a directory (sockets, devices, FIFOs) is skipped the same way.
 */
export async function collectFiles(
  root: string,
  isExcluded: ExcludeMatcher,
  warnings: WarningCollector,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(absoluteDir: string, relativeDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      warnings.add("unreadable-directory", relativeDir || ".");
      return;
    }

    // Fixed traversal order: two runs must produce the same warning counts and
    // the same progress sequence, not merely the same sorted result (AD-4).
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (isExcluded(relativePath)) continue;

      const absolutePath = join(absoluteDir, entry.name);
      switch (await classifyEntry(entry, absolutePath)) {
        case "symlink":
          warnings.add("symlink-skipped", relativePath);
          break;
        case "directory":
          await walk(absolutePath, relativePath);
          break;
        case "file":
          files.push(relativePath);
          break;
        default:
          warnings.add("irregular-file-skipped", relativePath);
      }
    }
  }

  await walk(root, "");
  return files;
}

/** What one LOC pass learned about a file. */
export interface LocResult {
  /** Lines carrying at least one non-whitespace character. 0 when binary. */
  readonly loc: number;
  /** True when a NUL byte appeared in the first chunk. */
  readonly binary: boolean;
  /** True when the file could not be read at all. */
  readonly unreadable: boolean;
}

/**
 * Counts lines carrying at least one non-whitespace character, streaming the
 * file in chunks — no full-file retention, so a 40 MB checked-in blob costs
 * one chunk of memory rather than forty megabytes of it. "Whitespace" means
 * Unicode whitespace, not merely ASCII: a line holding one no-break space is
 * blank to a reader and is counted as blank here.
 *
 * Binary files are detected by a NUL byte in the first chunk. They are still
 * *nodes* — the universe stays closed (AD-13) — but contribute 0 LOC, because
 * "lines" is not a meaningful count over bytes that are not text.
 */
export async function countLoc(absolutePath: string): Promise<LocResult> {
  let handle;
  try {
    handle = await open(absolutePath, "r");
  } catch {
    return { loc: 0, binary: false, unreadable: true };
  }

  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let loc = 0;
    let lineHasContent = false;
    let firstChunk = true;
    // A multi-byte whitespace candidate in progress. Held across chunk reads,
    // so a character split by a 64 KB boundary is still recognized. 0 = none.
    let lead = 0;
    let second = 0;

    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, null);
      if (bytesRead === 0) break;

      if (firstChunk) {
        firstChunk = false;
        if (buffer.indexOf(NUL, 0) >= 0 && buffer.indexOf(NUL, 0) < bytesRead) {
          return { loc: 0, binary: true, unreadable: false };
        }
      }

      for (let i = 0; i < bytesRead; i += 1) {
        const byte = buffer[i] as number;

        if (byte === LINE_FEED) {
          // A candidate cut short by the line ending was never whitespace.
          if (lead !== 0) lineHasContent = true;
          lead = 0;
          second = 0;
          if (lineHasContent) loc += 1;
          lineHasContent = false;
          continue;
        }

        if (lead !== 0) {
          if (second === 0) {
            const verdict = classifyPair(lead, byte);
            if (verdict === "prefix") {
              second = byte;
              continue;
            }
            if (verdict === "content") lineHasContent = true;
            lead = 0;
            continue;
          }
          if (!isWhitespaceTriple(lead, second, byte)) lineHasContent = true;
          lead = 0;
          second = 0;
          continue;
        }

        if (isBlankByte(byte)) continue;
        if (isWhitespaceLead(byte)) {
          lead = byte;
          continue;
        }
        lineHasContent = true;
      }
    }

    // A last line with no trailing newline still counts, as does a candidate
    // left dangling at end of file.
    if (lead !== 0) lineHasContent = true;
    if (lineHasContent) loc += 1;
    return { loc, binary: false, unreadable: false };
  } catch {
    return { loc: 0, binary: false, unreadable: true };
  } finally {
    await handle.close();
  }
}
