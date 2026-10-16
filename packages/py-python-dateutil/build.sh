#!/usr/bin/env bash
# Pure-Python package: the recipe's wheel and its .pyc (scripts/stage-pure-wheel.sh).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
PKG="$(cd "$(dirname "$0")" && pwd)"
HOMESCOOP_PKG="$PKG"
bash "$ROOT/scripts/stage-pure-wheel.sh" py-python-dateutil
echo "== $(basename "$PKG"): staged $(du -sh "$PKG/package" | awk '{print $1}')"
