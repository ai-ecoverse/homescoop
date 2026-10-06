#!/usr/bin/env bash
# Compile libc++ / libc++abi / libunwind from LLVM b158b0ae6 with exnref flags,
# against an existing wasix C sysroot (headers + libc). No cmake runtimes.
set -euo pipefail

ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"
LLVM_SRC="${LLVM_PROJECT:-$SLICC_EM/src/llvm-project}"
CLANG="${CLANG_HOST:-$SLICC_EM/install/bin/clang}"
CLANGXX="${CLANGXX_HOST:-$SLICC_EM/install/bin/clang++}"
AR="${LLVM_AR:-$(dirname "$CLANG")/llvm-ar}"
SYSROOT_BASE="${CXX_BUILD_SYSROOT:-${HOME}/.wasixcc/sysroot/sysroot-exnref-eh}"
OUT_ROOT="${CXX_RUNTIME_OUT:-$ROOT/packages/wasix-sysroot/.cxx-runtimes}"
JOBS="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}"

need() { [[ -e "$1" ]] || { echo "homescoop: missing $1" >&2; exit 1; }; }
need "$CLANG"; need "$CLANGXX"; need "$AR"
need "$LLVM_SRC/libcxxabi/src/cxa_personality.cpp"
need "$SYSROOT_BASE/include/stdio.h"

echo "== manual-cxx: $($CLANG --version | head -1)"
if [[ -d "$LLVM_SRC/.git" ]]; then
  echo "   LLVM HEAD=$(git -C "$LLVM_SRC" rev-parse HEAD)"
fi

HDR="$OUT_ROOT/headers"
rm -rf "$HDR"
mkdir -p "$HDR/include/c++/v1" "$HDR/include"
# LLVM 24 libc++ / libc++abi / libunwind public headers + wasix __config_site.
rsync -a --delete \
  --exclude CMakeLists.txt --exclude '*.in' --exclude __config_site \
  "$LLVM_SRC/libcxx/include/" "$HDR/include/c++/v1/"
# Keep wasix platform __config_site (ABI/threads/musl).
cp "$SYSROOT_BASE/include/c++/v1/__config_site" "$HDR/include/c++/v1/__config_site"
# libc++abi public headers live under c++/v1 in wasix layout.
rsync -a "$LLVM_SRC/libcxxabi/include/" "$HDR/include/c++/v1/"
rsync -a "$LLVM_SRC/libunwind/include/" "$HDR/include/"

COMMON=(
  --target=wasm32-wasip1
  --sysroot="$SYSROOT_BASE"
  -resource-dir="$("$CLANG" -print-resource-dir)"
  -O2 -g
  -matomics -mbulk-memory -mmutable-globals
  -pthread -mthread-model posix
  -fno-trapping-math
  -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS
  -fwasm-exceptions
  -mllvm --wasm-enable-eh
  -mllvm --wasm-enable-sjlj
  -mllvm --wasm-use-legacy-eh=false
  -nostdinc++
  -isystem "$HDR/include/c++/v1"
  -isystem "$HDR/include"
  -I"$LLVM_SRC/libcxx/src"
  -I"$LLVM_SRC/libcxxabi/include"
  -I"$LLVM_SRC/libunwind/include"
  -I"$LLVM_SRC/libunwind/src"
)

CXX_DEFS=(
  -D_LIBCPP_BUILDING_LIBRARY
  -D_LIBCXXABI_BUILDING_LIBRARY
  -DLIBCXXABI_SILENT_TERMINATE
  -D_LIBCPP_HAS_NO_PRAGMA_SYSTEM_HEADER
  -Wno-unused-parameter
  -Wno-user-defined-literals
  -Wno-covered-switch-default
  -Wno-suggest-override
  -Wno-error
  -std=c++20
)

