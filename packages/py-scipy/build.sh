#!/usr/bin/env bash
# Stage a prebuilt wasix scipy into package/.
# Prefers WASIX_SCIPY_STAGE; otherwise downloads the GitHub release tarball.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-scipy

DEST="$HOMESCOOP_PKG/package"
STAGE="${WASIX_SCIPY_STAGE:-$WORK/py-scipy-${VER}/stage}"
PKG_VER="$(node -p "require('$DEST/package.json').version")"
REL_TAG="py-scipy-${PKG_VER}"
REL_TGZ="ai-ecoverse-py-scipy-${PKG_VER}.tgz"
REL_URL="${WASIX_SCIPY_RELEASE_URL:-https://github.com/ai-ecoverse/homescoop/releases/download/${REL_TAG}/${REL_TGZ}}"
NEED_PYC=1

have_scipy() {
  [[ -d "$1/lib/python3.14/site-packages/scipy" ]] \
    && compgen -G "$1/lib/python3.14/site-packages/scipy/*.cpython-314-wasm32-wasix.so" >/dev/null \
    || compgen -G "$1/lib/python3.14/site-packages/scipy/**/*.cpython-314-wasm32-wasix.so" >/dev/null
}

if have_scipy "$DEST"; then
  echo "== py-scipy: using existing $DEST"
  NEED_PYC=0
elif [[ -d "$STAGE/lib/python3.14/site-packages/scipy" ]]; then
  echo "== py-scipy: using stage $STAGE"
  mkdir -p "$DEST/lib/python3.14"
  rsync -a --delete "$STAGE/lib/" "$DEST/lib/"
elif curl -fsI "$REL_URL" >/dev/null 2>&1; then
  echo "== py-scipy: downloading release $REL_URL"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/$REL_TGZ" "$REL_URL"
  tar -xzf "$tmp/$REL_TGZ" -C "$tmp"
  mkdir -p "$DEST/lib"
  rsync -a --delete "$tmp/package/lib/" "$DEST/lib/"
  for f in LICENSE README.md; do
    [[ -f "$tmp/package/$f" && ! -f "$DEST/$f" ]] && cp "$tmp/package/$f" "$DEST/$f"
  done
  rm -rf "$tmp"
  NEED_PYC=0
else
  echo "homescoop: scipy wasix tree missing under $DEST (and no stage/release)" >&2
  exit 1
fi

if ! have_scipy "$DEST"; then
  echo "homescoop: scipy wasix tree missing under $DEST" >&2
  exit 1
fi
if [[ ! -f "$DEST/LICENSE" ]]; then
  echo "homescoop: missing LICENSE" >&2
  exit 1
fi
if [[ "$NEED_PYC" == 1 ]]; then
  homescoop_compile_pyc "$DEST/lib/python3.14/site-packages"
fi
echo "== py-scipy: staged $(du -sh "$DEST" | awk '{print $1}') pkg=$PKG_VER"
