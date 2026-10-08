#!/usr/bin/env bash
# impeccable engine for slicc — WASI preview1 file-local CLI (no Emscripten glue).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-impeccable

# GitHub archive top-level: impeccable-engine-v<version>/
SRC_DIR="$WORK/impeccable-engine-v${VERSION}"
TARBALL="$WORK/impeccable-engine-v${VERSION}.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
# HTTP verbs use crates/wasix-ureq (ureq 2's API over the kernel's sockets and
# proxy); the patch depends on it at homescoop-crates/.
homescoop_vendor_crates "$SRC_DIR" wasix-ureq
homescoop_apply_patches "$SRC_DIR"

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
if ! command -v cargo >/dev/null 2>&1; then
  echo "== wasi-impeccable: installing rustup (stable + wasm32-wasip1)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-wasip1
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
command -v cargo >/dev/null || { echo "missing cargo" >&2; exit 1; }
rustup target add wasm32-wasip1 >/dev/null 2>&1 || true

OUT="$WORK/wasi-impeccable-${VERSION}"
mkdir -p "$OUT/bin"

if [[ ! -f "$OUT/bin/impeccable.wasm" || -n "${FORCE:-}" ]]; then
  echo "== wasi-impeccable: cargo build -p impeccable (wasm32-wasip1, stripped)"
  (
    cd "$SRC_DIR"
    CARGO_PROFILE_RELEASE_DEBUG=0 \
    CARGO_PROFILE_RELEASE_STRIP=true \
      cargo build --release -p impeccable --target wasm32-wasip1
  )
  cp "$SRC_DIR/target/wasm32-wasip1/release/impeccable.wasm" "$OUT/bin/impeccable.wasm"
fi
test -f "$OUT/bin/impeccable.wasm"

# Shrink like other wasi- Rust recipes. rustc emits bulk-memory / multivalue /
# reference-types / etc.; binaryen needs those features enabled or it rejects
# the module (bulk-memory alone is not enough for this crate).
if command -v wasm-opt >/dev/null 2>&1; then
  echo "== wasi-impeccable: wasm-opt -Oz --strip-debug"
  before=$(wc -c < "$OUT/bin/impeccable.wasm" | tr -d ' ')
  if wasm-opt -Oz --strip-debug \
       --enable-bulk-memory --enable-multivalue --enable-reference-types \
       --enable-nontrapping-float-to-int --enable-sign-ext \
       "$OUT/bin/impeccable.wasm" -o "$OUT/bin/impeccable.opt.wasm" 2>/dev/null
  then
    mv "$OUT/bin/impeccable.opt.wasm" "$OUT/bin/impeccable.wasm"
    after=$(wc -c < "$OUT/bin/impeccable.wasm" | tr -d ' ')
    echo "== wasi-impeccable: wasm-opt $before → $after bytes"
  else
    rm -f "$OUT/bin/impeccable.opt.wasm"
    echo "== wasi-impeccable: wasm-opt skipped (validator); keeping cargo-stripped wasm"
  fi
fi

echo "== wasi-impeccable: stage bin/impeccable.wasm"
DEST="$HOMESCOOP_PKG/package/bin"
mkdir -p "$DEST"
cp "$OUT/bin/impeccable.wasm" "$DEST/impeccable.wasm"
chmod 755 "$DEST/impeccable.wasm"

homescoop_stage_license "$SRC_DIR/LICENSE"

# Refuse clear host-path leaks in the wasm.
if strings "$DEST/impeccable.wasm" | grep -E '/Users/[^/]+/Developer|/var/folders/' >/dev/null
then
  echo "homescoop: host path leaked into impeccable.wasm" >&2
  exit 1
fi

echo "== wasi-impeccable: staged → $HOMESCOOP_PKG/package ($VERSION)"
