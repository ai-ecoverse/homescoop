#!/usr/bin/env bash
# Run from the patched Rust checkout after restoring a completed WASI LLVM build.
set -euo pipefail

: "${WASI_SDK_PATH:?}"
: "${WASI_SYSROOT:?}"
llvm_include=${LLVM_INCLUDE_DIR:-build/wasm32-wasip1-threads/llvm/include}
test -f "$llvm_include/llvm/Config/config.h"

# Mirror the rustc_llvm cc-rs flag order. llvm-config contributes the plain
# wasm32-wasi target; the final target must select wasi-sdk's threaded libc++.
"$WASI_SDK_PATH/bin/wasm32-wasip1-threads-clang++" \
  -O3 -ffunction-sections -fdata-sections -fno-exceptions \
  "--sysroot=$WASI_SYSROOT" -pthread --target=wasm32-wasi \
  -Werror -fno-omit-frame-pointer "-I$llvm_include" \
  -Isrc/llvm-project/llvm/include -Isrc/llvm-project/lld/include \
  -std=c++17 -D_GNU_SOURCE -D_GLIBCXX_USE_CXX11_ABI=1 \
  -D__STDC_CONSTANT_MACROS -D__STDC_FORMAT_MACROS -D__STDC_LIMIT_MACROS \
  -fno-exceptions -fno-rtti -pthread -D_WASI_EMULATED_MMAN \
  --target=wasm32-wasip1-threads \
  -fsyntax-only compiler/rustc_llvm/llvm-wrapper/PassWrapper.cpp
