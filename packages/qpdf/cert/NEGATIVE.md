# Negative proof (qpdf)

**Date:** 2026-10-09
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/qpdf.wasm` truncated to 0 bytes, the checklist fails at the first
`qpdf` run (slicc-kernel 1.23.0, Node entry):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Spec non-vacuous

`cert/checklist.mjs` compares page texts in order after merge, ranges, split
and decrypt, reads `/Rotate` back per page from `--json`, checks exact exit
codes for the encryption queries, both password failures and the corrupt
inputs (2 for garbage and a missing file, 3 for a truncated PDF), and asserts
that the hand-edited QDF file draws warnings before `fix-qdf` and none after.

## The slicc shims and credentials (12.4.2-1, #459, #625)

`12.4.2-1`'s `bin/qpdf.wasm` exports none of the slicc shims' symbols. CMake's Release type adds `-O3` to the link, and `emcc -O3` drops their `EMSCRIPTEN_KEEPALIVE` exports. On main, host-run's `check-slicc-cred.mjs` therefore refused to build qpdf: `bin/qpdf.wasm`, `fix-qdf.wasm` and `zlib-flate.wasm` lacked the slicc credential library. 12.4.2-2 builds with `CMAKE_C_FLAGS_RELEASE` and `CMAKE_CXX_FLAGS_RELEASE` set to `-DNDEBUG`, so it compiles and links at `-O2`. Its wasm exports `slicc_sig_mask` and `slicc_cred_euid`, and imports `slicc_cred_js`.

## users.mjs (users enforce, #723)

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.

- `prove-negative.mjs --package qpdf --spec users.mjs --users enforce` → FAIL
  (`WebAssembly.compile(): BufferSource argument is empty`).
- The npm build without the credential library (curl 8.22.0-4, qpdf
  12.4.2-1) passes users.mjs on 1.102.6 too: the kernel refuses the opens
  and stamps the creator's ids itself. The spec guards the behaviour as a
  non-root user; host-run's `check-slicc-cred.mjs` guards the link. That
  build fails glue-by-path (0644 glue, `EACCES`).

## 12.4.2-3: attested build inputs (homescoop#864; 2026-10-17)

12.4.2-3 changes only the build inputs: wasm-zlib 1.3.1-4 (was the unattested 1.3.1-2) and wasm-libjpeg-turbo 3.1.2-4 (was 3.1.2-1, the latest is used now). The cert kernel is 1.110.1 (certified), and the coreutils pin is 9.12.0-9. The qpdf code is unchanged, so the published 12.4.2-2 passes these specs too, and the negatives above still stand. This build passes `checklist.mjs`, `users.mjs` and glue by path on 1.110.1 under users enforce.

## 12.4.2-4: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

12.4.2-4 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 12.4.2-3 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 12.4.2-3 as well. The build also gets #908's prefix maps and DWARF strip.

## 12.4.2-5: the shim's posix_spawnp searches PATH (slicc-kernel#1165, homescoop#1264; 2026-10-19)

12.4.2-5 links the updated `shims/slicc/slicc_spawn.c`. `posix_spawnp` was plain `posix_spawn`; it now searches PATH as execvp does. A candidate that isn't an executable regular file is skipped, and a bare name that isn't found anywhere still goes to the kernel catalog. On #1264, npm-parity found that the build differs from the published 12.4.2-4 in bin/qpdf.wasm, so this is a packaging bump. The package's own code is unchanged. The behaviour test is coreutils' `cert/spawnp-path.mjs` (`timeout`, the shim's one Emscripten caller that a cert drives).

## 12.4.2-6: no pkg-config in the qpdf configure; the 14-byte qpdf.wasm drift explained (homescoop#1354, #804; 2026-10-20)

**pkg-config:** `Emscripten.cmake` resets `PKG_CONFIG_LIBDIR` to the emsdk sysroot, so build.sh's `PKG_CONFIG_LIBDIR=/nonexistent` never took effect. On a machine whose emsdk cache holds the zlib port (`sysroot/lib/pkgconfig/zlib.pc`, `Libs: -sUSE_ZLIB`, left by any earlier `-sUSE_ZLIB` build), qpdf's `pkg_check_modules(pc_zlib zlib)` wins. CMake drops the `-s` flag, so the link has no zlib at all. Demonstrated on 12.4.2-5's build.sh, macOS, emsdk 4.0.23: `wasm-ld: error: ../libqpdf/libqpdf.a(Pl_Flate.cc.o): undefined symbol: deflateEnd` (and the rest of zlib). CI passed only because its cache had no zlib port yet. 12.4.2-6 configures with `-DPKG_CONFIG_EXECUTABLE=/usr/bin/false` ("Could NOT find PkgConfig"), so the `ZLIB_*_PATH`/`LIBJPEG_*_PATH` fallbacks always apply. The local build is byte-identical to CI run 39362590633's (qpdf.wasm `23edb8c6…`, fix-qdf.wasm `6bcd5302…`, zlib-flate.wasm `67ee9bc6…`).

**The qpdf.wasm drift (#1354, #804):** the difference is in LLVM, not qpdf or the runner. Compiling `libqpdf/QPDF.cc` to LLVM IR gives the same bytes every time (4 of 4). Compiling that same `.ll` to an object with emsdk 4.0.23's clang (5243501cca02) gives one of two objects (6 runs: 3 and 3; 8 runs: 3 and 5). With `-print-after-all -filter-print-funcs=_ZN4QPDF3Doc7Objects7Foreign6Copier15reserve_objectsERK16QPDFObjectHandleb`, the first pass whose output differs is `WebAssembly CFG Stackify`, and its input is identical. There, `fixCallUnwindMismatches` walks `UnwindDestToTryRanges`, a pointer-keyed `DenseMap`. Two adjacent call ranges that unwind to different pads (catch2360, catch2364) get their `try`/`delegate` markers nested in heap-address order, which gives #1354's `try try … delegate 8 … delegate 3` vs `try … delegate 7 try … delegate 3`. LLVM fixed it in fd76c9bdf103 ("[WebAssembly] Fix nondeterminism by using MapVector for pointer-keyed maps", llvm-project#205184, 2026-06-27). The first emsdk with it is 6.0.2 (6.0.1's LLVM 05d84fd3f9 is behind it). So qpdf.wasm can't be reproducible on the 4.0.23 pin. 12.4.2-6 doesn't claim it is.

## 12.4.2-7: shim drift (homescoop#1491; 2026-10-21)

12.4.2-7 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 12.4.2-6 in `bin/fix-qdf`, `bin/qpdf` and `bin/zlib-flate`, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## 12.4.2-8: off the reproducible-pending list; foreign-page, manifest and link-gate coverage (homescoop#1354 C2, #808, #918; 2026-10-22)

**Reproducible (#1354 C2, #808):** qpdf is off `scripts/reproducible-pending.json`, so ladder-pr's `reproducible` job builds qpdf twice and compares the tarballs. A later 14-byte CFGStackify flip (emsdk 4.0.23) fails that job and is reported on #1354; qpdf is never re-listed. `scripts/test/reproducible-optin.test.mjs`'s new qpdf test fails on main before this change (`qpdf is still in scripts/reproducible-pending.json`: 0 pass, 1 fail).

**cert/manifest.mjs (#918):** the published 12.4.2-5 fails it on slicc-kernel 1.110.1, users enforce (`fix-qdf is a helper command`: `undefined` vs `true`). 12.4.2-7 passes it.

**cert/foreign.mjs (#918):** the foreign-page copier: interleaved and repeated `--pages` (one copied font per source file), a dangling reference, a damaged, a garbage and a missing source (rc 3, 2, 2, no trap), and `/FlateDecode` output from qpdf.wasm. The published 12.4.2-7 passes it, since qpdf's code is unchanged; with every wasm emptied, `prove-negative.mjs --spec foreign.mjs` fails (`WebAssembly.compile(): BufferSource argument is empty`).

**build.sh's qpdf-deps gate (#918, #1354):** after configure, build.sh fails unless `CMakeCache.txt` has no `pc_zlib_FOUND`/`pc_libjpeg_FOUND` set to 1 and each program's `linkLibs.rsp` names `$PREFIX/lib/libz.a` and `$PREFIX/lib/libjpeg.a`; it prints `qpdf-deps: PASS …`. Checked on macOS, emsdk 4.0.23, whose cache has the zlib port's `zlib.pc`: the 12.4.2-8 configure gives `qpdf-deps: PASS`. 12.4.2-5's configure (no `-DPKG_CONFIG_EXECUTABLE=/usr/bin/false`) logs `Found PkgConfig` and `Found zlib, version 1.3.1`, sets `pc_zlib_FOUND:INTERNAL=1`, and its qpdf `linkLibs.rsp` has libjpeg.a but no libz.a. The gate fails it: `qpdf-deps: FAIL pkg-config found pc_zlib_FOUND:INTERNAL=1`.

## 12.4.2-9: qpdf.wasm is reproducible on the emscripten 6.0.9 tree (homescoop#1354; 2026-10-23)

**The cause, shown again on 12.4.2-8's toolchain:** with 12.4.2-8's configure (emsdk 4.0.23, macOS arm64), compiling `libqpdf/QPDF.cc` 32 times with the same command line gave two objects: 15 × `1dab302e…` and 17 × `9d20f69d…`, 19 bytes apart. `llvm-objdump -d` shows the same flip as the CI builds on #1354: in one, the `try` at 0x4eb2 wraps `call 191` and ends at `delegate 8` inside the next pair; in the other, `call 191` ends at `delegate 7` and the second `try` starts after it, with the two `delegate 3` labels swapped. That is `fixCallUnwindMismatches` in WebAssembly CFG Stackify walking the pointer-keyed `DenseMap UnwindDestToTryRanges`, so the nesting follows heap addresses.

**The fix:** build.sh evaluates `scripts/emscripten-tree.sh` (the patched emscripten 6.0.9 tree on emsdk 6.0.9's prebuilt compilers, release f04ea239, whose clang reports llvm-project 510126255f89, 8,907 commits after the fix), applies wasm-emscripten's `0014-libfs-symloop.patch` (the 4.0.23 build had the same fix from `scripts/emsdk-patches/libfs-symloop.patch`), and puts the tree first on PATH, so the slicc shims, the configure, the compile and the link all use it. That LLVM contains llvm-project fd76c9bdf103, which makes the map a `MapVector` (insertion order), as it does for `EHPadToUnwindDest`, LateEHPrepare's `EHPadToRethrows` and LowerEmscriptenEHSjLj's `UnwindDestToNewPreds`. build.sh prints `qpdf-toolchain: PASS emscripten 6.0.9 …` and stops unless `emcc` is the tree's. The same `QPDF.cc` compile on the tree gave one object, 32 of 32 (`8759a074…`).

**Whole builds:** two clean local builds on macOS arm64 gave the same `package.tgz` (`29100f8c…`). One ran from the worktree with `-j4`; the other ran from a `git archive` copy in another directory, with its own WORK and `-j2`. CI run 39867965346 built the package twice on Linux, its host-build and rebuild from different directories, and both gave `package.tgz` `0a9a2567…` (`reproducible (qpdf)`: pass). Its unpacked tree matches the local one file for file: `qpdf.wasm` `377b7e3c…`, `fix-qdf.wasm` `c0dfeb0a…`, `zlib-flate.wasm` `8ac2c301…`. The cert passed on that build (slicc-kernel 1.110.1, `cert-run: PASS qpdf`).

**The qpdf-deps gate:** 6.0.9's `Emscripten.cmake` uses link response files on Windows hosts only, so CMake writes the libraries into each program's `link.txt` and there is no `linkLibs.rsp` (the first CI run of this change stopped at `qpdf-deps: FAIL no …/qpdf.dir/linkLibs.rsp`). The gate now reads `link.txt` and, where it exists, `linkLibs.rsp`, and still fails unless they name `$PREFIX/lib/libz.a` and `$PREFIX/lib/libjpeg.a`.

**The test:** `scripts/test/qpdf-toolchain.test.mjs` fails on main (0 pass, 2 fail: `qpdf/build.sh does not build with scripts/emscripten-tree.sh`, and qpdf has no `scripts/emscripten-tree.sh` input), and passes here.

## 12.4.2-10: upstream NOTICE.md and the sphlib and MD5 notices (homescoop#1750; 2026-10-23)

**The defect:** build.sh passed `LICENSE.txt` and `NOTICE.md` to `homescoop_stage_license`, which copies only the first candidate that exists to `package/LICENSE`. So 12.4.2-8 and 12.4.2-9 shipped qpdf's Apache-2.0 `LICENSE.txt` and no `NOTICE.md`. Upstream's `NOTICE.md` carries the Projet RNRT SAPHIR copyright and MIT permission notice of the sphlib 3.0 SHA-2 code that libqpdf compiles in (`libqpdf/sha2.c`, `sha2big.c`, `sph/`), and `sha2.c`'s licence asks for that notice in all copies. `libqpdf/MD5_native.cc` keeps RSA Data Security's MD5 notice, which says "These notices must be retained in any copies of any part of this documentation and/or software." Neither tarball's `THIRD-PARTY-NOTICES.md` had either notice.

**The fix:** build.sh stages `LICENSE.txt` alone, copies `NOTICE.md` into the package (`files[]` lists it), and adds two `THIRD-PARTY-NOTICES.md` sections taken from the pinned source: `sha2.c`'s `(LICENSE BEGIN)` … `(LICENSE END)` block and `MD5_native.cc`'s RSA block. It prints `qpdf-notices: PASS …` and stops unless `NOTICE.md` names Projet RNRT SAPHIR with the permission sentence and both extracted blocks are complete. `scripts/build-common.sh` is unchanged.

**cert/licence.mjs against the published @ai-ecoverse/wasm-qpdf@12.4.2-9** (`run.mjs --package qpdf --tarball ai-ecoverse-wasm-qpdf-12.4.2-9.tgz --spec licence.mjs --kernel @ai-ecoverse/slicc-kernel@1.110.1 --users enforce`): `cert-run: FAIL qpdf fail`, at `package.json files[] lists NOTICE.md: ["README.md","LICENSE","THIRD-PARTY-NOTICES.md","bin"]`. `licenceFileErrors` on the unpacked 12.4.2-9 tarball gives `NOTICE.md is not in the package` and `THIRD-PARTY-NOTICES.md lacks` `sphlib 3.0 SHA-2`, `Copyright (c) 2007-2010 Projet RNRT SAPHIR`, `Copyright (C) 1991-2, RSA Data Security, Inc. Created 1991.` and the MD5 retention sentence. The 12.4.2-10 staging (the new build.sh lines run on the pinned qpdf-12.4.2.tar.gz, sha256 `8a58af5b…`) gives none.
