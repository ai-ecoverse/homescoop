#!/usr/bin/env bash
# apply.sh <fnox-src-dir> <homescoop-root>
#
# Turns an unpacked jdx/fnox v1.39.0 source tree into slicc's fnox: applies
# packages/wasi-fnox/NNNN-*.patch in filename order (each checked with
# `git apply --check` first) and copies homescoop's crates/wasix-command
# into <fnox-src-dir>/crates/wasix-command, the path dependency the patches
# name. build.sh runs it on a fresh extract.
set -euo pipefail
SRC="${1:?usage: apply.sh <fnox-src-dir> <homescoop-root>}"
ROOT="${2:?usage: apply.sh <fnox-src-dir> <homescoop-root>}"
SRC="$(cd "$SRC" && pwd)"
ROOT="$(cd "$ROOT" && pwd)"
PATCHES="$ROOT/packages/wasi-fnox"
CRATE="$ROOT/crates/wasix-command"

die() { echo "wasi-fnox apply.sh: $*" >&2; exit 1; }
test -f "$SRC/Cargo.toml" && test -d "$SRC/crates/fnox-core" || die "$SRC is not a fnox source tree"
test -f "$CRATE/Cargo.toml" || die "missing $CRATE"
test -e "$SRC/.slicc-patched" && die "$SRC is already patched; start from a fresh extract"

shopt -s nullglob
series=("$PATCHES"/[0-9][0-9][0-9][0-9]-*.patch)
((${#series[@]})) || die "no NNNN-*.patch in $PATCHES"

# Never let git find a repository above the source tree: the patches are
# applied to the files, not to whatever checkout the tree sits in.
export GIT_CEILING_DIRECTORIES="$(dirname "$SRC")"
for p in "${series[@]}"; do
  name="$(basename "$p")"
  if ! (cd "$SRC" && git apply --check "$p"); then
    die "$name does not apply to $SRC (is it jdx/fnox v1.39.0, unpatched?)"
  fi
  (cd "$SRC" && git apply "$p") || die "$name failed to apply after a clean --check"
  echo "== wasi-fnox: applied $name"
done

rm -rf "$SRC/crates/wasix-command"
mkdir -p "$SRC/crates/wasix-command"
(cd "$CRATE" && tar cf - --exclude target Cargo.toml src) | (cd "$SRC/crates/wasix-command" && tar xf -)
echo "== wasi-fnox: copied crates/wasix-command from $CRATE"

printf '%s\n' "${series[@]##*/}" >"$SRC/.slicc-patched"
