#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-cargo
field() { node "$ROOT/scripts/read-recipe.mjs" wasi-cargo --field "$1"; }
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) BUILD_TRIPLE=x86_64-unknown-linux-gnu ;;
  *) echo "homescoop: wasi-cargo builds on Linux x86_64 only" >&2; exit 1 ;;
esac
RUST="$(field toolchain.rust)"
TARGET=wasm32-wasip1-threads

PKG_WORK="$WORK/wasi-cargo"
SRC="$PKG_WORK/rustc-$RUST-src"
mkdir -p "$PKG_WORK"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$PKG_WORK/rustc-$RUST-src.tar.xz"
if [[ ! -f "$SRC/.homescoop-patched" ]]; then
  rm -rf "$SRC"
  tar -xJf "$PKG_WORK/rustc-$RUST-src.tar.xz" -C "$PKG_WORK"
  for p in "$ROOT"/packages/wasi-rustc/patches/*.patch; do
    case "$(basename "$p")" in 0001-* | 0002-*) continue ;; esac
    excludes=()
    while read -r f; do
      [[ -d "$SRC/$(dirname "$f")" ]] || { echo "== $(basename "$p"): $f is not in the source tarball, skipped"; excludes+=("--exclude=$f"); }
    done < <(sed -n 's|^+++ b/||p' "$p")
    echo "== rust patch $(basename "$p")"
    (cd "$SRC" && export GIT_CEILING_DIRECTORIES="$PKG_WORK" && git apply --check ${excludes[@]+"${excludes[@]}"} "$p" && git apply ${excludes[@]+"${excludes[@]}"} "$p")
  done
  touch "$SRC/.homescoop-patched"
fi

HOMESCOOP_WASI_SDK_VERSION="$(field toolchain.wasi-sdk)"
HOMESCOOP_WASI_SDK_SHA="$(field toolchain.wasi_sdk_sha256_linux_x64)"
export HOMESCOOP_WASI_SDK_VERSION HOMESCOOP_WASI_SDK_SHA
eval "$(bash "$ROOT/scripts/install-wasi-sdk.sh" "$PKG_WORK/$(bash "$ROOT/scripts/install-wasi-sdk.sh" --name)")"

cd "$SRC"
cat > config.cargo.toml <<TOML
profile = "compiler"
change-id = "ignore"

[build]
build = "$BUILD_TRIPLE"
host = ["$BUILD_TRIPLE"]
target = ["$BUILD_TRIPLE", "$TARGET"]
docs = false
compiler-docs = false
extended = false
tools = []

[rust]
codegen-backends = ["llvm"]
deny-warnings = false
debug = false
debuginfo-level = 0
incremental = false
remap-debuginfo = true
llvm-bitcode-linker = false
llvm-tools = false

[llvm]
static-libstdcpp = true
ninja = false
download-ci-llvm = false
link-shared = false
targets = "WebAssembly;X86"
experimental-targets = ""

[target.'$TARGET']
wasi-root = "$WASI_SYSROOT"

[target.'$BUILD_TRIPLE']
cc = "gcc"
TOML
unset RUSTFLAGS || true
./x.py build library --stage 1 --target "$BUILD_TRIPLE,$TARGET" --config config.cargo.toml
STAGE1="$SRC/build/$BUILD_TRIPLE/stage1"
STAGE0_CARGO="$SRC/build/$BUILD_TRIPLE/stage0/bin/cargo"
test -d "$STAGE1/lib/rustlib/$TARGET/lib"
test -d "$STAGE1/lib/rustlib/$BUILD_TRIPLE/lib"
test -x "$STAGE0_CARGO"

CARGO_SRC="$PKG_WORK/cargo"
rm -rf "$CARGO_SRC"
cp -R "$SRC/src/tools/cargo" "$CARGO_SRC"
mkdir -p "$CARGO_SRC/.cargo"
sed "s|^directory = .*|directory = \"$SRC/vendor\"|" "$SRC/.cargo/config.toml" >> "$CARGO_SRC/.cargo/config.toml"
(cd "$CARGO_SRC" && export GIT_CEILING_DIRECTORIES="$PKG_WORK" && git apply --check "$HOMESCOOP_PKG/patches/cargo.patch" && git apply "$HOMESCOOP_PKG/patches/cargo.patch")
# homescoop#1287: cargo-refresh-alloc.patch includes the shared allocator
# refresh on wasm; the initial heap is recipe.yaml's wasm.initial-memory.
(cd "$CARGO_SRC" && export GIT_CEILING_DIRECTORIES="$PKG_WORK" && git apply --check "$HOMESCOOP_PKG/patches/cargo-refresh-alloc.patch" && git apply "$HOMESCOOP_PKG/patches/cargo-refresh-alloc.patch")
homescoop_rust_wasm_refresh_alloc
: "${WASM_INITIAL_MEMORY:?recipe.yaml wasm.initial-memory}"
cp -R "$HOMESCOOP_PKG/wasix-command" "$CARGO_SRC/crates/wasix-command"
mkdir -p "$CARGO_SRC/slicc"
for spec in git2:0.21.0 home:0.5.12 filetime:0.2.29 tar:0.4.46 jobserver:0.1.34; do
  name=${spec%%:*}
  ver=${spec##*:}
  cp -R "$SRC/vendor/$name-$ver" "$CARGO_SRC/slicc/$name"
  rm -f "$CARGO_SRC/slicc/$name/.cargo-checksum.json"
  (cd "$CARGO_SRC/slicc/$name" && patch -p1 < "$HOMESCOOP_PKG/patches/$name.patch")
done

builtins=$(find "$WASI_SDK_PATH/lib/clang" \( -path '*/wasm32-unknown-wasip1-threads/libclang_rt.builtins.a' -o -name libclang_rt.builtins-wasm32.a \) -print -quit)
test -f "$builtins"
export RUSTC="$STAGE1/bin/rustc"
export CC_wasm32_wasip1_threads="$HOMESCOOP_PKG/wasi-compat/clang"
export CFLAGS_wasm32_wasip1_threads="--target=$TARGET --sysroot=$WASI_SYSROOT -pthread -ffile-prefix-map=$PKG_WORK=/wasi-cargo -ffile-prefix-map=$SRC=/rustc"
export AR_wasm32_wasip1_threads="$WASI_SDK_PATH/bin/llvm-ar"
export CARGO_TARGET_WASM32_WASIP1_THREADS_LINKER="$WASI_SDK_PATH/bin/clang"
export CARGO_TARGET_WASM32_WASIP1_THREADS_RUSTFLAGS="-C link-self-contained=no -C link-arg=$builtins -C link-arg=-lwasi-emulated-mman -C link-arg=-lwasi-emulated-getpid -C link-arg=-Wl,--max-memory=4294967296 -C link-arg=-Wl,--initial-memory=$WASM_INITIAL_MEMORY --remap-path-prefix=$CARGO_SRC=/cargo --remap-path-prefix=$SRC=/rustc"
export CARGO_PROFILE_RELEASE_STRIP=false CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=false
export CARGO_HOME="$PKG_WORK/cargo-home"
(cd "$CARGO_SRC" && "$STAGE0_CARGO" build --release --locked --offline --target "$TARGET" -p cargo --bin cargo --no-default-features)
CARGO_WASM="$CARGO_SRC/target/$TARGET/release/cargo.wasm"
node "$HOMESCOOP_PKG/check-cargo-wasm.mjs" "$CARGO_WASM"

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
cp "$CARGO_WASM" "$DEST/bin/cargo.wasm"
chmod 755 "$DEST/bin/cargo.wasm" "$DEST/bin/cargo"
if strings "$DEST/bin/cargo.wasm" | grep -E "$PKG_WORK|/home/runner/" >/dev/null; then
  echo "homescoop: a build path leaked into cargo.wasm" >&2
  strings "$DEST/bin/cargo.wasm" | grep -E "$PKG_WORK|/home/runner/" | head >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/cargo.wasm"
echo "OK wasi-cargo $VERSION → $DEST"
