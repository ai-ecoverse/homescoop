#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$ROOT/scripts/build-common.sh"
PKG="$(cd "$(dirname "$0")" && pwd)"
HOMESCOOP_PKG="$PKG"
SITE="$PKG/package/lib/python3.14/site-packages"
homescoop_compile_pyc "$SITE"
echo "== py-kiwisolver: staged $(du -sh "$PKG/package" | awk '{print $1}')"
