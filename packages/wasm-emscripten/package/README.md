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
`lib/slicc/{slicc_spawn,slicc_exec,slicc_signals,slicc_select,slicc_libc_gaps,slicc_jobs}.o`
and the archives `lib/slicc/libslicc_signals.a` (`kill`),
`lib/slicc/libslicc_select.a` (`poll`, `pselect`),
`lib/slicc/libslicc_libc_gaps.a` (`nanosleep` and the 8 `set*id`),
`lib/slicc/libslicc_jobs.a` (`tcgetpgrp`, `tcsetpgrp`) and
`lib/slicc/libslicc_realpath.a`,
with the JS libraries `lib/slicc/{slicc-writev,slicc-linkat,slicc-uname,slicc-env}.js`.
`slicc-env.js` (since 6.0.9-27) gives a program only the environment the
kernel passes: none of Emscripten's placeholders (`USER`/`LOGNAME=web_user`,
`HOME=/home/web_user`, `PATH=/`, `PWD=/`), so under `env -i` they are unset.
Opt out with **`SLICC_EMCC_PLAIN=1`** for plain web glue.

`-sMAIN_MODULE=1` and `-sLINKABLE=1` links (since 6.0.9-30, homescoop#1678)
wrap every input in `--whole-archive`, so all of `libc.a` is linked, and
every slicc override of a libc function would be a duplicate symbol. Those
links take `lib/slicc/linkable/*.o` instead: the same six objects compiled
with `-fPIC` (a main module needs it), with `kill`, `poll`, `pselect`,
`nanosleep`, `setuid`, `setgid`, `seteuid`, `setegid`, `setreuid`,
`setregid`, `setresuid`, `setresgid`, `tcgetpgrp` and `tcsetpgrp` renamed
out (`-D<name>=slicc_linkable_<name>`, so the shim's own calls inside an
object still reach its version), and without the override archives. Those links
get libc's versions of these functions and musl's `realpath` (`ELOOP` at 40
symlink follows): no kernel signals through `kill`, no kernel `poll`,
`pselect` or credentials, and `tcgetpgrp`/`tcsetpgrp` answer 0 and
`EINVAL` on a terminal. Everything else in the slicc defaults (spawn, exec,
the signal mask and `raise`, uname, the environment, the kernel's process
groups and sessions) stays. `-sMAIN_MODULE=2` and `-sSIDE_MODULE` are not
affected: the first links like any executable, the second gets no slicc
defaults. Every `-sMAIN_MODULE` link needs the `-fPIC` system libraries in `sysroot/lib/wasm32-emscripten/pic`; emscripten-cache
ships them from 6.0.9-7 (homescoop#1699), so these links need nothing built
and work from a read-only global install. With emscripten-cache 6.0.9-6
(wasm-emscripten 6.0.9-30) emcc tried to build them into the package and
failed with `PermissionError`.
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
cmake), this package ships five patches from `package-patches/` and one from
`package-patches/libc/`. They are kept
out of `patches/` so they don't change the published glue of those packages
without their own release:

- **0014, the symlink bound** (homescoop#611): `FS.lookupPath` allows 40
  symlink follows, as Linux does, and the 41st is `ELOOP`. Before it, a path
  of exactly 40 follows was `ELOOP` in every program this emcc linked.
- **0015, `slicc-env.js` in the default link** (homescoop#1531), as
  `homescoop_em_cli_ldflags` has it.

- **0016, `libslicc_realpath.a` in the default link** (homescoop#1631,
  #1664): the default link adds `lib/slicc/libslicc_realpath.a`, an archive
  whose one member, `slicc_realpath.o`, is musl's `realpath.c` with libc
  patch 0017, compiled with libc's flags. It comes after the program's own
  inputs and before `libc.a`, so the linker pulls it only when `realpath`
  is still undefined, and then `libc.a`'s own `realpath` member is never
  pulled in; emscripten-cache's prebuilt `libc.a` stays as it is. A program
  that defines its own `realpath` (in its sources, an object or an archive
  or `-l` on its command line) keeps it, as it did before 6.0.9-28. 6.0.9-28
  added `slicc_realpath.o` as a plain object, which is always linked, so such
  a program got `duplicate symbol: realpath` (#1664). `SLICC_EMCC_PLAIN=1` links skip
  the archive and get musl's bound.
- **0018, the override archives and `-sMAIN_MODULE=1`** (homescoop#1678):
  the default link adds `lib/slicc/libslicc_jobs.a` beside
  `libslicc_realpath.a`, and for `-sMAIN_MODULE=1` and `-sLINKABLE` links
  takes `lib/slicc/linkable/<obj>` for each default object and leaves both
  archives out. `slicc_jobs.o` is compiled with `tcgetpgrp` and
  `tcsetpgrp` renamed out; `libslicc_jobs.a` has one member per override,
  `slicc_tcgetpgrp.o` and `slicc_tcsetpgrp.o`, each `slicc_jobs.c` with
  every other global renamed, so the linker pulls each only while its
  symbol is undefined, and a program's own `tcsetpgrp` wins. libc's
  `tcsetpgrp` is not enough: it goes through emscripten's `TIOCSPGRP`
  ioctl, which is `EINVAL` on every terminal and never reaches the kernel.
  build.sh fails if a member defines a global the base object also
  defines, or if a `linkable` object still defines one of libc's.
- **0019, the other override archives** (homescoop#1724): the default link
  also adds `lib/slicc/libslicc_signals.a`, `libslicc_select.a` and
  `libslicc_libc_gaps.a`. `slicc_signals.o`, `slicc_select.o` and
  `slicc_libc_gaps.o` are compiled with the 12 libc functions they override
  renamed `<object>_<name>` (`slicc_signals_kill`, `slicc_select_poll`,
  `slicc_libc_gaps_setuid`, …). Each archive member, `slicc_<name>.o`, is a
  one-line function `<name>` that calls that renamed definition, so the
  linker pulls a member only while the program leaves `<name>` undefined,
  and a program that defines its own `kill`, `poll`, `pselect`,
  `nanosleep` or `set*id` links and runs its own; until 6.0.9-30 those 12
  were strong definitions in the always-linked objects, so it got
  `duplicate symbol`. The members depend only on the always-linked objects,
  never on each other, so a program's own `poll` leaves the slicc
  `pselect` in place. The shims' own calls (`slicc_exec.o` calls `kill`)
  go through the symbol, so they reach the program's version when it has
  one. build.sh fails if a plain object still defines an override, or a
  member defines anything but its own symbol.
- **libc/0017, musl's realpath bound** (homescoop#1631): musl stops at
  `++cnt == SYMLOOP_MAX`, so `realpath()` of a path of exactly 40 symlink
  follows was `ELOOP` even after 0014 fixed `open()` and `stat()`. 0017 makes
  it `cnt++ == SYMLOOP_MAX`: 40 follows resolve and the 41st is `ELOOP`, as
  in glibc.

build.sh applies 0014-0016, 0018 and 0019 to the shipped tree and to the tree it links its
PRESTAGE programs with. `package-patches/libc/` is applied to the shipped
tree only, so the PRESTAGE host tree builds the same upstream `libc.a` that
emscripten-cache ships; PRESTAGE then checks open, stat and realpath at 40
and 41 follows (absolute and relative chains) with the default link, and
that without `libslicc_realpath.a` realpath is still `ELOOP` at 40. wasm-clang, wasm-binaryen and cmake pick them up at
their own next release, or a later wave folds them into `patches/`.

Since 6.0.9-29 PRESTAGE also links programs that define their own
`realpath`: in the program's source, in a later object, in an archive and
through `-l`. Each must link with the default link and run its own
`realpath`. It also checks that 6.0.9-28's shape, `slicc_realpath.o` as a plain object
beside a program's own `realpath`, still gives `duplicate symbol: realpath`
(homescoop#1664).

Since 6.0.9-30 PRESTAGE links `jobs.c` (realpath, uname, `tcgetpgrp(0)` and
`tcsetpgrp(0, getpid())`) with the default link (`tcgetpgrp self tcsetpgrp
0 ok`; without `libslicc_jobs.a` it is libc's `0` and `EINVAL`), with
`-sMAIN_MODULE=1` and with `-sLINKABLE=1`, and runs each; the last two must
answer libc's `0` and `EINVAL` and export `slicc_linkable_kill`, which the
default link's wasm must not have. It links `own-tc.c`, which defines its
own `tcsetpgrp`, and runs its own. 6.0.9-29's `lib/slicc` (`slicc_jobs.o`
with both overrides, no `linkable/`) must give `duplicate symbol: tcsetpgrp`
for `own-tc.c` and fail the `-sMAIN_MODULE=1` and `-sLINKABLE=1` links
(homescoop#1678).

Since 6.0.9-31 PRESTAGE links `own-libc.c`, which calls all 12 of `kill`,
`poll`, `pselect`, `nanosleep` and the 8 `set*id`, with a `--pre-js`
stand-in kernel, and prints for each whether the slicc, libc or the
program's own version answered. The default link must print `slicc` for
all 12 (and `libc` for all 12 without the three archives). Defining any
one of them in the program's source, or `poll` and `nanosleep` in its own
`-l` archive, must link and print `own` for those and `slicc` for the rest.
With 6.0.9-30's plain objects each of the 12 gives `duplicate symbol:
<name>` (homescoop#1724).
`priv.c` checks that the privilege drop really happens: as root, with a
stand-in kernel that keeps credentials, `setgid(5)`, `setresuid(6, 0, 6)`
and `setuid(5)` must change what `getgid`, `getresuid`, `getuid` and
`geteuid` report. Without `libslicc_libc_gaps.a`, libc's stubs return -1
and leave every id at 0, so the row fails.

## Commands

`emcc`, `em++`, `emar`, `emranlib`, `emcmake`, `emconfigure`, `emmake`, `embuilder`, `em-config`, `emscan-deps`

```bash
emcc hello.c -o hello.js    # runnable in the wasm realm
emcmake cmake -S . -B build
emconfigure ./configure --host=wasm32-unknown-emscripten
```
