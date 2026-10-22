# @ai-ecoverse/wasm-clang

Clang/LLD 24 for the slicc wasm realm, linked in CI from
`@ai-ecoverse/llvm-emscripten` (llvm-project b158b0ae compiled by the patched
emscripten 6.0.9 tree) against current libslicc (`Module.sliccKernel` spawn,
kernel credentials) with `ENVIRONMENT=web,worker,node`.

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

- **Assembly**: for input that is only plain assembly (`.s`, `.asm`,
  or `-x assembler`), the driver leaves out the C flags clang ignores there
  (`-D_WASI_EMULATED_*`, `-pthread` when not linking, `-mthread-model`,
  `-fno-trapping-math`, `-fbracket-depth`, `-ftls-model`, `-fvisibility`), so
  `cc -Werror -c foo.s` works. `.S` and mixed C and assembly keep them.
- **No link, no link flags**: with `-fsyntax-only`, `-emit-ast` or
  `--analyze` (as with `-c`, `-S`, `-E` and `-M`), the driver leaves out its
  link libraries and `-Wl,` flags, so `cc -Werror -fsyntax-only foo.c`
  (configure and CMake checks, editors) works. A `.s` under `-fsyntax-only`
  still gets clang's own `'assembler' input unused`, as upstream clang does.
  `-###` and `-fdriver-only` keep them, since they show or check the full
  link plan.

## One module for every tool

`bin/llvm.wasm` holds clang, lld, llvm-ar, llvm-nm, llvm-objcopy and
llvm-symbolizer, linked together so they share one copy of LLVM; the tool is
chosen by its name (argv[0]), or `llvm <tool> args…`. `bin/` ships a glue
**file** under every name emcc constructs under `LLVM_ROOT` (`clang`,
`clang++`, `lld`, `wasm-ld`, `ld.lld`, `llvm-ar`, `llvm-ranlib`, `llvm-nm`,
`llvm-objcopy`, `llvm-strip`, `llvm-symbolizer`): each is a byte-copy of
`bin/llvm`, which locates `llvm.wasm` beside it. `slicc.commands` covers the
same names plus `ar`, `ranlib`, `nm`, `strip` for PATH lookups.

**Not shipped** (emcc only needs these for `-g` / split-dwarf / coverage /
`emsize` / sourcemap demangle): `llvm-dwarfdump`, `llvm-dwp`,
`clang-scan-deps`, `llvm-profdata`, `llvm-cov`, `llvm-size`, `llvm-cxxfilt`.

```bash
cc hello.c -o hello
cc -fPIC -shared sq.c -o libsq.so
cc -rdynamic -fPIC dl.c -o dl   # PIE main exporting libc for dlopen
c++ -O2 t.cpp -o t              # iostream + exceptions + threads

CC=cc CXX=c++ cmake -S . -B build
cmake --build build
```

## Environment and paths

`bin/llvm` links `shims/slicc/slicc-env.js`: the tools' environment is only
what the kernel passes, with none of Emscripten's placeholders
(`USER=web_user`, `HOME=/home/web_user`, `PATH=/`). After `env -i`, clang has
no `PATH`, so it doesn't look for helpers such as `wasm-opt` in `/`.

The glue is linked with wasm-emscripten's package patches (0014: a path may
go through 40 symbolic links, as on Linux, and the 41st is `ELOOP`).

## Notices

`THIRD-PARTY-NOTICES.md` covers the Emscripten runtime, the wasix-sysroot
compiler-rt builtins, llvm-project's LLVM Support notices and homescoop's own
slicc shims (Apache-2.0).
