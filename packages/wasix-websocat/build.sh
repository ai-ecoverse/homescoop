#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-websocat
homescoop_load_recipe wasix-websocat --source mio
homescoop_load_recipe wasix-websocat --source licence
field() { node "$ROOT/scripts/read-recipe.mjs" wasix-websocat --field "$1"; }
RUST="$(field toolchain.rust)"
WASIX_RUST="$(field toolchain.wasix_rust)"
TARGET=wasm32-wasmer-wasi

TARBALL="$WORK/websocat-v$VERSION.tar.gz"
SRC_DIR="$WORK/websocat-$VERSION"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
rm -rf "$SRC_DIR"
homescoop_extract "$TARBALL" "$SRC_DIR"

MIO_CRATE="$WORK/mio-$MIO_VER.crate"
homescoop_fetch "$MIO_URL" "$MIO_SHA" "$MIO_CRATE"
MIO_DIR="$SRC_DIR/homescoop-crates/mio"
mkdir -p "$MIO_DIR"
tar xzf "$MIO_CRATE" -C "$MIO_DIR" --strip-components=1
for p in "$HOMESCOOP_PKG"/mio/*.patch; do
  echo "== patch mio/$(basename "$p")"
  patch -d "$MIO_DIR" -p1 <"$p"
done
homescoop_apply_patches "$SRC_DIR"
cp "$HOMESCOOP_PKG/Cargo.lock" "$SRC_DIR/Cargo.lock"

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
if ! command -v rustup >/dev/null 2>&1; then
  echo "== wasix-websocat: installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
rustup toolchain install "$RUST" --profile minimal

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    WR_ASSET=rust-toolchain-x86_64-unknown-linux-gnu.tar.gz
    WR_SHA=b57356d9592fdf6aa7c3b65f83ad7b6c9879a99263b6337f04ee652c704cacd9 ;;
  Darwin-arm64)
    WR_ASSET=rust-toolchain-aarch64-apple-darwin.tar.gz
    WR_SHA=815927a3894ac7a0d4b9709a5825a85678c94733225b9e4da574cfb9674b4059 ;;
  *) echo "wasix-websocat: no pinned WASIX Rust toolchain for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
WR_TGZ="$WORK/wasix-rust-$WASIX_RUST-$WR_ASSET"
homescoop_fetch "https://github.com/wasix-org/rust/releases/download/${WASIX_RUST//+/%2B}/$WR_ASSET" "$WR_SHA" "$WR_TGZ"
WR_DIR="$WORK/wasix-rust-$WASIX_RUST"
if [[ ! -x "$WR_DIR/bin/rustc" ]]; then
  rm -rf "$WR_DIR"
  mkdir -p "$WR_DIR"
  tar xzf "$WR_TGZ" -C "$WR_DIR"
  chmod +x "$WR_DIR"/bin/* "$WR_DIR"/lib/rustlib/*/bin/* "$WR_DIR"/lib/rustlib/*/bin/gcc-ld/* 2>/dev/null || true
fi
"$WR_DIR/bin/rustc" -vV

eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "${WASIXCC_HOME:-$WORK/wasixcc}")"
SYSROOT_LIB="$WASIXCC_SYSROOT_PREFIX/sysroot/lib/wasm32-wasip1"
test -f "$SYSROOT_LIB/libc.a" && test -f "$SYSROOT_LIB/crt1-command.o"
SYSROOT_VERSION="$(node -p "require('$WASIXCC_SYSROOT_PREFIX/package.json').version")"
WASM_OPT="$WASIXCC_BINARYEN_LOCATION/bin/wasm-opt"

CARGO=(cargo "+$RUST")
export RUSTC="$WR_DIR/bin/rustc"
export CC_wasm32_wasmer_wasi=wasixcc AR_wasm32_wasmer_wasi=wasixar
export CARGO_TARGET_DIR="$SRC_DIR/target"
# homescoop#1287: 0004 includes the shared allocator refresh on wasm. No
# larger initial heap: wasix-libc v2026-07-03.1's dlmalloc doesn't use the
# pages between __heap_base and the initial size (try_init_allocator is
# commented out), so they would only add to the process's memory.
homescoop_rust_wasm_refresh_alloc
export RUSTFLAGS="-C link-self-contained=no -L native=$SYSROOT_LIB -C link-arg=$SYSROOT_LIB/crt1-command.o -C codegen-units=1 --remap-path-prefix=$SRC_DIR=/websocat --remap-path-prefix=$(cd "$SRC_DIR" && pwd -P)=/websocat --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$WR_DIR=/wasix-rust"
FEATURES=(--no-default-features --features rustls)

echo "== wasix-websocat: cargo build ($TARGET, wasix-org/rust $WASIX_RUST, wasix-sysroot $SYSROOT_VERSION)"
(cd "$SRC_DIR" && "${CARGO[@]}" build --locked --release --target "$TARGET" "${FEATURES[@]}")
WASM="$SRC_DIR/target/$TARGET/release/websocat.wasm"
test -f "$WASM"

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
before=$(wc -c <"$WASM" | tr -d ' ')
"$WASM_OPT" -Oz --strip-debug "$WASM" -o "$DEST/bin/websocat.wasm"
chmod 755 "$DEST/bin/websocat.wasm"
echo "== wasix-websocat: wasm-opt $before → $(wc -c <"$DEST/bin/websocat.wasm" | tr -d ' ') bytes"

homescoop_fetch "$LICENCE_URL" "$LICENCE_SHA" "$WORK/websocat-LICENSE"
homescoop_fetch "https://raw.githubusercontent.com/spdx/license-list-data/v3.29.0/text/Apache-2.0.txt" \
  074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff "$WORK/Apache-2.0.txt"
{
  cat "$WORK/websocat-LICENSE"
  printf '\n---\n\nwebsocat %s'"'"'s Cargo.toml declares `license = "MIT/Apache-2.0"`; the Apache License 2.0 text follows (SPDX license-list-data v3.29.0).\n\n' "$VERSION"
  cat "$WORK/Apache-2.0.txt"
} >"$WORK/websocat-LICENSE-dual"
homescoop_stage_license "$WORK/websocat-LICENSE-dual"

homescoop_notices_begin "websocat.wasm (vi/websocat $VERSION, MIT OR Apache-2.0, see LICENSE; mio $MIO_VER with homescoop's patches, MIT) statically links these crates, the wasix-org Rust standard library ($WASIX_RUST) and @ai-ecoverse/wasix-sysroot $SYSROOT_VERSION."
META="$WORK/wasix-websocat-metadata.json"
TREE="$WORK/wasix-websocat-tree.txt"
(cd "$SRC_DIR" && "${CARGO[@]}" metadata --locked --format-version 1 --filter-platform "$TARGET" "${FEATURES[@]}") >"$META"
(cd "$SRC_DIR" && "${CARGO[@]}" tree --locked --target "$TARGET" -e normal,no-proc-macro --prefix none "${FEATURES[@]}") >"$TREE"
node "$ROOT/scripts/rust-crate-notices.mjs" "$META" "$TREE" |
  sed -E 's#^Source: https://crates\.io/crates/([^/]+)/([^ ]+\+wasix\.[0-9]+)$#Source: https://cargo-registry.wasix.org/api/v1/crates/\1/\2/download (the WASIX fork, from cargo-registry.wasix.org)#' >>"$HOMESCOOP_NOTICES"
node "$ROOT/scripts/check-rust-notices.mjs" "$HOMESCOOP_NOTICES" "$TREE" "$SRC_DIR/Cargo.lock"
homescoop_notice "mio $MIO_VER, the wasix-org fork of tokio-rs/mio with homescoop's mio/*.patch (MIT)" \
  "$MIO_DIR/LICENSE" -
WRG="https://raw.githubusercontent.com/wasix-org/rust/${WASIX_RUST//+/%2B}"
homescoop_notice "Rust standard library, wasix-org/rust $WASIX_RUST (MIT OR Apache-2.0)" \
  "$WRG/COPYRIGHT" 172020dbfd5b53a226dfde77616190a48dcff519b0bc0e6deb91a8450782c4af \
  "$WRG/LICENSE-MIT" b71bd43a069ca0641a9ecfe585ca7b3c53b5cc1608f8b68321168698e28b5ea1 \
  "$WRG/LICENSE-APACHE" 62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a
homescoop_notice "@ai-ecoverse/wasix-sysroot $SYSROOT_VERSION (wasix-libc, compiler-rt; see its LICENSE)" \
  "$WASIXCC_SYSROOT_PREFIX/LICENSE" -
echo "== wasix-websocat: staged → $DEST"
