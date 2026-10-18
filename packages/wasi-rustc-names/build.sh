#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-rustc-names
PKG="$HOMESCOOP_PKG"
bash "$ROOT/packages/wasi-rustc/build.sh"
NAMES="/tmp/homescoop-wasi-rustc-$VERSION/rustc.wasm.names"
REBUILT="$ROOT/packages/wasi-rustc/package/bin/rustc.wasm"
test -s "$NAMES"
test -s "$REBUILT"
eval "$(node "$ROOT/scripts/recipe-env.mjs" wasi-rustc-names --source wasi_rustc)"
CHECK="$WORK/wasi-rustc-names"
rm -rf "$CHECK"
mkdir -p "$CHECK"
homescoop_fetch "$WASI_RUSTC_URL" "$WASI_RUSTC_SHA" "$CHECK/wasi-rustc.tgz"
tar -xzf "$CHECK/wasi-rustc.tgz" -C "$CHECK" package/bin/rustc.wasm package/package.json
want="$(node -p "require('$CHECK/package/package.json').version")"
have="$(node -p "require('$PKG/package/package.json').version")"
[[ "$want" == "$have" ]] || { echo "homescoop: wasi-rustc-names $have, but sources.wasi_rustc is wasi-rustc $want" >&2; exit 1; }
published="$(shasum -a 256 "$CHECK/package/bin/rustc.wasm" | cut -d' ' -f1)"
rebuilt="$(shasum -a 256 "$REBUILT" | cut -d' ' -f1)"
echo "== rustc.wasm: published $published, rebuilt $rebuilt"
[[ "$published" == "$rebuilt" ]] || { echo "homescoop: the rebuilt rustc.wasm is not the published wasi-rustc $want's, so these names would not match it" >&2; exit 1; }
mkdir -p "$PKG/package/bin"
cp "$NAMES" "$PKG/package/bin/rustc.wasm.names"
shasum -a 256 "$PKG/package/bin/rustc.wasm.names"
echo "OK wasi-rustc-names $VERSION ($(wc -c <"$PKG/package/bin/rustc.wasm.names" | tr -d ' ') bytes, for rustc.wasm $published)"
