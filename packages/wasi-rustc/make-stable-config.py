#!/usr/bin/env python3
"""Generate a Rust 1.98 bootstrap config for a static WASI-hosted rustc."""

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wasi-sdk", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    sdk = args.wasi_sdk.resolve(strict=True)
    sysroot = sdk / "share/wasi-sysroot"
    linker = sdk / "bin/clang"
    cc = sdk / "bin/wasm32-wasip1-threads-clang"
    cxx = sdk / "bin/wasm32-wasip1-threads-clang++"
    ar = sdk / "bin/ar"
    ranlib = sdk / "bin/ranlib"
    for required in (sysroot, linker, cc, cxx, ar, ranlib):
        if not required.exists():
            parser.error(f"missing wasi-sdk path: {required}")
    config = f'''profile = "compiler"
change-id = "ignore"

[build]
docs = false
compiler-docs = false
extended = false
tools = []
host = ["wasm32-wasip1-threads"]
target = ["x86_64-unknown-linux-gnu", "wasm32-wasip1", "wasm32-wasip1-threads"]
cargo-native-static = true

[rust]
codegen-backends = ["llvm"]
deny-warnings = false
debug = false
debuginfo-level = 0
incremental = false
strip = false
llvm-bitcode-linker = false

[llvm]
static-libstdcpp = true
ninja = false
download-ci-llvm = false
link-shared = false
targets = "WebAssembly;X86"
experimental-targets = ""

[install]
prefix = "dist"
sysconfdir = "etc"

[target.'wasm32-wasip1']
wasi-root = "{sysroot}"
linker = "{linker}"
codegen-backends = ["llvm"]

[target.'wasm32-wasip1-threads']
wasi-root = "{sysroot}"
linker = "{linker}"
cc = "{cc}"
cxx = "{cxx}"
ar = "{ar}"
ranlib = "{ranlib}"
codegen-backends = ["llvm"]

[target.'x86_64-unknown-linux-gnu']
cc = "gcc"
'''
    args.output.write_text(config)


if __name__ == "__main__":
    main()
