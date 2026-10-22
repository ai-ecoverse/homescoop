# Negative proof (wasm-emscripten)

## 6.0.9-18: path resolution (#277)

`run-paths.mjs --expect old` against 6.0.9-17 is a `ci` entry: in an npm layout its em-config looks under `/shared/lib/node_modules`, which no package manager fills.

## 6.0.9-19: the companions' glue (homescoop#276, 2026-10-16)

`run-paths.mjs --layout flat` against the published 6.0.9-18 on slicc-kernel 1.61.0 (the cert kernel): FAIL, with `clang --version (24.0.0-12): rc=70`. The wasm-clang that 6.0.9-18 pins carries slicc-emscripten's unguarded Node-host runner, which runs a second main with no arguments wherever the worker exposes `process`, as kernels before 1.93.0 do. 6.0.9-19 pins wasm-clang 24.0.0-18 and wasm-binaryen 132.0.0-2 (#610, #693), whose glue stays out of a host that sets `noInitialRun`. Both `--version` calls exit 0 with nothing on stderr.

## 6.0.9-20: built from the 6.0.9 tag in CI (homescoop#859, #205, #538, #745; 2026-10-17)

- **Supply chain.** The published 6.0.9-19 is a repack whose root, 6.0.9-11, was an rsync of a local slicc-emscripten checkout: no provenance and no recorded commit. `repack-input.mjs` makes that INCOMPLETE. 6.0.9-20 fetches the emscripten 6.0.9 tag (4e422385, the emscripten_revision of emsdk's 6.0.9 release f04ea239) by sha256 and applies `patches/0001-0012`. They're 0001-0004, 0006 and 0007 as before, plus 0005, 0008, 0009 and 0010, recovered from the published tree, and the new 0011 and 0012. Through 0010 the patched tree reproduces the published one file for file. 0011 adds `-ffile-prefix-map=<cache>=/emsdk/cache` and `<llvm root>=/emsdk/llvm` to the system library flags: without them the DWARF in every embuilder library names the cache's sysroot/include and clang's resource headers, both build paths, and emscripten-cache's two CI builds differed in 45 of 50 archives. The shim objects are compiled in CI by that tree's emcc on emsdk 6.0.9's prebuilt clang and binaryen, which `scripts/emscripten-tree.sh` pins by sha256.
- **Tarball against 6.0.9-19.** The two differ in four ways:
  - the 8 `lib/slicc/*.o` objects and `slicc-fork.js` (today's `shims/slicc`);
  - new `AUTHORS` and `SECURITY.md` (#538; LICENSE cites them);
  - six upstream lint dotfiles under `system/lib` (`.clang-format`, `.clang-tidy`) that are no longer shipped;
  - `package.json` (version, `files`, the wasm-clang pin 24.0.0-21).

  Everything else is byte-identical.
- **`test/files.test.mjs` fails on 6.0.9-19:** `build.sh files entries name the tarball exactly` reports `Media (there: media)`. npm on Linux matches `files` case-sensitively, so a Linux pack of -19's list would drop the logos (#205). The package.json now says `media`, and all three file tests pass on 6.0.9-20.
- **By path (#745).** On 1.110.7, `run-paths.mjs` (flat) passes for 6.0.9-20: clang and wasm-opt run by path, and `emcc -v` reaches clang. On 1.61.0, the old cert kernel, `emcc -v` fails with `[Errno 45] Exec format error`.

## 0012: the JS halves of today's shims (homescoop#1056)

Building `lib/slicc` from today's `shims/slicc` broke the default link. `slicc_libc_gaps.o` now imports `env.__syscall_uname`, but 0005's defaults did not add `slicc-uname.js`, so any program calling `uname()` failed:

```text
error: undefined symbol: __syscall_uname
```

6.0.9-19's objects have no such import. 0012 ships `slicc-writev.js`, `slicc-linkat.js` and `slicc-uname.js` in `lib/slicc/`, and adds them as `--js-library` defaults. The default link also gets `homescoop_slicc_keep_exports`'s `-u slicc_raise`, `slicc_sig_mask`, `slicc_sigpipe` and `slicc_cred_euid`, plus `--wrap=raise`, so it matches `homescoop_em_cli_ldflags`. build.sh's PRESTAGE now links a program that calls `uname`, `link`, `getuid`, `getrlimit` and `raise` with the packaged defaults, and runs it under node: `uname 0 Emscripten`, and the SIGUSR1 handler runs.


## 6.0.9-21: the companion pins and the -Werror link (homescoop#1028, #1069; 2026-10-18)

`test/pinned-cache.mjs` runs emscripten-cache's cert on the exact emscripten-cache version a tarball pins. The published 6.0.9-20 pins 6.0.9-3, which fails it:

```text
AssertionError: libraries name a build path in their DWARF (patch 0011 maps the cache and the llvm root): libGL-getprocaddr: /Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/cache/sysroot/include | …
FAIL the pinned emscripten-cache 6.0.9-3 fails its cert against this tree
```

With that row out of the way, its `libc.a` still lacks `epoll_create1`, `ppoll` and `__syscall_pipe`, which the 6.0.9 headers declare. 6.0.9-21 pins 6.0.9-4, the CI build from the same tree, and passes. wasm-binaryen moves from 132.0.0-2 to 132.0.0-3, the CI build of binaryen d03c25ea, which has the credential library.

On 6.0.9-20 a default link that pulls in `lib/slicc/slicc-linkat.js` warns `signature redefinition for: __syscall_linkat__sig`, so `-Werror` links fail (#1069). Emscripten's `libsigs.js` already has the same `'iipipi'`. 6.0.9-21 ships the file without that line, and PRESTAGE links `calls.c` with `-Werror` and requires the warning to be absent.

## 6.0.9-22: the inherited-ignore and flock shims (homescoop#973, #947, via #960; 2026-10-18)

6.0.9-22 compiles `lib/slicc` from #960's `shims/slicc`. `slicc_signals.o` gets the `constructor(101)` that seeds `SIG_IGN` from `sliccKernel.sigInherited()`. `slicc_libc_gaps.o` gets the strong `flock()` through `env.__syscall_flock`. Both are no-ops on kernels without slicc-kernel#967 and #968. On the published 6.0.9-21, `test/files.test.mjs` fails:

```text
AssertionError: slicc_signals.o has no slicc_sig_inherited_js (the #973 constructor)
```

The emscripten tree, the patches and the pins are unchanged from 6.0.9-21.

## 6.0.9-23: the CI-built wasm-clang and wasm-binaryen (homescoop#859; 2026-10-19)

`test/companions.mjs` packs the exact companions a tarball pins. It fails on the published 6.0.9-22:

```text
FAIL wasm-clang 24.0.0-21 ships no THIRD-PARTY-NOTICES.md; wasm-binaryen 132.0.0-3's wasm-opt.wasm does not import slicc_sig_inherited_js
```

24.0.0-21 is the last wasm-clang relinked from a local slicc-emscripten tree. 132.0.0-3 predates #960's inherited-ignore shim. 6.0.9-23 pins wasm-clang 24.0.0-22 (stage F, built from llvm-emscripten) and wasm-binaryen 132.0.0-4, and passes. The emscripten tree, the patches and the lib/slicc objects are unchanged from 6.0.9-22.

The same release moves wasix-python from the exact 3.14.2-16 to the range `>=3.15.0-2 <3.15.1`. That's the python3.15 flip; check-exact-pins now allows wasm-emscripten that range, as it allows py-*. It also gains `engines: slicc-kernel >=1.122.3`, because wasix-python 3.15.0-2 refuses older kernels. On the old cert kernel 1.110.7, run-paths fails at once: `python3: @ai-ecoverse/wasix-python@3.15.0-2 needs slicc-kernel >=1.122.3`. So the cert kernel moves to 1.132.0, where em-config, em-ensure-cache and `emcc -v` run through CPython 3.15 in the flat and pnpm layouts.

## 6.0.9-24: a sorted musl walk (homescoop#1328; 2026-10-20)

The new `test/files.test.mjs` row fails on the published 6.0.9-23: its `tools/system_libs.py` walks musl in filesystem order. Through embuilder that made libc's `_Exit.o` and `_exit.o` member names depend on the host (emscripten-cache's NEGATIVE.md). Patch 0013 sorts the walk. The other change is `scripts/emscripten-tree.sh`'s exact acorn pins. Apart from those, 6.0.9-24 equals -23.

## 6.0.9-25: the shim's posix_spawnp searches PATH (slicc-kernel#1165, homescoop#1264; 2026-10-19)

6.0.9-25 links the updated `shims/slicc/slicc_spawn.c`. `posix_spawnp` was plain `posix_spawn`; it now searches PATH as execvp does. A candidate that isn't an executable regular file is skipped, and a bare name that isn't found anywhere still goes to the kernel catalog. On #1264, npm-parity found that the build differs from the published 6.0.9-23 in lib/slicc/slicc_spawn.o (6.0.9-24, #1335, left the shim as it was), so this is a packaging bump. The package's own code is unchanged. The behaviour test is coreutils' `cert/spawnp-path.mjs` (`timeout`, the shim's one Emscripten caller that a cert drives).

## 6.0.9-26: shim drift (homescoop#1491; 2026-10-20)

6.0.9-26 ships the updated `shims/slicc` objects and JS libraries: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 6.0.9-25 in `lib/slicc/slicc-uname.js` and `lib/slicc/slicc_spawn.o`, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn and uname tests. `shims/slicc/slicc-env.js` is not added to `lib/slicc` here: that would be a functional change and is left to the owner.

## 6.0.9-27: slicc-env.js, the symlink bound, the shims notice and the cache pin (homescoop#1531, #611, #1536, #840, #1295; 2026-10-22)

`test/files.test.mjs` (the package's `test` job, `HOMESCOOP_TGZ=<tarball>`) fails four rows on the published 6.0.9-26:

```text
not ok 1 - build.sh files entries name the tarball exactly (case-sensitive)       THIRD-PARTY-NOTICES.md (there: nothing)
not ok 7 - lib/slicc ships slicc-env.js and the default link adds it, …           the tarball lacks package/lib/slicc/slicc-env.js
not ok 8 - FS.lookupPath follows 40 symlinks, as Linux does …                      src/lib/libfs.js stops at 39 symlink follows
not ok 9 - THIRD-PARTY-NOTICES.md carries the slicc shims notice for lib/slicc …  the tarball has no THIRD-PARTY-NOTICES.md
```

- **slicc-env.js (#1531).** 6.0.9-26's default link added `slicc-writev.js`, `slicc-linkat.js` and `slicc-uname.js`, but not `slicc-env.js`, which `homescoop_em_cli_ldflags` has had since #1491. So a program a user linked with this emcc saw Emscripten's placeholders: `USER`/`LOGNAME=web_user`, `HOME=/home/web_user`, `PATH=/`, `PWD=/`. 6.0.9-27 ships `lib/slicc/slicc-env.js`, and package patch 0015 adds it to `tools/link.py`'s tuple. build.sh's PRESTAGE links `envi.c` with the packaged defaults and runs it under `env -i node`: all five are `(unset)`. Without 0015 it prints `USER=web_user`.
- **The symlink bound (#611).** 6.0.9's `FS.lookupPath` ran `nlinks < SYMLOOP_MAX` passes, and pass 0 follows no link, so 40 follows were `ELOOP` (scripts/emsdk-patches/libfs-symloop.patch is the 4.0.23 form and doesn't apply to 6.0.9). Package patch 0014 makes it `<=`. PRESTAGE's `symloop.c` builds a 40-link and a 41-link chain in MEMFS: `follows40 ok`, `follows41 ELOOP`. Without 0014 it prints `follows40 ELOOP`.
- **The shims notice (#1536).** `lib/slicc` is compiled from `shims/slicc` (Apache-2.0), but 6.0.9-26 shipped no notice for it; `scripts/shim-notice.mjs` let it through as the closed #844. build.sh now writes `THIRD-PARTY-NOTICES.md` with `homescoop_notice_slicc_shims`, and the KNOWN_WITHOUT_SHIM_NOTICE entry is gone: `scripts/test/shim-notice.test.mjs` fails on 6.0.9-26's build.sh with `wasm-emscripten: links the slicc shims but writes no notice for them`.
- **The cache pin.** `test/pinned-cache.mjs` now runs emscripten-cache's check with `--member-order` (name-ordered libc members, #1328, and the runtime notices, #1030). 6.0.9-26 pins emscripten-cache 6.0.9-4, which fails it:

  ```text
  FAIL AssertionError [ERR_ASSERTION]: THIRD-PARTY-NOTICES.md lacks: musl, LLVM libcxx, LLVM libcxxabi, LLVM libunwind, LLVM compiler-rt, dlmalloc, Emscripten (homescoop#1030)
  ```

  (its libc members are not name-ordered either). 6.0.9-27 pins 6.0.9-6, which passes.
- **#840.** AUTHORS and SECURITY.md have shipped since the first real build (6.0.9-20), and row 4 (every file LICENSE cites is in the tarball) passes on 6.0.9-27; the published 6.0.9-19 fails it.
- **source.tree (#1295).** The recipe pins the emscripten 6.0.9 commit's tree, `d3967f07…`, and its line leaves `scripts/source-tree-allowlist.txt`. emscripten-cache, which takes the same archive, keeps its line until its own next build.

## 6.0.9-28: realpath() at 40 symlink follows (homescoop#1631; 2026-10-22)

`test/files.test.mjs` fails its new row on the published 6.0.9-27 (the other nine pass):

```text
not ok 10 - realpath() follows 40 symlinks, as glibc does: the default link adds slicc_realpath.o, musl realpath.c with the <= bound (homescoop#1631, package patches 0016 and libc/0017)
  AssertionError [ERR_ASSERTION]: musl's realpath.c stops at 39 symlink follows
```

6.0.9-27's 0014 fixed `FS.lookupPath`, so `open()` and `stat()` of a 40-follow chain work, but `realpath(3)` is musl's `src/misc/realpath.c` in emscripten-cache's `libc.a`, which stops at `if (++cnt == SYMLOOP_MAX)`, after 39 follows. Package libc patch 0017 makes it `cnt++ == SYMLOOP_MAX`, and build.sh compiles that file with libc's flags into `lib/slicc/slicc_realpath.o`, which package patch 0016 adds to the default link. An object on the link line keeps `libc.a`'s `realpath` member out, so emscripten-cache is unchanged.

build.sh's PRESTAGE `symloop.c` builds 40- and 41-follow chains, absolute (`/a40/l0 -> /a40/l1 …`) and relative (`l0 -> l1 …`, opened as `r40/l0`), and prints open, stat and realpath for each:

```text
abs40 open ok stat ok realpath ok
abs41 open ELOOP stat ELOOP realpath ELOOP
rel40 open ok stat ok realpath ok
rel41 open ELOOP stat ELOOP realpath ELOOP
```

The same program linked with a `lib/slicc` without `slicc_realpath.o` (6.0.9-27's defaults; the host tree's `libc.a` is upstream musl, as emscripten-cache ships) must print `abs40 open ok stat ok realpath ELOOP`, and PRESTAGE fails if it doesn't, so the row keeps testing the override.

## 6.0.9-29: a program's own realpath wins again (homescoop#1664; 2026-10-22)

6.0.9-28 put `lib/slicc/slicc_realpath.o`, a strong `realpath`, on every default link as a plain object. A program that defines its own `realpath` then failed to link:

```text
wasm-ld: error: duplicate symbol: realpath
>>> defined in …/own-rp.o
>>> defined in …/lib/slicc/slicc_realpath.o
```

6.0.9-29 ships the same object as the one member of `lib/slicc/libslicc_realpath.a`, and package patch 0016 adds the archive after the program's inputs and before `libc.a`. The linker pulls it only while `realpath` is still undefined, so a program's own definition wins, as it did with `libc.a` before 6.0.9-28, and a program that calls libc's `realpath` still gets the 40-follow bound (#1631).

`test/files.test.mjs` fails two rows on the published 6.0.9-28 (the other nine pass):

```text
not ok 10 - realpath() follows 40 symlinks … the default link adds lib/slicc/libslicc_realpath.a …
  AssertionError [ERR_ASSERTION]: the tarball lacks package/lib/slicc/libslicc_realpath.a
not ok 11 - a program's own realpath wins: no object the default link always adds defines realpath … (homescoop#1664, package patch 0016)
  AssertionError [ERR_ASSERTION]: the default link always adds slicc_realpath.o, which defines realpath, so a program that defines realpath gets duplicate symbol: realpath
```

Row 11 reads the wasm `linking` section of every object in `tools/link.py`'s default-link tuple and fails if one defines `realpath`. build.sh's PRESTAGE links and runs the cases:

- (a) `own-rp.c` defines `realpath` and calls it: it links with the default link and prints `realpath /own`;
- (b) `symloop.c` calls libc's `realpath`: 40 follows resolve and 41 are `ELOOP`, absolute and relative, and without the archive it is `ELOOP` at 40;
- (c) `rp-caller.c` calls `realpath`, and the definition comes from a later object (`rp-def.o`), an archive (`librpdef.a`) or `-L… -lrpdef`: each links and prints `realpath /own`;
- NEGATIVE: `own-rp.c` linked beside `slicc_realpath.o` as a plain object (6.0.9-28's link line) must fail with `duplicate symbol: realpath`, so the rows keep testing #1664.

## 6.0.9-30: -sMAIN_MODULE=1 with the slicc defaults, and a program's own tcsetpgrp (homescoop#1678; 2026-10-22)

`-sMAIN_MODULE=1` (and `-sLINKABLE=1`) wraps the whole link line in `--whole-archive`, so all of `libc.a` is linked. With 6.0.9-29's defaults the link fails: the plain objects are not `-fPIC` (`relocation R_WASM_MEMORY_ADDR_SLEB cannot be used against symbol slicc_fork_tty_sig; recompile with -fPIC`), and 15 of their definitions are libc's own, all reported as duplicates:

```text
wasm-ld: error: duplicate symbol: kill            (slicc_signals.o)
wasm-ld: error: duplicate symbol: nanosleep       (slicc_libc_gaps.o)
wasm-ld: error: duplicate symbol: poll            (slicc_select.o)
wasm-ld: error: duplicate symbol: pselect         (slicc_select.o)
wasm-ld: error: duplicate symbol: realpath        (libslicc_realpath.a)
wasm-ld: error: duplicate symbol: setegid, seteuid, setgid, setregid, setresgid, setresuid, setreuid, setuid   (slicc_libc_gaps.o)
wasm-ld: error: duplicate symbol: tcgetpgrp, tcsetpgrp   (slicc_jobs.o)
```

The issue named only `tcsetpgrp`; a host link with `-Wl,--error-limit=0` shows all 15. A normal link has a smaller form of the same fault: `slicc_jobs.o` is always linked, so a program that defines its own `tcsetpgrp` gets `duplicate symbol: tcsetpgrp`, as `realpath` did before 6.0.9-29.

6.0.9-30 compiles `slicc_jobs.o` without `tcgetpgrp`/`tcsetpgrp` and ships them as the two members of `lib/slicc/libslicc_jobs.a`, pulled only while undefined. Package patch 0018 adds that archive beside `libslicc_realpath.a`, and for `-sMAIN_MODULE=1` and `-sLINKABLE` links takes `lib/slicc/linkable/*.o` (`-fPIC`, with the 14 that are not `realpath` renamed out) and leaves both archives out. libc's `tcsetpgrp` can't replace the shim: emscripten's `TIOCSPGRP` ioctl is `EINVAL` on every terminal.

`test/files.test.mjs` fails three rows on the published 6.0.9-29 (the other ten pass):

```text
not ok 10 - realpath() follows 40 symlinks … the default link adds lib/slicc/libslicc_realpath.a …
  AssertionError [ERR_ASSERTION]: tools/link.py's default link does not add lib/slicc/libslicc_realpath.a
not ok 12 - a program's own tcgetpgrp and tcsetpgrp win: no object the default link always adds defines them … (homescoop#1678, package patch 0018)
  AssertionError [ERR_ASSERTION]: the default link always adds slicc_jobs.o (tcgetpgrp), slicc_jobs.o (tcsetpgrp), so a program that defines it gets duplicate symbol
not ok 13 - -sMAIN_MODULE=1 and -sLINKABLE links take lib/slicc/linkable … (homescoop#1678, package patch 0018)
  AssertionError [ERR_ASSERTION]: tools/link.py does not tell -sMAIN_MODULE=1 and -sLINKABLE links apart
```

Row 10 now matches 0018's archive loop, which -29's `tools/link.py` lacks: -29 adds `libslicc_realpath.a` to `-sMAIN_MODULE=1` links too. build.sh's PRESTAGE links and runs:

- `jobs.c` with the default link: `hello realpath /tmp uname 0` and `tcgetpgrp self tcsetpgrp 0 ok` (the shim's single-process answers under host node); without `libslicc_jobs.a` it is libc's `tcgetpgrp 0 tcsetpgrp -1 EINVAL`, so the row keeps testing the override;
- `own-tc.c`, which defines its own `tcsetpgrp` and calls `tcgetpgrp`: it links and prints `own tcsetpgrp 7 tcgetpgrp self`;
- `jobs.c` with `-sMAIN_MODULE=1` and with `-sLINKABLE=1`: both link and print `hello realpath /tmp uname 0` and libc's `tcgetpgrp 0 tcsetpgrp -1 EINVAL`, and both wasm export `lib/slicc/linkable`'s `slicc_linkable_kill` (`--export-dynamic`). The default link's `jobs.wasm` must not have that name, and it prints `tcgetpgrp self`, so an ignored `-sLINKABLE=1` fails the row (Grok review of #1696);
- NEGATIVE: with 6.0.9-29's `lib/slicc` (the plain `slicc_jobs.o`, no `linkable/`, no `libslicc_jobs.a`), `own-tc.c` gives `duplicate symbol: tcsetpgrp`, the `-sMAIN_MODULE=1` link fails with `duplicate symbol:`, and the `-sLINKABLE=1` link fails with `duplicate symbol: tcsetpgrp`.

## 6.0.9-31: pic libraries in the pinned cache, and the other 12 overrides as archive members (homescoop#1699, #1724; 2026-10-22)

**#1699, `-sMAIN_MODULE=1` from a read-only install.** A `-sMAIN_MODULE` link takes its system libraries from `sysroot/lib/wasm32-emscripten/pic`. The pinned emscripten-cache 6.0.9-6 has no `pic/`, and `em-ensure-cache` makes `$EM_CACHE/sysroot` a symlink into that package, so emcc (with the package's own `FROZEN_CACHE = False`) tries to build them inside the read-only package. `test/main-module.mjs --expect old` against the published 6.0.9-30 is a `ci` row:

```text
== @ai-ecoverse/wasm-emscripten@6.0.9-30 with its pinned emscripten-cache 6.0.9-6 (@ai-ecoverse/emscripten-cache@6.0.9-6), installed read-only, expect old
   -sMAIN_MODULE=1 rc=1: PermissionError: [Errno 13] Permission denied: '…/home/.cache/emscripten/sysroot/lib/wasm32-emscripten/pic'
PASS negative: … has no sysroot/lib/wasm32-emscripten/pic, so -sMAIN_MODULE=1 tries to build pic libraries into the read-only package
```

6.0.9-31 pins emscripten-cache 6.0.9-7, which ships every library of its `libs.txt` built `--pic` as well. With it, `main-module.mjs` passes: the default hello, a `-sMAIN_MODULE=1` hello, and a `-sMAIN_MODULE=1` program that dlopens a `-sSIDE_MODULE` (`side 42`) link with the slicc defaults and run. The cache stays read-only, and nothing is built.

**#1724, a program's own `kill`, `poll`, `pselect`, `nanosleep` or `set*id`.** On 6.0.9-30 these 12 are strong definitions in `slicc_signals.o`, `slicc_select.o` and `slicc_libc_gaps.o`, which every default link adds. `test/files.test.mjs` row 14 fails on the published 6.0.9-30:

```text
not ok 14 - a program's own kill, poll, pselect, nanosleep and set*id win: … (homescoop#1724, package patch 0019)
  AssertionError [ERR_ASSERTION]: the default link always adds slicc_signals.o (kill), slicc_select.o (pselect), slicc_select.o (poll), slicc_libc_gaps.o (nanosleep), slicc_libc_gaps.o (setresuid), slicc_libc_gaps.o (setresgid), slicc_libc_gaps.o (seteuid), slicc_libc_gaps.o (setegid), slicc_libc_gaps.o (setuid), slicc_libc_gaps.o (setgid), slicc_libc_gaps.o (setreuid), slicc_libc_gaps.o (setregid), so a program that defines it gets duplicate symbol
```

Rows 10, 12 and 13 also fail on 6.0.9-30, because they match 0019's archive tuple. All 14 rows pass on 6.0.9-31.

PRESTAGE's `own-libc.c` calls all 12, with a `--pre-js` stand-in kernel (`select` answers 42, `kill` and `setcred` 0). For each one it prints whether the slicc version answered, libc's, or the program's own (77):

- default link: `slicc` for all 12. Without the three new archives, it's `libc` for all 12, so each row tells the versions apart;
- `-DOWN_<name>` for each of the 12 (the program's own definition): links, `own` for that one and `slicc` for the other 11;
- `poll` and `nanosleep` in the program's own `-l` archive: `own` for those two, `slicc` for the rest;
- NEGATIVE: with 6.0.9-30's plain objects, each `-DOWN_<name>` link fails with `wasm-ld: error: duplicate symbol: <name>`, all 12 of them. The published 6.0.9-30 `lib/slicc` gives the same result by hand (`-DOWN_poll`: `duplicate symbol: poll`, `-DOWN_setuid`: `duplicate symbol: setuid`).
