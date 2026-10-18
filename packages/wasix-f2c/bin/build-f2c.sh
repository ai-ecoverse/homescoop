#!/usr/bin/env bash
# build-f2c.sh [<out-dir>]: build the f2c translator (hoodmane/f2c, the
# pinned source in share/f2c/src) with the host C compiler and print its
# path. It's a host tool, so the package ships its source, not a binary for
# one host. Without <out-dir> it builds once into
# ${WASIX_F2C_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/wasix-f2c}/<version>.
set -euo pipefail
PKG="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PKG/package.json" | head -1)"
OUT="${1:-${WASIX_F2C_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/wasix-f2c}/$VER}"
if [[ -x "$OUT/f2c" ]]; then
  echo "$OUT/f2c"
  exit 0
fi
TMP="$(mktemp -d "${TMPDIR:-/tmp}/wasix-f2c-build.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
cp -R "$PKG/share/f2c/src/." "$TMP/"
# gram.c ships generated: don't regenerate it with yacc (as Pyodide does).
sed 's/^gram\.c:/gram.c1:/' "$TMP/makefile.u" >"$TMP/makefile"
make -s -C "$TMP" CC="${HOST_CC:-${CC_FOR_BUILD:-cc}}" CFLAGS="-O -w" f2c >&2
mkdir -p "$OUT"
cp "$TMP/f2c" "$OUT/f2c.tmp.$$"
mv "$OUT/f2c.tmp.$$" "$OUT/f2c"
echo "$OUT/f2c"
