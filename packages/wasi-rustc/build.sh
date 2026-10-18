#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-rustc
field() { node "$ROOT/scripts/read-recipe.mjs" wasi-rustc --field "$1"; }
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) BUILD_TRIPLE=x86_64-unknown-linux-gnu ;;
  *) echo "homescoop: wasi-rustc builds on Linux x86_64 only (the bootstrap config names $(uname -sm)'s triple)" >&2; exit 1 ;;
esac

PKG_WORK="/tmp/homescoop-wasi-rustc-$VERSION"
SRC="$PKG_WORK/rustc-$VERSION-src"
mkdir -p "$PKG_WORK"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$PKG_WORK/rustc-$VERSION-src.tar.xz"
rm -rf "$SRC"
tar -xJf "$PKG_WORK/rustc-$VERSION-src.tar.xz" -C "$PKG_WORK"
for p in "$HOMESCOOP_PKG"/patches/*.patch; do
  excludes=()
  while read -r f; do
    [[ -d "$SRC/$(dirname "$f")" ]] || { echo "== $(basename "$p"): $f is not in the source tarball, skipped"; excludes+=("--exclude=$f"); }
  done < <(sed -n 's|^+++ b/||p' "$p")
  echo "== patch $(basename "$p")"
  (cd "$SRC" && export GIT_CEILING_DIRECTORIES="$PKG_WORK" && git apply --check ${excludes[@]+"${excludes[@]}"} "$p" && git apply ${excludes[@]+"${excludes[@]}"} "$p")
done

HOMESCOOP_WASI_SDK_VERSION="$(field toolchain.wasi-sdk)"
HOMESCOOP_WASI_SDK_SHA="$(field toolchain.wasi_sdk_sha256_linux_x64)"
export HOMESCOOP_WASI_SDK_VERSION HOMESCOOP_WASI_SDK_SHA
eval "$(bash "$ROOT/scripts/install-wasi-sdk.sh" "$PKG_WORK/$(bash "$ROOT/scripts/install-wasi-sdk.sh" --name)")"

eval "$(node "$ROOT/scripts/recipe-env.mjs" wasi-rustc --source wasi_llvm)"
homescoop_fetch "$WASI_LLVM_URL" "$WASI_LLVM_SHA" "$PKG_WORK/wasi-llvm.tgz"
rm -rf "$PKG_WORK/wasi-llvm"
mkdir -p "$PKG_WORK/wasi-llvm"
tar -xzf "$PKG_WORK/wasi-llvm.tgz" -C "$PKG_WORK/wasi-llvm"
LLVM_CONFIG="$PKG_WORK/wasi-llvm/package/bin/llvm-config"
[[ "$("$LLVM_CONFIG" --version)" == "$(field toolchain.llvm)" ]]
[[ "$("$LLVM_CONFIG" --targets-built)" == WebAssembly ]]
[[ "$("$LLVM_CONFIG" --shared-mode)" == static ]]
"$LLVM_CONFIG" --help >/dev/null 2>&1
for lib in LLVMOption lldCommon lldELF lldWasm; do
  test -f "$PKG_WORK/wasi-llvm/package/lib/lib$lib.a"
done

cd "$SRC"
for f in compiler/rustc_llvm/llvm-wrapper/*.cpp; do
  "$WASI_SDK_PATH/bin/wasm32-wasip1-threads-clang++" -O3 -fno-exceptions \
    "--sysroot=$WASI_SYSROOT" -pthread $("$LLVM_CONFIG" --cxxflags) \
    -D_WASI_EMULATED_MMAN -DNDEBUG -DLLVM_COMPONENT_WEBASSEMBLY \
    --target=wasm32-wasip1-threads -fsyntax-only "$f"
done
python3 "$HOMESCOOP_PKG/make-stable-config.py" --wasi-sdk "$WASI_SDK_PATH" \
  --llvm-config "$LLVM_CONFIG" --build "$BUILD_TRIPLE" --output config.wasi.toml
unset RUSTFLAGS CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS CARGO_TARGET_WASM32_WASIP1_THREADS_RUSTFLAGS || true
export RUSTFLAGS_NOT_BOOTSTRAP=""
export CFLAGS_wasm32_wasip1_threads="--target=wasm32-wasip1-threads" CXXFLAGS_wasm32_wasip1_threads="--target=wasm32-wasip1-threads"
./x.py install --config config.wasi.toml

DEST="$HOMESCOOP_PKG/package"
rustc_wasm="$(find dist -name rustc.wasm -type f | head -1)"
test -n "$rustc_wasm"
test -d dist/lib/rustlib/wasm32-wasip1
rm -rf "$DEST/bin" "$DEST/lib"
mkdir -p "$DEST/bin" "$DEST/lib/rustlib"
cp -R dist/lib/rustlib/wasm32-wasip1 "$DEST/lib/rustlib/"
python3 "$ROOT/scripts/split-name-section.py" "$rustc_wasm" "$DEST/bin/rustc.wasm" "$PKG_WORK/rustc.wasm.names" --strip-debug
cp "$HOMESCOOP_PKG/rustc-driver.sh" "$DEST/bin/rustc"
chmod 755 "$DEST/bin/rustc" "$DEST/bin/rustc.wasm"
WASI_LIBC=https://raw.githubusercontent.com/WebAssembly/wasi-libc/wasi-sdk-34
homescoop_notices_begin "rustc.wasm is Rust $VERSION's compiler (MIT OR Apache-2.0; its vendored crates are listed in Rust's COPYRIGHT and their own licences in rustc-$VERSION-src.tar.xz). It statically links these, and lib/rustlib/wasm32-wasip1 holds Rust's standard library and the self-contained wasi-libc."
homescoop_notice "wasi_llvm: @ai-ecoverse/wasi-llvm $("$LLVM_CONFIG" --version) (LLVM, clang and lld; Apache-2.0 WITH LLVM-exception)" \
  "$PKG_WORK/wasi-llvm/package/LICENSE" -
homescoop_notice "Rust $VERSION (MIT OR Apache-2.0)" \
  "$SRC/COPYRIGHT" - "$SRC/LICENSE-MIT" - "$SRC/LICENSE-APACHE" -
homescoop_notice "wasi-libc and libc++/libc++abi from wasi-sdk 34 (rustc.wasm's host libc; MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception)" \
  "$WASI_LIBC/LICENSE" 2711a8b5a5cdfef0e639f96c1aca12ae23d7d64a02d0507f1bdf14d2b27bbc3a \
  "$WASI_LIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WASI_LIBC/libc-top-half/musl/COPYRIGHT" b870108ec5e7790e9f9919064f1b9421d62d5f9b0e6c230c6adf7ea2da62e97b \
  "$WASI_LIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0
if find "$DEST" -type l | grep -q .; then
  echo "homescoop: symlinks in the package" >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/rustc.wasm"
echo "OK wasi-rustc $VERSION → $DEST"
