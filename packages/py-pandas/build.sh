#!/usr/bin/env bash
# Stage a prebuilt wasix pandas tree into package/.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-pandas

DEST="$HOMESCOOP_PKG/package"
STAGE="${WASIX_PANDAS_STAGE:-$WORK/py-pandas-${VER}/stage}"
WHL="${WASIX_PANDAS_WHEEL:-}"

if [[ -n "$WHL" && -f "$WHL" ]]; then
  echo "== py-pandas: unpacking $WHL"
  rm -rf "$STAGE"
  mkdir -p "$STAGE/lib/python3.14/site-packages"
  unzip -q -o "$WHL" -d "$STAGE/lib/python3.14/site-packages"
elif [[ -d "$STAGE/lib/python3.14/site-packages/pandas" ]]; then
  echo "== py-pandas: using stage $STAGE"
else
  echo "homescoop: set WASIX_PANDAS_STAGE to a staged tree with pandas," >&2
  echo "  or WASIX_PANDAS_WHEEL to a cp314 wasix_wasm32 wheel" >&2
  exit 1
fi

mkdir -p "$DEST/lib/python3.14"
rsync -a --delete "$STAGE/lib/" "$DEST/lib/"
SITE="$DEST/lib/python3.14/site-packages"
# Post-wheel runtime patch: lazy ctypes (wasix has no _ctypes).
CTYPES_PATCH="$HOMESCOOP_PKG/patches/0002-lazy-ctypes.patch"
if [[ -f "$CTYPES_PATCH" && -f "$SITE/pandas/errors/__init__.py" ]]; then
  if grep -q '^import ctypes$' "$SITE/pandas/errors/__init__.py"; then
    echo "== patch $(basename "$CTYPES_PATCH")"
    patch -d "$SITE" -p1 < "$CTYPES_PATCH"
  else
    echo "== patch $(basename "$CTYPES_PATCH"): already applied"
  fi
fi
if [[ ! -f "$DEST/LICENSE" ]]; then
  echo "homescoop: missing LICENSE (copy from pandas LICENSE)" >&2
  exit 1
fi
homescoop_compile_pyc "$SITE"
echo "== py-pandas: staged $(du -sh "$DEST" | awk '{print $1}')"
