#!/bin/sh
# Build a prepared Cargo checkout for wasm32-wasip1-threads:
#   RUSTC=<rustc with this recipe's wasm32-wasip1-threads std> build.sh <cargo-checkout>
# The std must carry patches 0003 and 0013 (PATH splitting, cwd from $PWD).
set -eu
: "${WASI_SDK_PATH:?}"
: "${RUSTC:?}"
src=$(CDPATH= cd -- "$1" && pwd)
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
builtins=$(find "$WASI_SDK_PATH/lib/clang" -name libclang_rt.builtins-wasm32.a -print -quit)
test -f "$builtins"
export CC_wasm32_wasip1_threads="$here/wasi-compat/clang"
export CFLAGS_wasm32_wasip1_threads="--target=wasm32-wasip1-threads --sysroot=$WASI_SDK_PATH/share/wasi-sysroot -pthread"
export AR_wasm32_wasip1_threads="$WASI_SDK_PATH/bin/llvm-ar"
export CARGO_TARGET_WASM32_WASIP1_THREADS_LINKER="$WASI_SDK_PATH/bin/clang"
export CARGO_TARGET_WASM32_WASIP1_THREADS_RUSTFLAGS="-C link-self-contained=no -C link-arg=$builtins -C link-arg=-lwasi-emulated-mman -C link-arg=-lwasi-emulated-getpid -C link-arg=-Wl,--max-memory=4294967296"
export CARGO_PROFILE_RELEASE_STRIP=false CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=false
cd "$src"
cargo build --release --target wasm32-wasip1-threads -p cargo --bin cargo --no-default-features
ls -l "$src/target/wasm32-wasip1-threads/release/cargo.wasm"
