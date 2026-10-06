# @ai-ecoverse/wasi-zig

Zig 0.16.0 compiler built for **wasm32-wasi** (no LLVM) for use under slicc.

## First cut (accepted on SLICC)

- Works: `zig version`, `zig build-exe`, `zig run`, `zig build`, `zig build run`, `zig build test`, `zig test`, `-ofmt=c`, `ReleaseSmall`
- Unavailable in this cut: **`zig cc` / `zig c++`** — this package is a no-LLVM wasm32-wasi host; those frontends need LLVM/clang extensions. Use `@ai-ecoverse/wasm-clang` for C/C++ instead.

## Environment

`slicc.env` sets absolute paths (SLICC preopens `/`):

- `ZIG_LIB_DIR=${package}/lib`
- `ZIG_GLOBAL_CACHE_DIR=${HOME}/.cache/zig` (spawn-time `${NAME}` expansion; case-sensitive)
- `ZIG_EXE=zig` (bare command name for child spawns; SLICC resolves it)

Without those env vars, upstream `zig env` discovery expects WASI preopens named `/lib` and `/cache`.

## Wasm output (WASI command ABI)

`build-exe -target wasm32-wasi` exports `_start` and does **not** emit a Wasm start section
(section id 8). Hosts that bind memory after instantiate (SLICC, `node:wasi`) must call
`_start` themselves — matching `wasm-ld`.

## WASIX (compiler host only)

The compiler binary imports `wasix_32v1` (`proc_spawn3`, `proc_join`, `fd_pipe`, …) so
`zig run` / `zig build` can spawn on SLICC. User programs built with
`-target wasm32-wasi` do **not** import wasix unless they call `std.process.spawn`
themselves (dead-code elimination).

## compiler_rt

The wasm backend cannot fully compile `compiler_rt.zig` (object-mode TODOs). This package ships host-prebuilt archives under `lib/prebuilt/libcompiler_rt-wasm32-*.a` and loads them automatically on the no-LLVM host.
