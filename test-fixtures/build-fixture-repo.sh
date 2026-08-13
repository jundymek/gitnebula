#!/usr/bin/env sh
# Builds the deterministic fixture git repository used by githist tests (AD-14).
#
# Replays crafted commits with pinned GIT_AUTHOR_DATE / GIT_COMMITTER_DATE and
# fixed identities into test-fixtures/.generated/history-repo. Running this
# script twice on any machine yields identical commit hashes; nothing under
# .generated/ is ever committed.
#
# Crafted history covers (story 1.3, AC-4):
#   - a rename with content preserved            (core/score.py -> core/scoring.py)
#   - a multi-file commit (co-change source)     (core/scoring.py + web/api.ts)
#   - a file touched by 3 distinct authors       (web/api.ts)
#   - a file whose only commits predate the
#     analysis window (anchor 2026-01-01, 365d)  (legacy/old.ts, commits in 2024)
#   - a Python + TS file mix
#
# Safe to run concurrently (story 3.6). Several packages build the fixture in
# their own suites so that each package's test command works standalone, and
# `pnpm -r test` runs those packages in parallel. Three properties keep that
# honest:
#
#   1. a mkdir lock, so only one build runs at a time;
#   2. a stamp holding this script's checksum, so a caller that finds a valid
#      repository prints its HEAD and touches nothing;
#   3. the build happens in a sibling directory and is swapped into place, so a
#      reader never sees a half-built or deleted repository.
#
# Editing anything below the header changes the checksum and invalidates the
# stamp, which is the point: a stale fixture is rebuilt on the next run.
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GEN_DIR="$ROOT_DIR/.generated"
FINAL_DIR="$GEN_DIR/history-repo"
BUILD_DIR="$GEN_DIR/history-repo.building"
STAMP_FILE="$GEN_DIR/history-repo.stamp"
LOCK_DIR="$GEN_DIR/history-repo.lock"

# The stamp lives outside the repository: inside it, it would show up as a
# fourth file in the scan and break scanner's committed expectation.
STAMP=$(cksum < "$0")

mkdir -p "$GEN_DIR"

# `mkdir` is atomic on every POSIX filesystem, which is why the lock is a
# directory and not a file. Waiting is bounded: a build takes about a second,
# so a caller that has waited a minute is looking at a leaked lock, not a slow
# peer, and says so instead of hanging a test run forever.
waited=0
NAP=0.1
LIMIT=600
until mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ "$waited" -eq 0 ]; then
    # Probed on first contention only, so the uncontended path pays nothing:
    # sub-second sleeps are ubiquitous but not POSIX. The iteration limit
    # follows the nap, so the wait is about a minute either way.
    if ! sleep 0.1 2>/dev/null; then NAP=1; LIMIT=60; fi
  else
    sleep "$NAP"
  fi
  waited=$((waited + 1))
  if [ "$waited" -gt "$LIMIT" ]; then
    echo "build-fixture-repo.sh: timed out waiting for $LOCK_DIR." >&2
    echo "If no build is running, remove that directory and retry." >&2
    exit 1
  fi
done

# The lock is released exactly once. A signal handler disarms the EXIT trap
# before releasing, because otherwise it would release, exit, and release
# again — and between those two releases another builder can legitimately take
# the lock, which the second release would then delete out from under it.
release() {
  trap - EXIT INT TERM HUP
  rm -rf "$LOCK_DIR"
}
trap release EXIT
trap 'release; exit 130' INT
trap 'release; exit 143' TERM
trap 'release; exit 129' HUP

# Already built by whoever held the lock before us, and built by *this* version
# of the script: print the HEAD hash — the contract every caller reads — and
# leave the repository alone.
if [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE")" = "$STAMP" ]; then
  if HEAD_HASH=$(git -C "$FINAL_DIR" rev-parse HEAD 2>/dev/null); then
    printf '%s\n' "$HEAD_HASH"
    exit 0
  fi
fi

# The old stamp is deliberately left in place until the new repository is
# swapped in. An interrupted rebuild then leaves the previous repository and
# its stamp intact and consistent, so the next caller no-ops on a fixture that
# is still good instead of rebuilding under a reader's feet.
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# The crafted history below is built here and renamed into place at the end.
# The commit hashes do not depend on the path (story 3.6, AC-4).
REPO_DIR="$BUILD_DIR"

