#!/usr/bin/env bash
# LLVM 21 + clang + lld as static libraries for a wasm32-wasip1-threads host.
# Output: work/prefix (lib/*.a, include/, bin/llvm-config) and
# work/wasi-llvm-<version>-wasm32-wasip1-threads.tar.xz.
#
# Env:
#   WASI_SDK_PATH   wasi-sdk to build with (default: fetch wasi-sdk 24 for this host)
#   NATIVE_TBLGEN   dir with llvm-tblgen / clang-tblgen / llvm-min-tblgen of this
#                   LLVM version (default: build them natively from the same source)
#   JOBS            ninja -j (default: CPUs - 2)
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-llvm

PKG_WORK="$HOMESCOOP_PKG/work"
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

# wasi-sdk 24: the toolchain wasi-rustc's CI builds with, so a shared libLLVM
# and rustc's C++ agree on libc++ and wasi-libc.
if [[ -z "${WASI_SDK_PATH:-}" ]]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) sdk=wasi-sdk-24.0-arm64-macos; sdk_sha=aeae999396d5f5caa5ce419f52e83c35869d5fd21d40af80acba2c80f51b0b3a ;;
    Linux-x86_64) sdk=wasi-sdk-24.0-x86_64-linux; sdk_sha=c6c38aab56e5de88adf6c1ebc9c3ae8da72f88ec2b656fb024eda8d4167a0bc5 ;;
    *) echo "homescoop: set WASI_SDK_PATH (no wasi-sdk 24 pin for $(uname -sm))" >&2; exit 1 ;;
  esac
  homescoop_fetch "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-24/$sdk.tar.gz" \
    "$sdk_sha" "$PKG_WORK/$sdk.tar.gz"
  [[ -d "$PKG_WORK/$sdk" ]] || tar xzf "$PKG_WORK/$sdk.tar.gz" -C "$PKG_WORK"
  WASI_SDK_PATH="$PKG_WORK/$sdk"
fi
SDK="$WASI_SDK_PATH"
"$SDK/bin/clang" --version | head -1

if [[ -z "${NATIVE_TBLGEN:-}" ]]; then
  echo "== native tablegen tools ($VERSION)"
  if [[ ! -x "$NATIVE/bin/clang-tblgen" ]]; then
    cmake -G Ninja -S "$SRC/llvm" -B "$NATIVE" -DCMAKE_BUILD_TYPE=Release \
      -DLLVM_ENABLE_PROJECTS=clang -DLLVM_TARGETS_TO_BUILD=WebAssembly \
      -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
      -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBXML2=OFF
    ninja -C "$NATIVE" -j"$JOBS" llvm-tblgen llvm-min-tblgen clang-tblgen
  fi
  NATIVE_TBLGEN="$NATIVE/bin"
fi

echo "== configure LLVM $VERSION for wasm32-wasip1-threads"
FLAGS="--target=wasm32-wasip1-threads --sysroot=$SDK/share/wasi-sysroot -pthread -D_WASI_EMULATED_MMAN"
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

OUT="$PKG_WORK/wasi-llvm-${VERSION}-wasm32-wasip1-threads.tar.xz"
tar cJf "$OUT" -C "$PKG_WORK" --exclude='prefix/bin/[a-km-z]*' prefix
shasum -a 256 "$OUT"
echo "OK wasi-llvm $VERSION → $INSTALL"
