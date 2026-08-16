# 5.10 — The NUL byte that makes our own engine invisible

`topLevelLinks` in `packages/viz/src/engine/layout.ts` deduped edges through a
composite key, `source + NUL + target`. The scanner reads any file containing a
NUL as binary, so **gitnebula's map of gitnebula drew its own force-layout
engine at `loc: 0`** — and a run on a clean clone opened with

```
! scan: binary-file ×1 (e.g. packages/viz/src/engine/layout.ts)
```

which is the tool's first console output telling a stranger that our own source
is a binary blob. The byte entered in `ad3d099` (PR #45) and survived every
review since, because `git diff`, GitHub's diff view, an editor and a code
review all render it as nothing at all.

## What changed

**The key is gone rather than re-spelled.** There is no sound replacement byte:
the halves of the key are node ids, which are paths, and a POSIX path may
contain *any* byte except NUL and `/` — a newline, a comma, a pipe are all
legal in a filename. That is exactly why the original author reached for NUL,
and it means any printable separator would have satisfied the letter of the
requirement while breaking the property it exists to protect.

`seen` is now a `Map<string, Set<string>>`. The two halves never share a
string, so there is nothing to separate and no byte to justify. It is
**behaviour-identical** — same dedupe, same insertion order, same output — and
it is the same shape `topLevelLinks3D` in `layout3d.ts` already uses, written
by `bob` for story 5.7 for the same reason. The two siblings now agree.

Self-links stay dropped *ahead of* the map lookup, so two files inside one
module can never enter as an edge from a node to itself.

**A repo-wide check stops it coming back.** `scripts/nul-sweep.mjs` fails when a
tracked text file carries a NUL, naming the file, the line and the byte offset —
"which file" is not actionable for a byte that renders as nothing. It is wired
into the story 5.9 tooling check that already runs inside root `pnpm test`,
rather than becoming a second entry point somebody has to remember.

## The measured effect

From real pipeline runs over a clean `--no-local` clone of this branch, before
and after. Full transcript in [MANUAL_TESTING.md](./MANUAL_TESTING.md).

| | before | after |
| - | --- | --- |
| run summary | `! scan: binary-file ×1 (e.g. …/layout.ts)` | warning **absent** |
| `layout.ts` loc | **0** | **388** |
| out-edges | 3 | 3 |
| in-edges | 4 | 4 |

The edges are identical in both directions — `deps` never read the scanner's
`binary` flag, so the map always drew the engine's coupling correctly and lost
only its size. The whole-document delta between the two runs is one added node
(`scripts/nul-sweep.mjs`) and one added edge (the import that reaches it):
nothing else in the map moved.

## Why the check reads bytes instead of shelling out

The byte hides from the tools you would naturally check your work with, and
this cost three people real time before the story was written:

- `grep -rlP '\x00' packages/viz/src/` returns **nothing** on a tree that does
  contain the byte — verified here against a deliberately broken tree. `bob`
  nearly reported the defect as non-reproducing on exactly this; `alice` lost
  an hour; `superman` a minute.
- `tr -dc '\0' < file` fails with `Illegal byte sequence` under a UTF-8 locale.
  My own first sweep silently listed **two** of the six NUL-bearing files until
  it was re-run under `LC_ALL=C`.

`Buffer.indexOf(0)` has neither property. Both traps are recorded in the
script's header so the next person does not re-derive them.

There was a third, found by Codex in review rather than by me: the first
version decoded `git ls-files -z` as UTF-8, so a tracked file whose **name** is
not valid UTF-8 would decode to a different string, fail to open, and be
skipped by the `catch` in silence. Paths now stay raw `Buffer`s all the way to
`readFileSync`, the extension test decodes `latin1` because it round-trips
every byte, and a tracked file the sweep cannot read is **reported rather than
skipped**. Three variants of one lesson: a check that can quietly report clean
is not a check.

## Two deviations from the spec's literal wording, and why

**AC-1 says the separator "is replaced by one that is still guaranteed not to
occur in a node id".** No such byte exists other than NUL itself, so the key was
removed instead of re-spelled. The guarantee AC-1 asks for is achieved
structurally rather than by choosing a luckier character — a stronger result
than the wording, and the AC's own reason ("a separator that can appear in a
node id reintroduces key collisions") is what argues for it.

**AC-1 names "a source-extension allow-list or an explicit `.gitattributes`
declaration".** The sweep uses a third shape that meets the same
content-independence requirement: an explicit list of *binary* extensions, with
everything else checked as text. The reason is failure direction. An allow-list
**fails open** — add a `.rs` file tomorrow and the sweep skips it in silence,
which is the same quiet miss this story exists to close. A binary deny-list
**fails closed**: a new binary asset makes the check fail loudly until someone
lists its extension deliberately.

Neither rule ever consults git's own binary detection. Git calls a file binary
*because* it contains a NUL, so that rule would exclude from the sweep exactly
the file the sweep exists to catch — the defect in miniature, as the spec puts
it.

## Files

| file | | why |
| ---- | - | --- |
| `packages/viz/src/engine/layout.ts` | UPDATE | nested-map dedupe; the NUL is gone and the reason is a comment at the site |
| `scripts/nul-sweep.mjs` | NEW | the repo-wide sweep; names file, line and byte offset; documents both tool traps |
| `scripts/verify-test-commands.mjs` | UPDATE | the sweep wired in as the twelfth tooling check |
| `docs/dev/epic-5/5.10-viz-nul-separator/MANUAL_TESTING.md` | NEW | executed, with observed output |
| `docs/implementation-artifacts/epic-5-onboarding/5.10-viz-nul-separator.md` | UPDATE | tasks ticked, Dev Agent Record |

The scanner is deliberately **not** in that list (AC-4): its binary detection is
correct, and `analyze.test.ts:386` passes unchanged. `sprint-status.yaml` is not
either — the supervisor sets 5.10's row by hand at closure, because the script
cannot derive it from a branch named for 5.9.

## Verifying it

```bash
node scripts/nul-sweep.mjs     # exit 0, nothing found
pnpm test:tooling              # twelve checks, the last one this sweep
pnpm --filter @gitnebula/viz test    # 55 files, 806 tests
```

To watch it fail, put a NUL back into any tracked source file and run
`pnpm test:tooling`; it names the file, the line and the offset.
