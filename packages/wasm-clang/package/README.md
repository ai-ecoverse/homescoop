# @ai-ecoverse/wasm-clang

Clang/LLD 24 for the slicc wasm realm. Relinked with current libslicc
(`Module.sliccKernel` spawn) + `ENVIRONMENT=web,worker,node`.

Companions:

- `@ai-ecoverse/wasix-sysroot` (`WASIXCC_SYSROOT_PREFIX`)
- `@ai-ecoverse/wasm-binaryen` (`wasm-opt` for fork Asyncify — on `PATH`)

## Drivers

`cc` / `gcc` / `c++` / `g++` / `wasixcc` / `wasix++` are `#!/bin/sh` scripts
(`slicc.commands` `{ "script": "bin/…" }`). Use them as the normal compilers —
no extra WASI/EH flags needed for typical builds.

- Target: `--target=wasm32-wasip1` (sysroot ships a real `lib/wasm32-wasip1`).
- C++ links `-lc++ -lc++abi -lunwind` (exnref exceptions, threads, iostream).
- Output is a **WASI program** SLICC runs directly (no separate host wrapper).
- Executable link that imports `proc_fork` / `stack_checkpoint` runs
  `wasm-opt --asyncify` (from `@ai-ecoverse/wasm-binaryen`) automatically so
  **fork works** on the SLICC host. Plain programs skip asyncify.
- **`-shared`**: side module, `-nostdlib` (no libc) — resolve symbols against
  a PIE main that exports them.
- **PIE / dlopen main**: `cc -rdynamic …` or `cc -fPIC foo.c -o foo` (no
  `-shared`) → `-pie --export-all`, libc whole-archive, tag stubs. Then
  `dlopen("./libsq.so")` works.
- **CMake**: `CC=cc CXX=c++ cmake …` — Clang 24 is identified; `pthread.h`
  and the sysroot resolve under SLICC.

```bash
cc hello.c -o hello
cc -fPIC -shared sq.c -o libsq.so
cc -rdynamic -fPIC dl.c -o dl   # PIE main exporting libc for dlopen
c++ -O2 t.cpp -o t              # iostream + exceptions + threads

CC=cc CXX=c++ cmake -S . -B build
cmake --build build
```

## LLVM tool aliases (emcc path spawn)

`bin/` ships glue **file copies** for names emcc constructs under `LLVM_ROOT`:
`clang++`, `wasm-ld`, `ld.lld`, `llvm-ranlib`, `llvm-strip`. Each is a
byte-copy of the primary glue (`clang` / `lld` / `llvm-ar` / `llvm-objcopy`);
the `.wasm` stays next to the primary name only (`locateFile("clang.wasm")`
etc.). `slicc.commands` argv0 aliases still work for PATH lookups.

**Not shipped** (emcc only needs these for `-g` / split-dwarf / coverage /
`emsize` / sourcemap demangle): `llvm-dwarfdump`, `llvm-dwp`,
`clang-scan-deps`, `llvm-profdata`, `llvm-cov`, `llvm-size`, `llvm-cxxfilt`.
