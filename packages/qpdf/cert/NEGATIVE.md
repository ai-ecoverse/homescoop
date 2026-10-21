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
