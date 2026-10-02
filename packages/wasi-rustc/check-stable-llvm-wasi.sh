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
  -DCMAKE_C_FLAGS='-pthread --target=wasm32-wasip1-threads -D_WASI_EMULATED_MMAN' \
  -DCMAKE_CXX_FLAGS='-pthread --target=wasm32-wasip1-threads -D_WASI_EMULATED_MMAN' \
  -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
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

# Compile LLVM Support with the target flags. This catches POSIX APIs that
# CMake accepts but wasi-libc does not provide, before the long x.py install.
python3 - "$probe/compile_commands.json" <<'PYCOMPILE'
import concurrent.futures
import json
import shlex
import subprocess
import sys
from pathlib import Path

commands = json.loads(Path(sys.argv[1]).read_text())
commands = [entry for entry in commands
            if "/llvm/lib/Support/" in entry["file"] and entry["file"].endswith(".cpp")]
for filename in ("CrashRecoveryContext.cpp", "Signals.cpp"):
    if sum(entry["file"].endswith("/" + filename) for entry in commands) != 1:
        raise SystemExit(f"missing WASI compile command: {filename}")

def compile_unit(entry):
    argv = shlex.split(entry["command"])
    if "-o" in argv:
        index = argv.index("-o")
        del argv[index:index + 2]
    argv.remove("-c")
    argv.append("-fsyntax-only")
    result = subprocess.run(argv, cwd=entry["directory"], capture_output=True, text=True)
    return entry["file"], result.returncode, result.stderr

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(compile_unit, commands))
failed = [(file, stderr) for file, code, stderr in results if code]
print(f"WASI LLVM Support syntax: {len(commands) - len(failed)}/{len(commands)} passed")
for file, stderr in failed:
    print(f"FAIL: {file}")
    print(stderr)
if failed:
    raise SystemExit(1)
PYCOMPILE
