#!/usr/bin/env bash
# wasi-uv: build astral-sh/uv (plus packages/wasi-uv's patches, applied by
# apply.sh) for wasm32-wasip1-threads against a patched Rust std
# (-Zbuild-std), shrink it with wasm-opt, and stage bin/uv.wasm with
# LICENSE and THIRD-PARTY-NOTICES.md.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-uv
field() { node "$ROOT/scripts/read-recipe.mjs" wasi-uv --field "$1"; }
RUST="$(field toolchain.rust)"
BINARYEN="$(field toolchain.binaryen)"
WASI_SDK="$(field toolchain.wasi-sdk)"
TARGET=wasm32-wasip1-threads

TARBALL="$WORK/uv-$VERSION.tar.gz"
SRC_DIR="$WORK/uv-$VERSION"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
# Always from a fresh extract: apply.sh refuses a tree it has patched.
rm -rf "$SRC_DIR"
homescoop_extract "$TARBALL" "$SRC_DIR"
bash "$HOMESCOOP_PKG/apply.sh" "$SRC_DIR" "$ROOT" "$WORK/crates"

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
if ! command -v rustup >/dev/null 2>&1; then
  echo "== wasi-uv: installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
rustup toolchain install "$RUST" --profile minimal --component rust-src --target "$TARGET"

# A copy of the toolchain whose rust-src carries rust/*.patch, linked into
# rustup under its own name: -Zbuild-std compiles std from it. The copy
# keeps rustc, cargo, the host's rustlib and the target's self-contained
# libc (crt1, libc.a); the target's prebuilt std is not used.
SYSROOT="$(rustc "+$RUST" --print sysroot)"
HOST="$(rustc "+$RUST" -vV | sed -n 's/^host: //p')"
TC="$WORK/rust-$RUST-wasi-uv"
TC_NAME="homescoop-wasi-uv-$RUST"
rm -rf "$TC"
mkdir -p "$TC/lib/rustlib/$TARGET/lib"
cp -R "$SYSROOT/bin" "$TC/"
find "$SYSROOT/lib" -maxdepth 1 -type f -exec cp {} "$TC/lib/" \;
cp -R "$SYSROOT/lib/rustlib/$HOST" "$SYSROOT/lib/rustlib/src" "$TC/lib/rustlib/"
cp -R "$SYSROOT/lib/rustlib/$TARGET/lib/self-contained" "$TC/lib/rustlib/$TARGET/lib/"
for p in "$HOMESCOOP_PKG"/rust/[0-9][0-9][0-9][0-9]-*.patch; do
  (cd "$TC/lib/rustlib/src/rust" && GIT_CEILING_DIRECTORIES="$TC/lib/rustlib/src" git apply --check "$p" && \
    GIT_CEILING_DIRECTORIES="$TC/lib/rustlib/src" git apply "$p") ||
    { echo "wasi-uv: $(basename "$p") does not apply to Rust $RUST's library/" >&2; exit 1; }
  echo "== wasi-uv: std ← $(basename "$p")"
done
rustup toolchain link "$TC_NAME" "$TC"
# rustc sees std through the physical path (macOS: /private/tmp/…).
TC_REAL="$(cd "$TC" && pwd -P)"
CARGO=(cargo "+$TC_NAME")

# wasi-sdk for the C in aws-lc-sys and zstd-sys. cc maps the Rust target to
# clang's deprecated wasm32-wasi; --target in CFLAGS (later wins) keeps the
# threads sysroot's headers and atomics.
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) WASI_SDK_SHA=b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4 ;;
  Darwin-arm64) WASI_SDK_SHA=9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9 ;;
  *) echo "wasi-uv: no pinned wasi-sdk for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
SDK="$WORK/wasi-sdk-$WASI_SDK"
HOMESCOOP_WASI_SDK_VERSION="$WASI_SDK" HOMESCOOP_WASI_SDK_SHA="$WASI_SDK_SHA" \
  bash "$ROOT/scripts/install-wasi-sdk.sh" "$SDK"
export CC_wasm32_wasip1_threads="$SDK/bin/clang" AR_wasm32_wasip1_threads="$SDK/bin/llvm-ar"
export CFLAGS_wasm32_wasip1_threads="--target=$TARGET --sysroot=$SDK/share/wasi-sysroot -Wno-deprecated"

# binaryen, pinned as in scripts/install-wasixcc.sh.
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    BINARYEN_ASSET="binaryen-version_${BINARYEN}-x86_64-linux.tar.gz"
    BINARYEN_SHA="2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489" ;;
  Darwin-arm64)
    BINARYEN_ASSET="binaryen-version_${BINARYEN}-arm64-macos.tar.gz"
    BINARYEN_SHA="ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8" ;;
  *) echo "wasi-uv: no pinned binaryen for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
