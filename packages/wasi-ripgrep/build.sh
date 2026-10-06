#!/usr/bin/env bash
# ripgrep for slicc — WASI preview1 (wasm32-wasip1), no Emscripten glue.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-ripgrep

# Prefer rustup's cargo (wasm32-wasip1 std); fall back to PATH.
export PATH="${HOME}/.cargo/bin:${PATH}"
command -v cargo >/dev/null || { echo "missing cargo" >&2; exit 1; }
rustup target add wasm32-wasip1 >/dev/null 2>&1 || true

OUT="$WORK/wasi-ripgrep-${VER}"
mkdir -p "$OUT"

if [[ ! -f "$OUT/bin/rg.wasm" || -n "${FORCE:-}" ]]; then
  echo "== wasi-ripgrep: cargo install ripgrep@${VER} (wasm32-wasip1, stripped)"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  # Strip at link time — unstripped release is ~22 MB.
  CARGO_PROFILE_RELEASE_DEBUG=0 \
  CARGO_PROFILE_RELEASE_STRIP=true \
    cargo install ripgrep \
      --locked \
      --version "$VER" \
      --target wasm32-wasip1 \
      --root "$OUT" \
      --force
fi
test -f "$OUT/bin/rg.wasm"

# Optional further shrink; ignore if binaryen rejects features (bulk-memory).
if command -v wasm-opt >/dev/null 2>&1; then
  echo "== wasi-ripgrep: wasm-opt -Oz --strip-debug (best-effort)"
  if wasm-opt -Oz --strip-debug --enable-bulk-memory \
       "$OUT/bin/rg.wasm" -o "$OUT/bin/rg.opt.wasm" 2>/dev/null
  then
    mv "$OUT/bin/rg.opt.wasm" "$OUT/bin/rg.wasm"
  else
    rm -f "$OUT/bin/rg.opt.wasm"
    echo "== wasi-ripgrep: wasm-opt skipped (validator); keeping cargo-stripped wasm"
  fi
fi

echo "== wasi-ripgrep: stage bin/rg.wasm"
DEST="$HOMESCOOP_PKG/package/bin"
mkdir -p "$DEST"
cp "$OUT/bin/rg.wasm" "$DEST/rg.wasm"
chmod 755 "$DEST/rg.wasm"

# Licence files from the crates.io source unpack cargo used.
CRATE_SRC="$(find "${CARGO_HOME:-$HOME/.cargo}/registry/src" -type d -name "ripgrep-${VER}" 2>/dev/null | head -1 || true)"
if [[ -n "$CRATE_SRC" && -f "$CRATE_SRC/LICENSE-MIT" ]]; then
  {
    echo "ripgrep is dual-licensed under MIT OR Unlicense."
    echo
    echo "----- LICENSE-MIT -----"
    cat "$CRATE_SRC/LICENSE-MIT"
    echo
    echo "----- UNLICENSE -----"
    cat "$CRATE_SRC/UNLICENSE"
  } > "$HOMESCOOP_PKG/package/LICENSE"
elif [[ -n "$CRATE_SRC" && -f "$CRATE_SRC/COPYING" ]]; then
  cp "$CRATE_SRC/COPYING" "$HOMESCOOP_PKG/package/LICENSE"
else
  echo "homescoop: could not find ripgrep-${VER} licence in cargo registry" >&2
  exit 1
fi

# Refuse host paths in the wasm.
if strings "$DEST/rg.wasm" | grep -E '/Users/|/home/[^/]+/\.cargo' | grep -v 'crate' >/dev/null
then
  # strings can false-positive; only fail on clear absolute build-machine prefixes
  if strings "$DEST/rg.wasm" | grep -E '/Users/[^/]+/Developer|/var/folders/'
  then
    echo "homescoop: host path leaked into rg.wasm" >&2
    exit 1
  fi
fi

echo "== wasi-ripgrep: staged → $HOMESCOOP_PKG/package ($VER)"
