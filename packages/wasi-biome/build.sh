#!/usr/bin/env bash
# Biome CLI for slicc WASI (wasm32-wasip1-threads), no Emscripten glue.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-biome

TARBALL="$WORK/biome-${VERSION}.tar.gz"
SRC_DIR="$WORK/biome-${VERSION}"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" || ! -f "$SRC_DIR/Cargo.toml" ]]; then
  rm -rf "$SRC_DIR"
  mkdir -p "$SRC_DIR"
  # The archive's top-level directory is biome--biomejs-biome-<version>.
  tar -xzf "$TARBALL" -C "$SRC_DIR" --strip-components=1
fi
homescoop_apply_patches "$SRC_DIR"

# The crawler, scanner and module graph run on std threads (and rayon), so
# Biome builds for wasm32-wasip1-threads; the kernel runs wasi thread-spawn.
TARGET=wasm32-wasip1-threads

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
if ! command -v rustup >/dev/null 2>&1; then
  echo "== wasi-biome: installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
# rust-toolchain.toml pins Biome's toolchain; add the target to that one.
(cd "$SRC_DIR" && rustup show active-toolchain >/dev/null 2>&1 || rustup toolchain install)
(cd "$SRC_DIR" && rustup target add "$TARGET")

OUT="$WORK/wasi-biome-${VERSION}"
mkdir -p "$OUT"
echo "== wasi-biome: cargo build -p biome_cli ($TARGET)"
(
  cd "$SRC_DIR"
  # As upstream's release build: strip, one codegen unit, version inlined.
  # tokio refuses io-std/net/rt-multi-thread on wasm without tokio_unstable.
  # Up to 4 GiB of memory (the kernel caps it at what the engine reserves).
  # Panic locations name source files: map the build machine's paths away.
  BIOME_VERSION="$VERSION" \
  RUSTFLAGS="--cfg tokio_unstable -C strip=symbols -C codegen-units=1 -C link-arg=--max-memory=4294967296 --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$SRC_DIR=/biome" \
  CARGO_TARGET_DIR="$OUT/target" \
    cargo build --release --locked -p biome_cli --target "$TARGET"
)
WASM="$OUT/target/$TARGET/release/biome.wasm"
test -f "$WASM"

DEST="$HOMESCOOP_PKG/package/bin"
mkdir -p "$DEST"
cp "$WASM" "$DEST/biome.wasm"
chmod 755 "$DEST/biome.wasm"

{
  echo "Biome is dual-licensed under MIT OR Apache-2.0."
  echo
  echo "----- LICENSE-MIT -----"
  cat "$SRC_DIR/LICENSE-MIT"
  echo
  echo "----- LICENSE-APACHE -----"
  cat "$SRC_DIR/LICENSE-APACHE"
} > "$HOMESCOOP_PKG/package/LICENSE"

if strings "$DEST/biome.wasm" | grep -E '/Users/[^/]+/|/home/runner/|/var/folders/' >/dev/null; then
  echo "homescoop: host path leaked into biome.wasm" >&2
  strings "$DEST/biome.wasm" | grep -E '/Users/[^/]+/|/home/runner/|/var/folders/' | head -5 >&2
  exit 1
fi
shasum -a 256 "$DEST/biome.wasm"
echo "OK wasi-biome $VERSION (biome)"
