#!/usr/bin/env bash
# Stage a prebuilt wasix numpy into package/.
# Prefers WASIX_NUMPY_STAGE / WASIX_NUMPY_WHEEL; otherwise downloads the
# GitHub release tarball for this packaging version (OIDC ladder-build path).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-numpy

DEST="$HOMESCOOP_PKG/package"
STAGE="${WASIX_NUMPY_STAGE:-$WORK/py-numpy-${VER}/stage}"
WHL="${WASIX_NUMPY_WHEEL:-}"
PKG_VER="$(node -p "require('$DEST/package.json').version")"
REL_TAG="py-numpy-${PKG_VER}"
REL_TGZ="ai-ecoverse-py-numpy-${PKG_VER}.tgz"
REL_URL="${WASIX_NUMPY_RELEASE_URL:-https://github.com/ai-ecoverse/homescoop/releases/download/${REL_TAG}/${REL_TGZ}}"

have_numpy() {
  [[ -d "$1/lib/python3.14/site-packages/numpy" ]] \
    && compgen -G "$1/lib/python3.14/site-packages/numpy/_core/_multiarray_umath.cpython-314-wasm32-wasix.so" >/dev/null
}

if have_numpy "$DEST"; then
  echo "== py-numpy: using existing $DEST"
elif [[ -n "$WHL" && -f "$WHL" ]]; then
  echo "== py-numpy: unpacking wheel $WHL"
  rm -rf "$STAGE"
  mkdir -p "$STAGE/lib/python3.14/site-packages"
  unzip -q -o "$WHL" -d "$STAGE/lib/python3.14/site-packages"
  mkdir -p "$DEST/lib/python3.14"
  rsync -a --delete "$STAGE/lib/" "$DEST/lib/"
elif [[ -d "$STAGE/lib/python3.14/site-packages/numpy" ]]; then
  echo "== py-numpy: using stage $STAGE"
  mkdir -p "$DEST/lib/python3.14"
  rsync -a --delete "$STAGE/lib/" "$DEST/lib/"
else
  echo "== py-numpy: downloading release $REL_URL"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/$REL_TGZ" "$REL_URL"
  tar -xzf "$tmp/$REL_TGZ" -C "$tmp"
  # npm pack layout: package/{lib,LICENSE,README,package.json}
  mkdir -p "$DEST/lib"
  rsync -a --delete "$tmp/package/lib/" "$DEST/lib/"
  for f in LICENSE README.md; do
    [[ -f "$tmp/package/$f" && ! -f "$DEST/$f" ]] && cp "$tmp/package/$f" "$DEST/$f"
  done
  rm -rf "$tmp"
fi

if ! have_numpy "$DEST"; then
  echo "homescoop: numpy wasix tree missing under $DEST" >&2
  exit 1
fi
if [[ ! -f "$DEST/LICENSE" ]]; then
  echo "homescoop: missing LICENSE" >&2
  exit 1
fi
homescoop_compile_pyc "$DEST/lib/python3.14/site-packages"
echo "== py-numpy: staged $(du -sh "$DEST" | awk '{print $1}') pkg=$PKG_VER"
