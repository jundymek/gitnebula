#!/usr/bin/env sh
# Builds the crafted Python source tree used by `deps` tests (AD-14, story 3.1).
#
# Written into the gitignored test-fixtures/.generated/python-imports-repo —
# built, never committed. It covers every resolution rule AC-3 names:
#
#   absolute intra-repo imports   `import app.service`, `from core import model`
#   relative imports              `from . import util`, `from ..core.engine import …`
#   packages via __init__.py      `from core import MISSING` -> core/__init__.py
#   a non-root source root        lib/pkg/… imported as `pkg.…`
#   aliased and wildcard imports  `import core.model as m`, `from .helpers import *`
#   stdlib and site-packages      os, json, __future__, numpy — external, never edges
#   a relative import that walks out of the repo, and one naming nothing
#   a file with syntax errors     (AC-4)
#
# Like build-ts-fixture-repo.sh, this tree has no git history: deps reads the
# working tree, never the log. githist's build-fixture-repo.sh is deliberately
# untouched — its commit hashes are pinned by story 2.3's snapshots.
#
# The syntax-error file is why the tree is generated rather than committed: as
# a committed .py it would be a permanently broken file in the repository.
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR="$ROOT_DIR/.generated/python-imports-repo"

rm -rf "$REPO_DIR"
mkdir -p "$REPO_DIR"

write() {
  # write <path-relative-to-REPO_DIR>; content on stdin
  mkdir -p "$(dirname -- "$REPO_DIR/$1")"
  cat > "$REPO_DIR/$1"
}

# --- top-level module: parent is null in the ScanResult, so its edges exist at
# --- file level and contribute no module edge (D6) -------------------------

write flat.py <<'EOF'
# Absolute intra-repo import of a module inside a package.
import app.service
# `from <package> import <submodule>`: the name is the module.
from core import model
# `from <package> import <symbol>`: the name is not a module, so the package's
# __init__.py is the dependency.
from core import MISSING_SYMBOL
# Stdlib: external, never an edge.
import os
# Site-packages, and not installed here either — same classification.
import numpy as np

print(app.service, model, MISSING_SYMBOL, os, np)
EOF

# --- package `app` ---------------------------------------------------------

write app/__init__.py <<'EOF'
from .service import run
from . import util
EOF

write app/service.py <<'EOF'
# Two dots from app/ climb to the repo root, then down into core.
from ..core.engine import Engine
from .util import helper
# Three dots climb out of the repo: nothing can answer this, and it is
# relative, so it is a genuine unresolved import rather than a package.
from ...outside import gone

run = (Engine, helper, gone)
EOF

write app/util.py <<'EOF'
from __future__ import annotations
import json
# Relative import of a module that does not exist: unresolved.
from .missing import absent


def helper() -> str:
    return json.dumps(absent)
EOF

# --- package `core` --------------------------------------------------------

write core/__init__.py <<'EOF'
# Absolute self-reference by package name, the form a repo uses when its
# package sits at the repo root.
from core.model import Model

__all__ = ["Model"]
EOF

write core/engine.py <<'EOF'
# Wildcard: no names, so the module itself is the dependency.
from .helpers import *
# Aliased absolute import.
import core.model as m


class Engine:
    model = m.Model
EOF

write core/model.py <<'EOF'
from __future__ import annotations


class Model:
    pass
EOF

write core/helpers.py <<'EOF'
import os.path

BASE = os.path.sep
EOF

# --- a source root that is not the repo root: `lib/pkg` is imported as `pkg`,
# --- which is the layout streamlit and many packaged projects use -----------

write lib/pkg/__init__.py <<'EOF'
EOF

write lib/pkg/deep/__init__.py <<'EOF'
import pkg.tools
EOF

write lib/pkg/tools.py <<'EOF'
# Relative import of a sibling *package*: resolves to its __init__.py.
from . import deep

TOOLS = deep
EOF

# --- a file that does not parse (AC-4) -------------------------------------

write broken.py <<'EOF'
def broken( :
    this is not python ][
EOF

printf '%s\n' "$REPO_DIR"
