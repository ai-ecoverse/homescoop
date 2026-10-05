#!/usr/bin/env bash
# pnpm 12 for slicc WASI: stage upstream's pnpm.wasm from @pnpm/wasm.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-pnpm

TARBALL="$WORK/pnpm-wasm-${VERSION}.tgz"
SRC="$WORK/pnpm-wasm-${VERSION}"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"

INTEGRITY="$(node "$ROOT/scripts/read-recipe.mjs" wasi-pnpm --field source.integrity)"
ACTUAL="sha512-$(openssl dgst -sha512 -binary "$TARBALL" | base64 | tr -d '\n')"
if [[ "$ACTUAL" != "$INTEGRITY" ]]; then
  echo "homescoop: npm integrity mismatch for @pnpm/wasm@${VERSION}: $ACTUAL" >&2
  exit 1
fi

rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$TARBALL" -C "$SRC"
DIST="$SRC/package/dist"
test -f "$DIST/pnpm.wasm"

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
cp "$DIST/pnpm.wasm" "$DEST/bin/pnpm.wasm"
chmod 755 "$DEST/bin/pnpm.wasm"
cp "$DIST/LICENSE" "$DEST/LICENSE"
cp "$DIST/THIRD-PARTY-NOTICES.md" "$DEST/THIRD-PARTY-NOTICES.md"
shasum -a 256 "$DEST/bin/pnpm.wasm"
echo "OK wasi-pnpm $VERSION"