homescoop_fetch "https://github.com/WebAssembly/binaryen/releases/download/version_$BINARYEN/$BINARYEN_ASSET" \
  "$BINARYEN_SHA" "$WORK/$BINARYEN_ASSET"
BINARYEN_DIR="$WORK/binaryen-version_$BINARYEN"
test -x "$BINARYEN_DIR/bin/wasm-opt" || tar xzf "$WORK/$BINARYEN_ASSET" -C "$WORK"
WASM_OPT="$BINARYEN_DIR/bin/wasm-opt"

# homescoop#1287: 0006 includes the shared allocator refresh on wasm, and the
# initial heap comes from recipe.yaml's wasm.initial-memory (WASM_INITIAL_MEMORY).
homescoop_rust_wasm_refresh_alloc
: "${WASM_INITIAL_MEMORY:?recipe.yaml wasm.initial-memory}"

echo "== wasi-uv: cargo build --bin uv ($TARGET, Rust $RUST with patched std)"
(
  cd "$SRC_DIR"
  # tokio refuses fs/net/process on wasm without tokio_unstable; cap-std's
  # rustix needs wasi_ext (and RUSTC_BOOTSTRAP for its #![feature]), as does
  # -Zbuild-std. The kernel gives a process up to 4 GiB; it starts with the
  # recipe's initial heap. LTO and one
  # codegen unit (uv's release profile) take more memory than CI has room
  # for on this crate graph. Build paths are mapped away from the wasm, and
  # SOURCE_DATE_EPOCH (the tag's commit time) stands in for build times.
  SOURCE_DATE_EPOCH="$(field source.epoch)" \
  RUSTC_BOOTSTRAP=1 \
  CARGO_PROFILE_RELEASE_LTO=off CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
  RUSTFLAGS="--cfg tokio_unstable --cfg wasi_ext -C link-arg=--max-memory=4294967296 -C link-arg=--initial-memory=$WASM_INITIAL_MEMORY --remap-path-prefix=$SRC_DIR=/uv --remap-path-prefix=$(pwd -P)=/uv --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$TC/lib/rustlib/src/rust=/rustc/$RUST --remap-path-prefix=$TC_REAL/lib/rustlib/src/rust=/rustc/$RUST" \
    "${CARGO[@]}" build --locked --release -Zbuild-std=std,panic_abort -p uv --bin uv --target "$TARGET"
)
WASM="$SRC_DIR/target/$TARGET/release/uv.wasm"
test -f "$WASM"

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
before=$(wc -c <"$WASM" | tr -d ' ')
"$WASM_OPT" -Oz --strip-debug \
  --enable-threads --enable-bulk-memory --enable-multivalue --enable-reference-types \
  --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
  "$WASM" -o "$DEST/bin/uv.wasm"
chmod 755 "$DEST/bin/uv.wasm"
echo "== wasi-uv: wasm-opt $before → $(wc -c <"$DEST/bin/uv.wasm" | tr -d ' ') bytes"

homescoop_stage_licenses "$SRC_DIR/LICENSE-MIT" "$SRC_DIR/LICENSE-APACHE"

homescoop_notices_begin "uv.wasm (astral-sh/uv, MIT OR Apache-2.0, see LICENSE, with homescoop's patches; homescoop's crates/wasix-command, MIT OR Apache-2.0) statically links these crates, Rust's standard library (with homescoop's rust/ patch) and wasi-libc. Crates under homescoop-crates/ are the crates.io releases named, with homescoop's patches (packages/wasi-uv/crates/)."
HOMESCOOP_CARGO_ARR=(env RUSTC_BOOTSTRAP=1 "${CARGO[@]}")
HOMESCOOP_CARGO=HOMESCOOP_CARGO_ARR homescoop_notice_rust "$SRC_DIR" "$TARGET" "$RUST" --root uv

if strings "$DEST/bin/uv.wasm" | grep -E '/Users/|/home/runner/|/var/folders/|/private/(tmp|var)/' >/dev/null; then
  echo "homescoop: host path leaked into uv.wasm" >&2
  strings "$DEST/bin/uv.wasm" | grep -E '/Users/|/home/runner/|/var/folders/|/private/(tmp|var)/' | head >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/uv.wasm"
echo "== wasi-uv: staged → $DEST ($VERSION, $(wc -c <"$DEST/bin/uv.wasm" | tr -d ' ') bytes)"
