#!/usr/bin/env bash
# uv-shim: stage the in-tree src/uv.py as bin/uv (no compile step).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
# No upstream source, so not homescoop_load_recipe (it requires source.url).
HOMESCOOP_PKG="$ROOT/packages/uv-shim"
mkdir -p "$HOMESCOOP_PKG/package/bin"
cp "$HOMESCOOP_PKG/src/uv.py" "$HOMESCOOP_PKG/package/bin/uv"
chmod 755 "$HOMESCOOP_PKG/package/bin/uv"
echo "== uv-shim: staged → $HOMESCOOP_PKG/package"
