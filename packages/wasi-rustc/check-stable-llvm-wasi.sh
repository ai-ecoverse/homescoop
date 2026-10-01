#!/usr/bin/env bash
# Run from the Rust source root before the long x.py install.
set -euo pipefail
: "${WASI_SDK_PATH:?wasi-sdk is required}"
grep -q 'cfg.define("CMAKE_SYSTEM_NAME", "WASI")' src/bootstrap/src/core/build_steps/llvm.rs
grep -q '.define("UNIX", "1")' src/bootstrap/src/core/build_steps/llvm.rs

probe=build-llvm-wasi-config-probe
cmake -S src/llvm-project/llvm -B "$probe" \
  -DCMAKE_SYSTEM_NAME=WASI -DUNIX=1 -DWASI=TRUE -DCMAKE_CROSSCOMPILING=TRUE \
  -DCMAKE_C_COMPILER="$WASI_SDK_PATH/bin/wasm32-wasip1-threads-clang" \
  -DCMAKE_CXX_COMPILER="$WASI_SDK_PATH/bin/wasm32-wasip1-threads-clang++" \
  -DCMAKE_C_FLAGS='-pthread --target=wasm32-wasip1-threads' \
  -DCMAKE_CXX_FLAGS='-pthread --target=wasm32-wasip1-threads' \
  -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
  -DLLVM_TABLEGEN=/usr/bin/true \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly -DLLVM_ENABLE_PROJECTS=lld \
  -DLLVM_BUILD_TOOLS=OFF -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_ENABLE_ZSTD=OFF -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
  > "$probe.log" 2>&1 || { cat "$probe.log"; exit 1; }
grep -q '^#define LLVM_ON_UNIX 1$' "$probe/include/llvm/Config/llvm-config.h" || {
  cat "$probe/include/llvm/Config/llvm-config.h"
  exit 1
}
tail -8 "$probe.log"
grep '^#define LLVM_ON_UNIX 1$' "$probe/include/llvm/Config/llvm-config.h"
