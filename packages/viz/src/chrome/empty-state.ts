/**
 * Empty-state copy conventions (UX-DR14), established here for the epic.
 *
 * The rule, read literally off UX-DR14: **an empty state names its CAUSE and
 * offers an EXIT, in that order, one sentence each.** Never a bare em dash,
 * never "no data", never a disabled control standing in for an absent one.
 *
 * The distinction that makes this worth a module: a metric of `0` and a metric
 * that is *absent* look identical when both print `—`, and on a real
 * repository the absent case dominates. Measured on a langgraph checkout, 386
 * of 650 files carry `commits: 0` — not because the tool failed, but because
 * their last change predates the analysis window. Copy is the only thing that
 * separates "quiet lately" from "broken tool".
 *
 * **Why a shared module rather than shared strings.** Story 5.6 (wave B) is
 * specced to build on these conventions, so they need one home. The wave-A
 * peers who asked for the shape — 5.1's empty ranking categories, 5.3's empty
 * filter result, 5.4's empty scope — deliberately do NOT import this file: it
 * does not exist on `epic/5-onboarding` until this story merges, and a
 * cross-branch import would leave their branches uncompilable and their test
 * commands red for a dependency none of them declared (all four stories are
 * `depends_on: []`). They carry their own strings and match the shape instead.
 * That duplication is a branch-mechanics decision, not an oversight, and
 * consolidating it is 5.6's business.
 *
 * A count belongs in the copy wherever one is available: "the 232 unconnected
 * nodes" beats "some nodes". A number is what makes an empty state read as a
 * measurement rather than as a failure, which is this story's whole point.
 */

/**
 * Modifier class marking a value that is absent rather than zero.
 *
 * AC-2 needs the two *visibly* distinct, and colour alone would not survive a
 * greyscale render or a colour-vision deficiency — the stylesheet pairs this
 * with italics for that reason.
 */
export const EMPTY_STATE_CLASS = "is-empty";

/** The two halves every empty state in this epic is built from. */
export interface EmptyState {
  /** Why it is empty, in the reader's terms, naming the lever responsible. */
  readonly cause: string;
  /** The one concrete action that changes it — a flag, a toggle, a button. */
  readonly exit: string;
}

/**
 * `cause · exit` — the one-line join, for places with a single line to spend.
 *
 * The separator is the ` · ` the panel and the stats bar already use, so an
 * empty state introduces no punctuation the rest of the chrome lacks.
 */
export function emptyStateLine(state: EmptyState): string {
  return `${state.cause} · ${state.exit}`;
}

/**
 * What a node with `lastChangedAt: null` prints instead of `—`.
 *
 * `days` is always `repo.analysisWindowDays`. The literal 90 must not appear
 * anywhere in this story: the window is configurable through `--window-days`,
 * and copy that hardcodes it lies the moment anyone reconfigures it (AC-1).
 */
export function noChangeInWindow(days: number): string {
  return `no change in last ${days} days`;
}

/** The repository-wide case: nothing at all landed inside the window. */
export function noCommitsInWindow(days: number): string {
  return `no commits in the last ${days} days`;
}

/**
 * The exit both window empty states offer: widen the window (UX-DR14).
 *
 * It names the flag concretely rather than saying "adjust your settings" — an
 * exit the reader cannot act on without guessing is not an exit.
 */
export function widenWindowHint(days: number): string {
  return `re-run with --window-days to look further back than ${days} days`;
}

/** The node-level state: this node is quiet, here is how to see further. */
export function outOfWindowState(days: number): EmptyState {
  return { cause: noChangeInWindow(days), exit: widenWindowHint(days) };
}

/** The repository-level state: the window caught nothing at all (AC-3). */
export function zeroHistoryState(days: number): EmptyState {
  return { cause: noCommitsInWindow(days), exit: widenWindowHint(days) };
}

/**
 * The heatmap's near-uniform case (AC-4).
 *
 * A heatmap where almost everything is the cold end reads as a broken renderer
 * unless something says otherwise. The count is the point: it turns a flat
 * canvas into a measurement the reader can act on.
 */
export function mostlyColdState(
  zeroChurn: number,
  total: number,
  days: number,
): EmptyState {
  return {
    cause: `${zeroChurn} of ${total} files unchanged in the last ${days} days`,
    exit: widenWindowHint(days),
  };
}
