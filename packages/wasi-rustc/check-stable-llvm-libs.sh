#!/usr/bin/env bash
# Run from the Rust source root before the long x.py install.
set -euo pipefail
: "${WASI_SDK_PATH:?wasi-sdk is required}"

probe=${LLVM_WASI_PROBE_DIR:-build-llvm-wasi-libs-probe/target}
native_bin=${LLVM_WASI_NATIVE_TOOLS_DIR:-build-llvm-wasi-libs-probe/native/bin}
mkdir -p "$(dirname "$probe")" "$(dirname "$native_bin")"

if [[ ! -x "$native_bin/llvm-min-tblgen" || ! -x "$native_bin/llvm-tblgen" ]]; then
  native_build=${native_bin%/bin}
  cmake -G Ninja -S src/llvm-project/llvm -B "$native_build" \
    -DCMAKE_BUILD_TYPE=Release '-DLLVM_TARGETS_TO_BUILD=WebAssembly;X86' \
    -DLLVM_BUILD_TOOLS=OFF -DLLVM_BUILD_UTILS=OFF \
    -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBEDIT=OFF \
    -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF \
    -DLLVM_INCLUDE_BENCHMARKS=OFF > "$native_build-config.log" 2>&1 || {
      cat "$native_build-config.log"
      exit 1
    }
  cmake --build "$native_build" --parallel 4 \
    --target llvm-min-tblgen llvm-tblgen > "$native_build-build.log" 2>&1 || {
      tail -100 "$native_build-build.log"
      exit 1
    }
fi
native_bin=$(cd "$native_bin" && pwd)

cmake -G Ninja -S src/llvm-project/llvm -B "$probe" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_SYSTEM_NAME=WASI -DUNIX=1 -DWASI=TRUE \
  -DCMAKE_CROSSCOMPILING=TRUE -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
  -DCMAKE_C_COMPILER="$WASI_SDK_PATH/bin/wasm32-wasip1-threads-clang" \
  -DCMAKE_CXX_COMPILER="$WASI_SDK_PATH/bin/wasm32-wasip1-threads-clang++" \
  "-DCMAKE_C_FLAGS=-pthread --target=wasm32-wasip1-threads -D_WASI_EMULATED_MMAN" \
  "-DCMAKE_CXX_FLAGS=-pthread --target=wasm32-wasip1-threads -D_WASI_EMULATED_MMAN" \
  '-DCMAKE_EXE_LINKER_FLAGS=-lwasi-emulated-mman -Wl,--max-memory=4294967296 -Wl,-z,stack-size=1048576 -Wl,--stack-first' \
  -DCMAKE_EXECUTABLE_SUFFIX=.wasm '-DLLVM_TARGETS_TO_BUILD=WebAssembly;X86' \
  -DLLVM_ENABLE_PROJECTS=lld -DLLVM_NATIVE_TOOL_DIR="$native_bin" \
  -DLLVM_HEADERS_TABLEGEN="$native_bin/llvm-min-tblgen" \
  -DLLVM_TABLEGEN="$native_bin/llvm-tblgen" \
  -DLLVM_BUILD_TOOLS=OFF -DLLVM_BUILD_UTILS=OFF \
  -DLLVM_TOOL_LLVM_CONFIG_BUILD=OFF -DLLD_BUILD_TOOLS=OFF \
  -DLLVM_BUILD_SHARED_LIBS=OFF -DLLVM_ENABLE_PIC=OFF \
  -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF > "$probe-config.log" 2>&1 || {
    cat "$probe-config.log"
    exit 1
  }

mapfile -t libs < <(ninja -C "$probe" -t targets all | \
  python3 -c 'import re,sys; [print(m.group(1)) for line in sys.stdin if (m := re.match(r"^(lib/lib(?:LLVM|lld)[^:]*\.a):", line))]')
if ((${#libs[@]} < 100)); then
  printf 'Expected at least 100 LLVM/LLD libraries; found %s\n' "${#libs[@]}" >&2
  exit 1
fi
printf 'WASI LLVM/LLD library preflight: building %s static libraries\n' "${#libs[@]}"
ninja -C "$probe" -k 0 -j4 "${libs[@]}" > "$probe-build.log" 2>&1 || {
  grep -E 'FAILED:|error:' "$probe-build.log" || true
  tail -80 "$probe-build.log"
  exit 1
}
if grep -q 'FAILED:' "$probe-build.log"; then
  tail -80 "$probe-build.log"
  exit 1
fi
tail -5 "$probe-build.log"
