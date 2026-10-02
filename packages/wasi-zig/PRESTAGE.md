# wasi-zig PRESTAGE

- `tar tvzf … | grep -E '^[lh]'` empty (no symlinks/hardlinks in the npm tarball)
- `zig version` → `0.16.0` under wasmtime/slicc with `/lib`+`/cache` preopens (or `ZIG_*` on SLICC)
- `zig build-exe hello.zig -target wasm32-wasi -OReleaseSmall` produces `hello.wasm`
- `hello.wasm` has **no** start section (id 8); exports `_start`
- `hello.wasm` runs under **node:wasi** (not only wasmtime)
- `hello.wasm` has **no** `wasix_32v1` imports (pure preview1)
- `process.Init` user program (`io.zig`) compiles + runs for wasm32-wasi (Args.Vector stays void)
- `zig build` on a trivial `build.zig` installs `zig-out/bin/app.wasm` (needs WASIX spawn; SLICC)
- `zig build run` / `zig build test` with `addRunArtifact` + `addTest` (Run step; needs WASIX; SLICC)
- `zig.wasm` **does** import `wasix_32v1` (spawn for run/build on SLICC)
- package.json `ZIG_GLOBAL_CACHE_DIR` is `${HOME}/.cache/zig`; `ZIG_EXE` is `zig`