# Every git invocation goes through this wrapper: fixed timezone-less ISO
# dates, no gpg signing, no template hooks, identity supplied per commit.
G() {
  git -C "$REPO_DIR" \
    -c commit.gpgsign=false \
    -c tag.gpgsign=false \
    -c core.autocrlf=false \
    "$@"
}

commit() {
  # commit <date-iso> <author-name> <author-email> <message>
  GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" \
  GIT_AUTHOR_NAME="$2" GIT_AUTHOR_EMAIL="$3" \
  GIT_COMMITTER_NAME="$2" GIT_COMMITTER_EMAIL="$3" \
    G commit --quiet --no-verify -m "$4"
}

git init --quiet --template= -b main "$REPO_DIR"

ALICE_N="Ada Fixture";  ALICE_E="ada@fixture.invalid"
BOB_N="Ben Fixture";    BOB_E="ben@fixture.invalid"
CARO_N="Cara Fixture";  CARO_E="cara@fixture.invalid"

# --- Outside the analysis window (window anchor 2026-01-01T00:00:00Z, 365d:
# --- everything before 2025-01-01 is out of window) ------------------------

mkdir -p "$REPO_DIR/legacy"
printf 'export const legacy = true;\n' > "$REPO_DIR/legacy/old.ts"
G add legacy/old.ts
commit "2024-03-01T10:00:00Z" "$ALICE_N" "$ALICE_E" "add legacy module"

printf 'export const legacy = true;\nexport const era = "pre-window";\n' \
  > "$REPO_DIR/legacy/old.ts"
G add legacy/old.ts
commit "2024-06-15T10:00:00Z" "$ALICE_N" "$ALICE_E" "tweak legacy module"

# --- Inside the window: Python + TS mix ------------------------------------

mkdir -p "$REPO_DIR/core" "$REPO_DIR/web"
printf 'def score(x):\n    return x * 2\n' > "$REPO_DIR/core/score.py"
printf 'export const api = () => "v1";\n' > "$REPO_DIR/web/api.ts"
G add core/score.py web/api.ts
commit "2025-02-01T09:00:00Z" "$ALICE_N" "$ALICE_E" "add scoring and api"

# Multi-file commit: the co-change source pair (core/scoring later + web/api).
printf 'def score(x):\n    return x * 3\n' > "$REPO_DIR/core/score.py"
printf 'export const api = () => "v2";\n' > "$REPO_DIR/web/api.ts"
G add core/score.py web/api.ts
commit "2025-03-10T14:30:00Z" "$BOB_N" "$BOB_E" "bump scoring factor and api version"

# Rename with content preserved (exercises the one-pass -M rename mapping).
G mv core/score.py core/scoring.py
commit "2025-04-05T11:15:00Z" "$ALICE_N" "$ALICE_E" "rename score.py to scoring.py"

# Third distinct author on web/api.ts (Ada and Ben touched it above).
printf 'export const api = () => "v3";\nexport const ping = () => "pong";\n' \
  > "$REPO_DIR/web/api.ts"
G add web/api.ts
commit "2025-05-20T16:45:00Z" "$CARO_N" "$CARO_E" "add ping endpoint"

# One more Python-side change inside the window.
printf 'def score(x):\n    return x * 3\n\ndef normalize(x):\n    return min(x, 1)\n' \
  > "$REPO_DIR/core/scoring.py"
G add core/scoring.py
commit "2025-06-30T08:00:00Z" "$BOB_N" "$BOB_E" "add normalize helper"

HEAD_HASH=$(G rev-parse HEAD)

# Swap the finished build over the live directory: two renames, never a
# half-built tree under the live name. POSIX has no atomic directory
# replacement, so the live name is briefly absent between them. That window is
# only reachable while a reader holds a repository this script has decided to
# replace, which means the stamp stopped matching mid-run — i.e. someone edited
# this script while tests were running. Every ordinary path (first build,
# interrupted build, a valid fixture) either has no reader or does not rebuild.
rm -rf "$FINAL_DIR.previous"
if [ -d "$FINAL_DIR" ]; then
  mv "$FINAL_DIR" "$FINAL_DIR.previous"
fi
mv "$BUILD_DIR" "$FINAL_DIR"
rm -rf "$FINAL_DIR.previous"

# The stamp is written last: it is a claim that the repository above is
# complete and was built by this version of the script.
printf '%s' "$STAMP" > "$STAMP_FILE"

printf '%s\n' "$HEAD_HASH"
