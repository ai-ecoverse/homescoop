#!/usr/bin/env bash
# Shared helpers for host build.sh scripts. Source from packages/*/build.sh.
# Expects HOMESCOOP_ROOT; sets WORK and PREFIX defaults.
set -euo pipefail

: "${HOMESCOOP_ROOT:?HOMESCOOP_ROOT required}"
WORK="${HOMESCOOP_WORK:-${TMPDIR:-/tmp}/homescoop-work}"
PREFIX="${PREFIX:-${TMPDIR:-/tmp}/homescoop-prefix}"
mkdir -p "$WORK" "$PREFIX/lib" "$PREFIX/include"

homescoop_fetch() {
  # homescoop_fetch <url> <sha256> <tarball-path>
  local url="$1" sha="$2" tarball="$3"
  if [[ ! -f "$tarball" ]]; then
    echo "== fetch $url"
    curl -fsSL "$url" -o "$tarball"
  fi
  echo "$sha  $tarball" | shasum -a 256 -c -
}

homescoop_extract() {
  # homescoop_extract <tarball> <srcdir> — extract once unless FORCE
  local tarball="$1" srcdir="$2"
  if [[ -d "$srcdir" && -z "${FORCE:-}" ]]; then
    echo "== have source $srcdir"
    return 0
  fi
  rm -rf "$srcdir"
  mkdir -p "$(dirname "$srcdir")"
  case "$tarball" in
    *.tar.xz|*.txz) tar xJf "$tarball" -C "$(dirname "$srcdir")" ;;
    *.tar.bz2|*.tbz2) tar xjf "$tarball" -C "$(dirname "$srcdir")" ;;
    *) tar xzf "$tarball" -C "$(dirname "$srcdir")" ;;
  esac
}

homescoop_stage_lib() {
  # homescoop_stage_lib <src.a> <dest-name.a>
  local src="$1" name="$2"
  local dest="$HOMESCOOP_PKG/package/lib"
  mkdir -p "$dest" "$PREFIX/lib"
  cp "$src" "$dest/$name"
  cp "$src" "$PREFIX/lib/$name"
}

homescoop_stage_headers() {
  # homescoop_stage_headers <file...> — copy into package/include and PREFIX
  local dest="$HOMESCOOP_PKG/package/include"
  mkdir -p "$dest" "$PREFIX/include"
  local f
  for f in "$@"; do
    cp "$f" "$dest/$(basename "$f")"
    cp "$f" "$PREFIX/include/$(basename "$f")"
  done
}

homescoop_fix_darwin_ar() {
  # macOS configure often sets AR=libtool ARFLAGS=-o, which cannot archive
  # wasm objects (empty .a). Force emar/rcs when that pattern is present.
  local mf="${1:-Makefile}"
  if [[ -f "$mf" ]] && grep -q '^AR=libtool$' "$mf" 2>/dev/null; then
    echo "== patch $mf: AR=libtool → emar"
    perl -i -pe 's/^AR=libtool$/AR=emar/; s/^ARFLAGS=-o$/ARFLAGS=rcs/' "$mf"
  fi
}

homescoop_require_lib_size() {
  local f="$1" min="${2:-10000}"
  local sz
  sz=$(wc -c < "$f" | tr -d ' ')
  if [[ "$sz" -lt "$min" ]]; then
    echo "homescoop: $f too small ($sz bytes; expected >= $min)" >&2
    exit 1
  fi
  echo "$sz"
}
