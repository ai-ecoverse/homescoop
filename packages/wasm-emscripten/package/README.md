# @ai-ecoverse/wasm-emscripten

Emscripten **6.0.9-git** for the SLICC wasm realm. Launchers run `emcc.py`
(and friends) on `@ai-ecoverse/wasix-python` (`python3 -S`) with `EM_CONFIG`
pointing at this package's config.

> **emcc does not run on slicc-kernel yet** (exec of the glue by path, and no
> `node`), see [slicc-kernel#390](https://github.com/ai-ecoverse/slicc-kernel/issues/390).
> Since 6.0.9-18 the companions are found beside this package (npm, slicc's
> `ipk add -g`, pnpm's virtual store) instead of only under
> `/shared/lib/node_modules`.

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
`lib/slicc/{slicc_spawn,slicc_exec,slicc_signals,slicc_select,slicc_libc_gaps,slicc_jobs,slicc_realpath}.o`,
with the JS libraries `lib/slicc/{slicc-writev,slicc-linkat,slicc-uname,slicc-env}.js`.
`slicc-env.js` (since 6.0.9-27) gives a program only the environment the
kernel passes: none of Emscripten's placeholders (`USER`/`LOGNAME=web_user`,
`HOME=/home/web_user`, `PATH=/`, `PWD=/`), so under `env -i` they are unset.
Opt out with **`SLICC_EMCC_PLAIN=1`** for plain web glue.
`lib/slicc` is compiled from homescoop's slicc shims (`shims/slicc`,
Apache-2.0); `THIRD-PARTY-NOTICES.md` carries that licence.
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

### Package-only patches (`package-patches/`, since 6.0.9-27)

On top of the shared `patches/` (which `scripts/emscripten-tree.sh` also
applies for emscripten-cache, llvm-emscripten, wasm-clang, wasm-binaryen and
cmake), this package ships three patches from `package-patches/` and one from
`package-patches/libc/`. They are kept
out of `patches/` so they don't change the published glue of those packages
without their own release:

- **0014, the symlink bound** (homescoop#611): `FS.lookupPath` allows 40
  symlink follows, as Linux does, and the 41st is `ELOOP`. Before it, a path
  of exactly 40 follows was `ELOOP` in every program this emcc linked.
- **0015, `slicc-env.js` in the default link** (homescoop#1531), as
  `homescoop_em_cli_ldflags` has it.

- **0016, `slicc_realpath.o` in the default link** (homescoop#1631): the
  default link adds `lib/slicc/slicc_realpath.o`, musl's `realpath.c` with
  libc patch 0017, compiled with libc's flags. Because it is an object on the
  link line, `libc.a`'s own `realpath` member is never pulled in, so
  emscripten-cache's prebuilt `libc.a` stays as it is. `SLICC_EMCC_PLAIN=1`
  links skip it and get musl's bound.
- **libc/0017, musl's realpath bound** (homescoop#1631): musl stops at
  `++cnt == SYMLOOP_MAX`, so `realpath()` of a path of exactly 40 symlink
  follows was `ELOOP` even after 0014 fixed `open()` and `stat()`. 0017 makes
  it `cnt++ == SYMLOOP_MAX`: 40 follows resolve and the 41st is `ELOOP`, as
  in glibc.

build.sh applies 0014-0016 to the shipped tree and to the tree it links its
PRESTAGE programs with. `package-patches/libc/` is applied to the shipped
tree only, so the PRESTAGE host tree builds the same upstream `libc.a` that
emscripten-cache ships; PRESTAGE then checks open, stat and realpath at 40
and 41 follows (absolute and relative chains) with the default link, and
that without `slicc_realpath.o` realpath is still `ELOOP` at 40. wasm-clang, wasm-binaryen and cmake pick them up at
their own next release, or a later wave folds them into `patches/`.

## Commands

`emcc`, `em++`, `emar`, `emranlib`, `emcmake`, `emconfigure`, `emmake`, `embuilder`, `em-config`, `emscan-deps`

```bash
emcc hello.c -o hello.js    # runnable in the wasm realm
emcmake cmake -S . -B build
emconfigure ./configure --host=wasm32-unknown-emscripten
```