compile_tree() {
  local pic=$1 name=$2
  local objdir="$OUT_ROOT/obj-$name"
  local libdir="$OUT_ROOT/install-$name/lib/wasm32-wasi"
  rm -rf "$objdir" "$OUT_ROOT/install-$name"
  mkdir -p "$objdir/cxx" "$objdir/cxxabi" "$objdir/unwind" "$libdir"

  local picflags=()
  if [[ "$pic" == ON ]]; then
    picflags=(-fPIC -fvisibility=default -ftls-model=global-dynamic)
  else
    picflags=(-ftls-model=local-exec)
  fi

  local -a cmds=()

  # --- libunwind (wasm EH: Unwind-wasm only; empty stubs aren't needed) ---
  cmds+=("$CLANG ${COMMON[*]} ${picflags[*]} -D_LIBUNWIND_HIDE_SYMBOLS -D__WASM_EXCEPTIONS__ -DNDEBUG -std=c11 -c $LLVM_SRC/libunwind/src/Unwind-wasm.c -o $objdir/unwind/Unwind-wasm.c.o")

  # --- libc++abi ---
  local abi_srcs=(
    abort_message.cpp
    cxa_aux_runtime.cpp
    cxa_default_handlers.cpp
    cxa_demangle.cpp
    cxa_exception.cpp
    cxa_exception_storage.cpp
    cxa_guard.cpp
    cxa_handlers.cpp
    cxa_personality.cpp
    cxa_vector.cpp
    cxa_virtual.cpp
    cxa_thread_atexit.cpp
    fallback_malloc.cpp
    private_typeinfo.cpp
    stdlib_exception.cpp
    stdlib_new_delete.cpp
    stdlib_stdexcept.cpp
    stdlib_typeinfo.cpp
  )
  for s in "${abi_srcs[@]}"; do
    cmds+=("$CLANGXX ${COMMON[*]} ${picflags[*]} ${CXX_DEFS[*]} -c $LLVM_SRC/libcxxabi/src/$s -o $objdir/cxxabi/${s}.o")
  done

  # --- libc++ (match wasix archive membership) ---
  local cxx_srcs=(
    algorithm.cpp any.cpp bind.cpp call_once.cpp charconv.cpp chrono.cpp
    error_category.cpp exception.cpp expected.cpp
    filesystem/directory_entry.cpp filesystem/directory_iterator.cpp
    filesystem/filesystem_clock.cpp filesystem/filesystem_error.cpp
    filesystem/operations.cpp filesystem/path.cpp
    functional.cpp future.cpp hash.cpp
    ios.cpp ios.instantiations.cpp iostream.cpp locale.cpp
    memory.cpp memory_resource.cpp
    mutex.cpp mutex_destructor.cpp
    new_handler.cpp new_helpers.cpp
    optional.cpp ostream.cpp print.cpp
    random.cpp random_shuffle.cpp regex.cpp
    stdexcept.cpp string.cpp strstream.cpp system_error.cpp
    thread.cpp typeinfo.cpp valarray.cpp variant.cpp vector.cpp
    verbose_abort.cpp
    atomic.cpp barrier.cpp
    condition_variable.cpp condition_variable_destructor.cpp
    shared_mutex.cpp
    fstream.cpp
    ryu/d2fixed.cpp ryu/d2s.cpp ryu/f2s.cpp
  )
  for s in "${cxx_srcs[@]}"; do
    base=$(basename "$s")
    cmds+=("$CLANGXX ${COMMON[*]} ${picflags[*]} ${CXX_DEFS[*]} -DLIBCXX_BUILDING_LIBCXXABI=1 -D_LIBCPP_DISABLE_VISIBILITY_ANNOTATIONS -c $LLVM_SRC/libcxx/src/$s -o $objdir/cxx/${base}.o")
  done

  echo "== compile $name (${#cmds[@]} TUs, jobs=$JOBS)"
  printf '%s\n' "${cmds[@]}" | xargs -P "$JOBS" -I{} bash -c '{}'

  echo "== archive $name"
  "$AR" rcs "$libdir/libunwind.a" "$objdir/unwind"/*.o
  "$AR" rcs "$libdir/libc++abi.a" "$objdir/cxxabi"/*.o
  "$AR" rcs "$libdir/libc++.a" "$objdir/cxx"/*.o
  # Headers once (shared).
  mkdir -p "$OUT_ROOT/install-$name/include"
  rsync -a "$HDR/include/" "$OUT_ROOT/install-$name/include/"
  echo "  → $libdir"
}

mkdir -p "$OUT_ROOT"
compile_tree OFF static
compile_tree ON pic
echo "== manual-cxx: done"
ls -la "$OUT_ROOT"/install-*/lib/wasm32-wasi/
