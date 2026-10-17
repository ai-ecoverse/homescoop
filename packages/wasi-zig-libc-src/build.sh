#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-zig-libc-src
PKG_WORK="$WORK/wasi-zig-libc-src"
mkdir -p "$PKG_WORK"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$PKG_WORK/zig-$VERSION.tar.xz"
SRC="$PKG_WORK/zig-$VERSION"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xJf "$PKG_WORK/zig-$VERSION.tar.xz" -C "$SRC" --strip-components=1
DEST="$HOMESCOOP_PKG/package"
rm -rf "$DEST/lib"
mkdir -p "$DEST/lib/libc"
cp -R "$SRC/lib/libc/wasi" "$SRC/lib/libc/musl" "$DEST/lib/libc/"
find "$DEST/lib" -type l -exec sh -c 'for l; do t=$(readlink -f "$l"); rm "$l"; cp -a "$t" "$l"; done' _ {} +
cp "$SRC/LICENSE" "$DEST/LICENSE"
homescoop_assert_no_package_links "$DEST"
echo "OK wasi-zig-libc-src $VERSION ($(find "$DEST/lib" -type f | wc -l | tr -d ' ') files)"
