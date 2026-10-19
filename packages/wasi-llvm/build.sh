#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-llvm

PKG_WORK="$WORK/wasi-llvm"
mkdir -p "$PKG_WORK"
TARBALL="$PKG_WORK/llvm-project-${VERSION}.src.tar.xz"
SRC="$PKG_WORK/llvm-project-${VERSION}.src"
NATIVE="$PKG_WORK/build-native"
BUILD="$PKG_WORK/build-wasi"
INSTALL="$PKG_WORK/prefix"
JOBS="${JOBS:-$(( $(getconf _NPROCESSORS_ONLN) > 3 ? $(getconf _NPROCESSORS_ONLN) - 2 : 1 ))}"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
homescoop_extract "$TARBALL" "$SRC"
shopt -s nullglob
for p in "$HOMESCOOP_PKG"/patches/*.patch; do
  marker="$SRC/.homescoop-patched-$(basename "$p")"
  [[ -f "$marker" ]] && continue
  echo "== patch $(basename "$p")"
  patch -d "$SRC" -p1 < "$p"
  touch "$marker"
done
shopt -u nullglob

field() { node "$ROOT/scripts/read-recipe.mjs" wasi-llvm --field "$1"; }
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) sdk_host=linux_x64 ;;
  Darwin-arm64) sdk_host=macos_arm64 ;;
  *) echo "homescoop: no wasi-sdk pin for $(uname -sm)" >&2; exit 1 ;;
esac
HOMESCOOP_WASI_SDK_VERSION="$(field toolchain.wasi-sdk)"
HOMESCOOP_WASI_SDK_SHA="$(field "toolchain.wasi_sdk_sha256_$sdk_host")"
export HOMESCOOP_WASI_SDK_VERSION HOMESCOOP_WASI_SDK_SHA
eval "$(bash "$ROOT/scripts/install-wasi-sdk.sh" "$PKG_WORK/$(bash "$ROOT/scripts/install-wasi-sdk.sh" --name)")"
SDK="$WASI_SDK_PATH"
"$SDK/bin/clang" --version | head -1

echo "== native tablegen tools ($VERSION)"
if [[ ! -x "$NATIVE/bin/clang-tblgen" ]]; then
  cmake -G Ninja -S "$SRC/llvm" -B "$NATIVE" -DCMAKE_BUILD_TYPE=Release \
    -DLLVM_ENABLE_PROJECTS=clang -DLLVM_TARGETS_TO_BUILD=WebAssembly \
    -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
    -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBXML2=OFF
  ninja -C "$NATIVE" -j"$JOBS" llvm-tblgen llvm-min-tblgen clang-tblgen
fi
NATIVE_TBLGEN="$NATIVE/bin"

echo "== configure LLVM $VERSION for wasm32-wasip1-threads"
FLAGS="--target=wasm32-wasip1-threads --sysroot=$SDK/share/wasi-sysroot -pthread -D_WASI_EMULATED_MMAN -ffile-prefix-map=$SRC=/llvm-project -ffile-prefix-map=$BUILD=/build -ffile-prefix-map=$SDK=/wasi-sdk"
cmake -G Ninja -S "$SRC/llvm" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$INSTALL" \
  -DCMAKE_SYSTEM_NAME=WASI -DCMAKE_SYSTEM_PROCESSOR=wasm32 -DWASI=TRUE -DUNIX=1 \
  -DCMAKE_C_COMPILER="$SDK/bin/clang" -DCMAKE_CXX_COMPILER="$SDK/bin/clang++" \
  -DCMAKE_AR="$SDK/bin/llvm-ar" -DCMAKE_RANLIB="$SDK/bin/llvm-ranlib" \
  "-DCMAKE_C_FLAGS=$FLAGS" "-DCMAKE_CXX_FLAGS=$FLAGS" \
  "-DCMAKE_EXE_LINKER_FLAGS=-lwasi-emulated-mman -Wl,--max-memory=4294967296 -Wl,-z,stack-size=1048576" \
  -DCMAKE_EXECUTABLE_SUFFIX=.wasm \
  -DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY \
  -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=ONLY \
  "-DLLVM_ENABLE_PROJECTS=clang;lld" -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_HOST_TRIPLE=wasm32-unknown-wasip1 -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-wasip1 \
  -DLLVM_ENABLE_ASSERTIONS=OFF -DLLVM_ENABLE_THREADS=ON -DLLVM_ENABLE_PIC=OFF -DBUILD_SHARED_LIBS=OFF \
  -DLLVM_BUILD_TOOLS=OFF -DLLVM_BUILD_UTILS=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF -DLLVM_INCLUDE_DOCS=OFF -DLLVM_INCLUDE_UTILS=OFF \
  -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_ENABLE_LIBPFM=OFF -DLLVM_ENABLE_BINDINGS=OFF -DLLVM_ENABLE_OCAMLDOC=OFF \
  -DCLANG_BUILD_TOOLS=OFF -DCLANG_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_DOCS=OFF \
  -DCLANG_ENABLE_OBJC_REWRITER=OFF -DLLD_BUILD_TOOLS=OFF \
  -DLLVM_TABLEGEN="$NATIVE_TBLGEN/llvm-tblgen" -DCLANG_TABLEGEN="$NATIVE_TBLGEN/clang-tblgen" \
  -DLLVM_NATIVE_TOOL_DIR="$NATIVE_TBLGEN"

echo "== build + install (-j$JOBS)"
ninja -C "$BUILD" -j"$JOBS" install

python3 "$HOMESCOOP_PKG/gen-llvm-config.py" "$BUILD" "$INSTALL" wasm32-unknown-wasip1
cp "$SRC/llvm/LICENSE.TXT" "$INSTALL/LICENSE.TXT"

# PRESTAGE: the libraries the LLVM-enabled zig and rustc link are all there.
for lib in LLVMCore LLVMWebAssemblyCodeGen LLVMSupport clangFrontendTool clangCodeGen \
  clangStaticAnalyzerCore lldCommon lldELF lldWasm lldCOFF lldMachO lldMinGW; do
  test -f "$INSTALL/lib/lib$lib.a" || { echo "homescoop: missing lib$lib.a" >&2; exit 1; }
done
[[ "$("$INSTALL/bin/llvm-config" --version)" == "$VERSION" ]]
[[ "$("$INSTALL/bin/llvm-config" --targets-built)" == "WebAssembly" ]]

DEST="$HOMESCOOP_PKG/package"
rm -rf "$DEST/bin" "$DEST/include" "$DEST/lib" "$DEST/share"
mkdir -p "$DEST/bin"
cp "$INSTALL/bin/llvm-config" "$DEST/bin/llvm-config"
chmod 755 "$DEST/bin/llvm-config"
cp -R "$INSTALL/include" "$INSTALL/lib" "$DEST/"
cp "$INSTALL/LICENSE.TXT" "$DEST/LICENSE"
# LLVM Support's third-party notices (homescoop#1046): in
# THIRD-PARTY-NOTICES.md, and as files in share/licenses/llvm-support for the
# programs that link these libraries (wasi-rustc, wasi-zig), which pass this
# package to homescoop_notice_llvm_support.
rm -rf "$DEST/share"
homescoop_notices_begin "lib/libLLVMSupport.a compiles in the following third-party code from LLVM $VERSION (homescoop#1046); clang's and lld's LICENSE.TXT are LICENSE's text. The same files are in share/licenses/llvm-support."
homescoop_notice_llvm_support "$SRC"
mkdir -p "$DEST/share/licenses/llvm-support"
cp "${LLVM_SUPPORT_NOTICES[0]}" "$DEST/share/licenses/llvm-support/COPYRIGHT.regex"
cp "${LLVM_SUPPORT_NOTICES[1]}" "$DEST/share/licenses/llvm-support/BLAKE3-LICENSE"
cp "${LLVM_SUPPORT_NOTICES[2]}" "$DEST/share/licenses/llvm-support/xxhash-LICENSE"
if find "$DEST" -type l | grep -q .; then
  echo "homescoop: symlinks in the package" >&2
  find "$DEST" -type l >&2
  exit 1
fi
if grep -rlE "$PKG_WORK|$ROOT|/home/runner/" "$DEST/bin" "$DEST/lib/cmake" "$DEST/include" >/dev/null 2>&1; then
  echo "homescoop: a build path leaked into the package" >&2
  grep -rlE "$PKG_WORK|$ROOT|/home/runner/" "$DEST/bin" "$DEST/lib/cmake" "$DEST/include" | head >&2
  exit 1
fi
du -sh "$DEST/lib" "$DEST/include"
echo "OK wasi-llvm $VERSION → $DEST"
