#!/usr/bin/env sh
# Builds packages/deps/assets/tree-sitter-python.wasm — the grammar the deps
# stage parses Python with (ADR-0001, AD-11, story 3.1).
#
# ## The pins, and why they are pins
#
#   tree-sitter-cli   0.26.12   builds the .wasm
#   web-tree-sitter   0.26.x    loads it at runtime (packages/deps/package.json)
#   tree-sitter-python 0.25.0   the grammar source, from its npm tarball
#
# The CLI and the runtime must come from the same 0.26 line. A `.wasm` built by
# one tree-sitter minor and loaded by another fails at `Language.load` with a
# version mismatch: the language ABI is negotiated between the compiled grammar
# and the runtime, and tree-sitter#5171 is the report of exactly that breakage
# across the 0.25/0.26 boundary. The grammar's own version moves independently
# (0.25.0 is current) — it is the *tooling* that has to match.
#
# Native compilation is what this whole path avoids: `npx gitnebula` must never
# touch node-gyp (ADR-0001), so the grammar is compiled here, once, and the
# artifact is committed. The CLI downloads a wasi-sdk toolchain into
# ~/.cache/tree-sitter on first use; that is a developer-machine cost, never a
# user's — nothing here runs at analysis time (AD-8).
#
# ## Reproducibility (AC-1)
#
# Two runs of this script produce a byte-identical artifact, on any machine and
# from any directory. The only input that leaks into the output is the **output
# file's basename**, which the emitted module records — which is why the name is
# fixed here and why a rebuild is compared under that same name.
#
#   ./scripts/build-grammar.sh          rebuild the committed artifact in place
#   ./scripts/build-grammar.sh --check  rebuild into a temp dir and diff; the
#                                       committed artifact is left untouched
set -eu

TREE_SITTER_CLI_VERSION=0.26.12
GRAMMAR_PACKAGE=tree-sitter-python
GRAMMAR_VERSION=0.25.0
ARTIFACT_NAME=tree-sitter-python.wasm

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ASSET_DIR="$REPO_ROOT/packages/deps/assets"
ARTIFACT="$ASSET_DIR/$ARTIFACT_NAME"
CHECKSUM_FILE="$ARTIFACT.sha256"

CHECK_ONLY=no
if [ "${1:-}" = "--check" ]; then CHECK_ONLY=yes; fi

WORK_DIR=$(mktemp -d)
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

# The npm tarball is the grammar source of record: it carries grammar.js and
# the generated src/parser.c at a version we can pin, with no git clone and no
# submodule.
(cd "$WORK_DIR" && npm pack "$GRAMMAR_PACKAGE@$GRAMMAR_VERSION" >/dev/null)
tar xzf "$WORK_DIR/$GRAMMAR_PACKAGE-$GRAMMAR_VERSION.tgz" -C "$WORK_DIR"

BUILT="$WORK_DIR/$ARTIFACT_NAME"
(cd "$WORK_DIR/package" && npx --yes "tree-sitter-cli@$TREE_SITTER_CLI_VERSION" build --wasm -o "$BUILT" .)

if [ "$CHECK_ONLY" = yes ]; then
  if cmp -s "$BUILT" "$ARTIFACT"; then
    echo "ok: rebuild is byte-identical to $ARTIFACT"
    exit 0
  fi
  echo "FAIL: rebuild differs from the committed $ARTIFACT_NAME" >&2
  exit 1
fi

mkdir -p "$ASSET_DIR"
cp "$BUILT" "$ARTIFACT"
# Recorded so the offline test suite can assert the committed artifact is the
# one this script produced, without running the build.
(cd "$ASSET_DIR" && shasum -a 256 "$ARTIFACT_NAME" > "$CHECKSUM_FILE")

cat "$CHECKSUM_FILE"
