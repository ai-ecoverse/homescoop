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
SRC="$WORK/ripgrep-${VER}"
VENDOR="$WORK/ripgrep-${VER}-vendor"
TB="$WORK/ripgrep-${VER}.crate"

if [[ ! -f "$OUT/bin/rg.wasm" || -n "${FORCE:-}" ]]; then
  echo "== wasi-ripgrep: ripgrep@${VER} from the .crate, deps vendored (--locked)"
  rm -rf "$OUT" "$SRC" "$VENDOR"
  mkdir -p "$OUT/bin"
  homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
  tar xzf "$TB" -C "$WORK"
  (cd "$SRC" && cargo vendor --locked --versioned-dirs "$VENDOR" >/dev/null)
  # homescoop#168: grep-cli treats stdin as never readable on WASI, so
  # `cmd | rg pat` searched the cwd. patches/ applies to the vendored crate;
  # an empty "files" map makes cargo skip per-file checksums for it only.
  GREP_CLI="$(cd "$VENDOR" && ls -d grep-cli-*)"
  for p in "$HOMESCOOP_PKG"/patches/grep-cli-*.patch; do
    echo "== patch $(basename "$p") → $GREP_CLI"
    patch -d "$VENDOR/$GREP_CLI" -p1 --no-backup-if-mismatch < "$p"
  done
  node -e 'const f=process.argv[1];const fs=require("fs");const j=JSON.parse(fs.readFileSync(f));j.files={};fs.writeFileSync(f,JSON.stringify(j))' \
    "$VENDOR/$GREP_CLI/.cargo-checksum.json"
  # Strip at link time — unstripped release is ~22 MB.
  # Keep host paths out of the wasm (panic and log locations).
  (cd "$SRC" && CARGO_TARGET_DIR="$WORK/ripgrep-target" \
    RUSTFLAGS="--remap-path-prefix=$VENDOR=/vendor --remap-path-prefix=$SRC=/ripgrep --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$(rustc --print sysroot)=/rustc" \
    CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=true \
    cargo build --release --locked --offline --target wasm32-wasip1 \
      --config 'source.crates-io.replace-with="vendored-sources"' \
      --config "source.vendored-sources.directory=\"$VENDOR\"")
  cp "$WORK/ripgrep-target/wasm32-wasip1/release/rg.wasm" "$OUT/bin/rg.wasm"
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

# Licence files from the unpacked .crate.
CRATE_SRC="$SRC"
if [[ -f "$CRATE_SRC/LICENSE-MIT" && -f "$CRATE_SRC/UNLICENSE" ]]; then
  {
    echo "ripgrep is dual-licensed under MIT OR Unlicense."
    echo
    echo "----- LICENSE-MIT -----"
    cat "$CRATE_SRC/LICENSE-MIT"
    echo
    echo "----- UNLICENSE -----"
    cat "$CRATE_SRC/UNLICENSE"
  } > "$HOMESCOOP_PKG/package/LICENSE"
else
  echo "homescoop: no LICENSE-MIT/UNLICENSE in ripgrep-${VER}.crate" >&2
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
