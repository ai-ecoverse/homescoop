#!/usr/bin/env bash
# Rebuild libc++, libc++abi, and libunwind from the same LLVM tree as wasm-clang
# (b158b0ae6), all exnref. Installs into DEST for static and (if PIC=1) PIC.
set -euo pipefail

ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"
LLVM_SRC="${LLVM_PROJECT:-$SLICC_EM/src/llvm-project}"
CLANG="${CLANG_HOST:-$SLICC_EM/install/bin/clang}"
CLANGXX="${CLANGXX_HOST:-$SLICC_EM/install/bin/clang++}"
SYSROOT_BASE="${CXX_BUILD_SYSROOT:-${HOME}/.wasixcc/sysroot/sysroot-exnref-eh}"
OUT_ROOT="${CXX_RUNTIME_OUT:-$ROOT/packages/wasix-sysroot/.cxx-runtimes}"
JOBS="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}"

need() { test -x "$1" || test -f "$1" || { echo "homescoop: missing $1" >&2; exit 1; }; }
need "$CLANG"
need "$CLANGXX"
need "$LLVM_SRC/runtimes/CMakeLists.txt"
need "$SYSROOT_BASE/include/stdio.h"

CLANG_VER=$("$CLANG" --version | head -1)
echo "== rebuild-cxx: $CLANG_VER"
echo "   LLVM_SRC=$LLVM_SRC"
echo "   SYSROOT_BASE=$SYSROOT_BASE"
echo "   OUT_ROOT=$OUT_ROOT"

# Expect b158b0ae6 (wasm-clang revision).
if [[ -d "$LLVM_SRC/.git" ]]; then
  rev=$(git -C "$LLVM_SRC" rev-parse HEAD)
  echo "   LLVM HEAD=$rev"
  if [[ "$rev" != b158b0ae6c559f87be325b8f427c5588e6a48823* ]]; then
    echo "homescoop: warning: LLVM HEAD is not b158b0ae6 (got $rev)" >&2
  fi
fi

TOOLCHAIN=$(mktemp "${TMPDIR:-/tmp}/wasix-cxx-toolchain.XXXXXX.cmake")
trap 'rm -f "$TOOLCHAIN"' EXIT
cat > "$TOOLCHAIN" <<'EOF'
cmake_minimum_required(VERSION 3.16.0)
if(CMAKE_POSITION_INDEPENDENT_CODE)
  set(WASIX_TLS_MODEL "global-dynamic")
else()
  set(WASIX_TLS_MODEL "local-exec")
