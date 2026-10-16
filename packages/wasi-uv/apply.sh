#!/usr/bin/env bash
# apply.sh <uv-src-dir> <homescoop-root> <download-dir>
#
# Turns an unpacked astral-sh/uv source tree into slicc's uv:
# 1. unpacks the crates.io crates named by packages/wasi-uv/crates/*.patch
#    (<name>-<version>.patch) into <uv-src-dir>/homescoop-crates/, each
#    checked against the checksum in uv's own (unpatched) Cargo.lock, and
#    patches them;
# 2. copies homescoop's crates/wasix-command next to them;
# 3. applies packages/wasi-uv/NNNN-*.patch in filename order, each checked
#    with `git apply --check` first. 0001 points [patch.crates-io] and the
#    wasix-command dependency at homescoop-crates/.
# build.sh runs it on a fresh extract. The std patch (rust/) is build.sh's.
set -euo pipefail
SRC="${1:?usage: apply.sh <uv-src-dir> <homescoop-root> <download-dir>}"
ROOT="${2:?usage: apply.sh <uv-src-dir> <homescoop-root> <download-dir>}"
DL="${3:?usage: apply.sh <uv-src-dir> <homescoop-root> <download-dir>}"
SRC="$(cd "$SRC" && pwd)"
ROOT="$(cd "$ROOT" && pwd)"
PKG="$ROOT/packages/wasi-uv"
CRATE="$ROOT/crates/wasix-command"
mkdir -p "$DL"

die() { echo "wasi-uv apply.sh: $*" >&2; exit 1; }
test -f "$SRC/Cargo.toml" && test -d "$SRC/crates/uv" || die "$SRC is not a uv source tree"
test -f "$CRATE/Cargo.toml" || die "missing $CRATE"
test -e "$SRC/.slicc-patched" && die "$SRC is already patched; start from a fresh extract"

# Never let git find a repository above the source tree.
export GIT_CEILING_DIRECTORIES="$(dirname "$SRC")"

shopt -s nullglob
crate_patches=("$PKG"/crates/*.patch)
series=("$PKG"/[0-9][0-9][0-9][0-9]-*.patch)
((${#crate_patches[@]})) || die "no crates/*.patch in $PKG"
((${#series[@]})) || die "no NNNN-*.patch in $PKG"

# The checksum uv's Cargo.lock records for <name> <version>.
lock_checksum() {
  awk -v n="$1" -v v="$2" '
    /^\[\[package\]\]/ { name = ""; ver = "" }
    /^name = / { gsub(/"/, "", $3); name = $3 }
    /^version = / { gsub(/"/, "", $3); ver = $3 }
    /^checksum = / && name == n && ver == v { gsub(/"/, "", $3); print $3; exit }
  ' "$SRC/Cargo.lock"
}

mkdir -p "$SRC/homescoop-crates"
for p in "${crate_patches[@]}"; do
  base="$(basename "$p" .patch)"
  name="${base%-*}"
  version="${base##*-}"
  sha="$(lock_checksum "$name" "$version")"
  test -n "$sha" || die "$name $version is not in uv's Cargo.lock (did the uv bump change it? refresh crates/$base.patch)"
  file="$DL/$base.crate"
  if ! { test -f "$file" && echo "$sha  $file" | shasum -a 256 -c - >/dev/null 2>&1; }; then
    curl -fsSL --retry 5 --retry-all-errors "https://static.crates.io/crates/$name/$base.crate" -o "$file"
    echo "$sha  $file" | shasum -a 256 -c - >/dev/null || die "$base.crate: sha256 is not $sha"
  fi
  rm -rf "$SRC/homescoop-crates/$base"
  tar -xzf "$file" -C "$SRC/homescoop-crates"
  (cd "$SRC/homescoop-crates/$base" && git apply --check "$p" && git apply "$p") ||
    die "crates/$base.patch does not apply to $name $version"
  echo "== wasi-uv: patched crate $name $version"
done

rm -rf "$SRC/homescoop-crates/wasix-command"
mkdir -p "$SRC/homescoop-crates/wasix-command"
(cd "$CRATE" && tar cf - --exclude target Cargo.toml src) | (cd "$SRC/homescoop-crates/wasix-command" && tar xf -)
echo "== wasi-uv: copied crates/wasix-command from $CRATE"

for p in "${series[@]}"; do
  name="$(basename "$p")"
  (cd "$SRC" && git apply --check "$p") || die "$name does not apply to $SRC (is it astral-sh/uv, unpatched, the recipe's version?)"
  (cd "$SRC" && git apply "$p") || die "$name failed to apply after a clean --check"
  echo "== wasi-uv: applied $name"
done

printf '%s\n' "${series[@]##*/}" "${crate_patches[@]##*/}" >"$SRC/.slicc-patched"
