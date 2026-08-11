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
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR="$ROOT_DIR/.generated/history-repo"

rm -rf "$REPO_DIR"
mkdir -p "$REPO_DIR"

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

G rev-parse HEAD