endif()
# Match wasm-clang driver / wasix exnref toolchain: new EH (exnref), no legacy try/catch.
set(COMPILE_FLAGS "-O2 -matomics -mbulk-memory -mmutable-globals -pthread -mthread-model posix -ftls-model=${WASIX_TLS_MODEL} -fno-trapping-math -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -fwasm-exceptions -mllvm --wasm-enable-eh -mllvm --wasm-enable-sjlj -mllvm --wasm-use-legacy-eh=false")
set(CMAKE_SYSTEM_NAME WASI)
set(CMAKE_SYSTEM_VERSION 1)
set(CMAKE_SYSTEM_PROCESSOR wasm32)
set(triple wasm32-wasip1)
set(CMAKE_C_COMPILER_TARGET ${triple})
set(CMAKE_CXX_COMPILER_TARGET ${triple})
set(CMAKE_ASM_COMPILER_TARGET ${triple})
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${COMPILE_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${COMPILE_FLAGS}")
set(CMAKE_ASM_FLAGS "${CMAKE_ASM_FLAGS} ${COMPILE_FLAGS}")
if(DEFINED ENV{CC})
  set(CMAKE_C_COMPILER $ENV{CC})
else()
  set(CMAKE_C_COMPILER clang)
endif()
if(DEFINED ENV{CXX})
  set(CMAKE_CXX_COMPILER $ENV{CXX})
else()
  set(CMAKE_CXX_COMPILER clang++)
endif()
set(CMAKE_AR llvm-ar)
set(CMAKE_RANLIB llvm-ranlib)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
EOF

export CC="$CLANG" CXX="$CLANGXX"
# Prefer llvm-ar next to clang.
export PATH="$(dirname "$CLANG"):$PATH"

build_one() {
  local pic=$1 # ON|OFF
  local name=$2 # static|pic
  local build_dir="$OUT_ROOT/build-$name"
  local install_dir="$OUT_ROOT/install-$name"
  local clean_sys="$OUT_ROOT/clean-sysroot-$name"

  echo "== libcxx runtimes ($name, PIC=$pic)"
  rm -rf "$build_dir" "$install_dir" "$clean_sys"
  mkdir -p "$install_dir" "$clean_sys"
  # Like wasix: libcxx build sysroot must be C-only (no prior c++/v1), else
  # include_next(<ctype.h>) resolves to libc++'s own wrapper and breaks.
  rsync -a --delete \
    --exclude 'include/c++' \
    --exclude 'include/c++/**' \
    --exclude 'share/libc++' \
    --exclude 'share/libc++/**' \
    --exclude 'lib/wasm32-wasi/libc++*' \
    --exclude 'lib/wasm32-wasi/libunwind*' \
    --exclude 'lib/wasm32-wasip1' \
    "$SYSROOT_BASE/" "$clean_sys/"
  # Restore wasip1 → wasi lib alias if present upstream.
  if [[ -d "$clean_sys/lib/wasm32-wasi" && ! -e "$clean_sys/lib/wasm32-wasip1" ]]; then
    ln -s wasm32-wasi "$clean_sys/lib/wasm32-wasip1"
  fi

  # Bridge wasi/musl locale (LLVM 24 dropped musl.h; wasix still has it).
  local musl_src="$SYSROOT_BASE/include/c++/v1/__locale_dir/locale_base_api/musl.h"
  local api_dst="$LLVM_SRC/libcxx/include/__locale_dir/locale_base_api.h"
  local ops_dst="$LLVM_SRC/libcxx/src/filesystem/operations.cpp"
  local api_bak="" ops_bak=""
  if [[ -f "$musl_src" ]]; then
    mkdir -p "$LLVM_SRC/libcxx/include/__locale_dir/locale_base_api"
    cp "$musl_src" "$LLVM_SRC/libcxx/include/__locale_dir/locale_base_api/musl.h"
    if ! grep -q 'locale_base_api/musl.h' "$api_dst"; then
      api_bak=$(mktemp)
      cp "$api_dst" "$api_bak"
      # Patch the bare ibm include in the catch-all else branch.
      python3 - "$api_dst" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "#    include <__locale_dir/locale_base_api/ibm.h>\n"
new = (
    "#    if defined(__wasi__) || defined(_LIBCPP_HAS_MUSL_LIBC)\n"
    "#      include <__locale_dir/locale_base_api/musl.h>\n"
    "#    else\n"
    "#      include <__locale_dir/locale_base_api/ibm.h>\n"
    "#    endif\n"
)
if old not in t:
    raise SystemExit("locale_base_api.h: ibm include not found for patch")
p.write_text(t.replace(old, new, 1))
print("  patched locale_base_api.h for wasi/musl")
PY
    fi
  fi
  # WASI musl advertises _LIBCPP_HAS_MUSL_LIBC but has no copy_file_range(2).
  if grep -q '_LIBCPP_HAS_MUSL_LIBC || defined(__FreeBSD__)' "$ops_dst" \
     && ! grep -q '!defined(__wasi__)' "$ops_dst"; then
    ops_bak=$(mktemp)
    cp "$ops_dst" "$ops_bak"
    python3 - "$ops_dst" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "#if _LIBCPP_GLIBC_PREREQ(2, 27) || _LIBCPP_HAS_MUSL_LIBC || defined(__FreeBSD__)\n"
new = "#if (_LIBCPP_GLIBC_PREREQ(2, 27) || _LIBCPP_HAS_MUSL_LIBC || defined(__FreeBSD__)) && !defined(__wasi__)\n"
if old not in t:
    raise SystemExit("operations.cpp: copy_file_range guard not found")
p.write_text(t.replace(old, new, 1))
print("  patched operations.cpp: no copy_file_range on wasi")
PY
  fi

  cmake \
    -G Ninja \
    -DCMAKE_POSITION_INDEPENDENT_CODE="$pic" \
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
    -DCMAKE_SYSROOT="$clean_sys" \
    -DCMAKE_INSTALL_PREFIX="$install_dir" \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_C_COMPILER_WORKS=ON \
    -DCMAKE_CXX_COMPILER_WORKS=ON \
    -DLLVM_COMPILER_CHECKED=ON \
    -DUNIX:BOOL=ON \
    -DLLVM_ENABLE_PIC="$pic" \
    -DLLVM_ENABLE_RUNTIMES="libcxx;libcxxabi;libunwind" \
    -DLIBCXX_ENABLE_THREADS:BOOL=ON \
    -DLIBCXX_HAS_PTHREAD_API:BOOL=ON \
    -DLIBCXX_HAS_EXTERNAL_THREAD_API:BOOL=OFF \
    -DLIBCXX_HAS_WIN32_THREAD_API:BOOL=OFF \
    -DLIBCXX_ENABLE_SHARED:BOOL=OFF \
    -DLIBCXX_ENABLE_EXCEPTIONS:BOOL=ON \
    -DLIBCXX_ENABLE_FILESYSTEM:BOOL=ON \
    -DLIBCXX_CXX_ABI=libcxxabi \
    -DLIBCXX_HAS_MUSL_LIBC:BOOL=ON \
    -DLIBCXX_ABI_VERSION=2 \
    -DLIBCXX_USE_COMPILER_RT=ON \
    -DLIBCXX_ENABLE_TIME_ZONE_DATABASE:BOOL=OFF \
    -DLIBCXXABI_ENABLE_EXCEPTIONS:BOOL=ON \
    -DLIBCXXABI_ENABLE_SHARED:BOOL=OFF \
    -DLIBCXXABI_SILENT_TERMINATE:BOOL=ON \
    -DLIBCXXABI_ENABLE_THREADS:BOOL=ON \
    -DLIBCXXABI_HAS_PTHREAD_API:BOOL=ON \
    -DLIBCXXABI_HAS_EXTERNAL_THREAD_API:BOOL=OFF \
    -DLIBCXXABI_HAS_WIN32_THREAD_API:BOOL=OFF \
    -DLIBCXXABI_USE_LLVM_UNWINDER:BOOL=ON \
    -DLIBUNWIND_ENABLE_SHARED:BOOL=OFF \
    -DLIBUNWIND_ENABLE_STATIC:BOOL=ON \
    -DLIBUNWIND_USE_COMPILER_RT:BOOL=ON \
    -DLIBUNWIND_ENABLE_THREADS:BOOL=ON \
    -DLIBUNWIND_HAS_PTHREAD_LIB:BOOL=ON \
    -DLIBUNWIND_INSTALL_LIBRARY:BOOL=ON \
    -DLIBUNWIND_HIDE_SYMBOLS:BOOL=ON \
    -DLIBCXX_LIBDIR_SUFFIX=/wasm32-wasi \
    -DLIBCXXABI_LIBDIR_SUFFIX=/wasm32-wasi \
    -DLLVM_LIBDIR_SUFFIX=/wasm32-wasi \
    -B "$build_dir" \
    -S "$LLVM_SRC/runtimes"

  # CMake copies libc++ headers into the build tree from its file list; musl.h
  # (not in upstream LLVM 24) must be injected into the build include dir too.
  if [[ -f "$musl_src" ]]; then
    mkdir -p "$build_dir/include/c++/v1/__locale_dir/locale_base_api"
    cp "$musl_src" "$build_dir/include/c++/v1/__locale_dir/locale_base_api/musl.h"
  fi

  local status=0
  cmake --build "$build_dir" --parallel "$JOBS" || status=$?
  if [[ -n "$api_bak" && -f "$api_bak" ]]; then
    mv -f "$api_bak" "$api_dst"
    rm -f "$LLVM_SRC/libcxx/include/__locale_dir/locale_base_api/musl.h"
  fi
  if [[ -n "$ops_bak" && -f "$ops_bak" ]]; then
    mv -f "$ops_bak" "$ops_dst"
  fi
  [[ "$status" -eq 0 ]] || exit "$status"
  cmake --install "$build_dir"
  # cmake --install copies headers from the (restored) LLVM source, so the
  # wasi→musl locale bridge must be re-applied on the install tree.
  bash "$(cd "$(dirname "$0")" && pwd)/fix-cxx-musl-headers.sh" "$install_dir" "$musl_src"

  for lib in libc++.a libc++abi.a libunwind.a; do
    test -f "$install_dir/lib/wasm32-wasi/$lib" || {
      echo "homescoop: missing $install_dir/lib/wasm32-wasi/$lib" >&2
      exit 1
    }
  done
  echo "  installed → $install_dir"
}

mkdir -p "$OUT_ROOT"
build_one OFF static
build_one ON pic
echo "== rebuild-cxx: done"
ls -la "$OUT_ROOT"/install-*/lib/wasm32-wasi/
