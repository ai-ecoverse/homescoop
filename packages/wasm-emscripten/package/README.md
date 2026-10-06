# @ai-ecoverse/wasm-emscripten

Emscripten **6.0.9-git** for the SLICC wasm realm. Launchers run `emcc.py`
(and friends) on `@ai-ecoverse/wasix-python` (`python3 -S`) with `EM_CONFIG`
pointing at this package's config.

## Companions

| Package | Role |
|---------|------|
| `@ai-ecoverse/wasix-python` | Python that runs `em*.py` |
| `@ai-ecoverse/wasm-clang` | `LLVM_ROOT` (clang / wasm-ld) |
| `@ai-ecoverse/wasm-binaryen` | `BINARYEN_ROOT` (wasm-opt, …) |
| `@ai-ecoverse/emscripten-cache` | Read-only prebuilt `sysroot/` |
| `esbuild-wasm@0.28.2` | SLICC `node` ESM/TLA transpile (`compiler.mjs`, …) |
| `typescript@6.0.3` | Fallback transpile path when esbuild is unavailable |
| `acorn` / `acorn-import-phases` | JS optimizer (`acorn-optimizer.mjs`) |

## Default link (wasm realm)

Executable links (not `-c` / `-r` / `-shared`) inject `homescoop_em_cli_ldflags`
(`-sENVIRONMENT=web,worker,node -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1
-sFORCE_FILESYSTEM=1`) and
`lib/slicc/{slicc_spawn,slicc_exec,slicc_signals,slicc_select,slicc_libc_gaps,slicc_jobs}.o`.
Opt out with **`SLICC_EMCC_PLAIN=1`** for plain web glue.
`lib/slicc/slicc_main_envp.o` (make: `-Dmain=slicc_tool_main`) and
`lib/slicc/slicc_fork.o` + `lib/slicc/slicc-fork.js` (needs ASYNCIFY) are
shipped but not auto-linked. Fork opt-in:

```bash
emcc … $SLICC_EM_LIBDIR/slicc_fork.o \
  --js-library $SLICC_EM_LIBDIR/slicc-fork.js \
  -sASYNCIFY -sASYNCIFY_STACK_SIZE=1048576 \
  -sEXPORTED_RUNTIME_METHODS=FS,ENV,callMain,sliccRunMain,sliccForkChild
```

Root `$PKG/emcc` (cmake toolchain) and `$PKG/bin/emcc` are the same self-sufficient launcher.

## CACHE model

- **`EM_CACHE`** = `$XDG_CACHE_HOME/emscripten` or `~/.cache/emscripten` (writable, user-owned)
- On first use, `bin/em-ensure-cache` creates `$EM_CACHE/sysroot` as a **symlink** into `@ai-ecoverse/emscripten-cache/sysroot` — **no 100MB copy**
- It also copies `stamps/sysroot_install.stamp` as a **real file** into `$EM_CACHE` so emcc never reinstalls headers through the symlink
- `js_output/` and `symbol_lists/` warm in the user dir (survive `ipk` reinstall)
- `FROZEN_CACHE = False` so warm caches work; `--clear-cache` skips a symlinked sysroot and the stamp
- Override with `EM_CACHE` if needed

## SLICC patches (September + homescoop)

1. **Wasm-realm CLI link defaults** — see above; optional `SLICC_VFS_PRE_JS` only when set (node-realm)
2. **Configure patch** — autoconf/conftest skips `NODERAWFS` under CLI defaults
3. **`ac_cv_build` seeding** — `emconfigure` sets `ac_cv_build=x86_64-pc-linux-gnu` (and host/target) so `config.guess` is not required in-realm
4. **Closure unsupported** — `-sCLOSURE=1` / `--closure` fail with: *Closure Compiler is not available in SLICC's Emscripten package*
5. **Cache erase** — will not delete a symlinked `sysroot`
6. **`execvpe`** — `tools/utils.py` passes `os.environ` so emconfigure/`emmake` keep `CC=emcc`

## Commands

`emcc`, `em++`, `emar`, `emranlib`, `emcmake`, `emconfigure`, `emmake`, `embuilder`, `em-config`, `emscan-deps`

```bash
emcc hello.c -o hello.js    # runnable in the wasm realm
emcmake cmake -S . -B build
emconfigure ./configure --host=wasm32-unknown-emscripten
```
