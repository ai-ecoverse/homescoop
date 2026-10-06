#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
PKG="$(cd "$(dirname "$0")" && pwd)"
HOMESCOOP_PKG="$PKG"
SITE="$PKG/package/lib/python3.14/site-packages"
if [[ ! -d "$SITE" ]]; then
  echo "homescoop: missing $SITE" >&2
  exit 1
fi
homescoop_compile_pyc "$SITE"
echo "== $(basename "$PKG"): staged $(du -sh "$PKG/package" | awk '{print $1}')"
