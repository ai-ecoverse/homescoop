# Negative proof (wasm-gmake)

## 4.4.1-7: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs gmake` (host-run's #908 check) fails on the published 4.4.1-6: 1 file(s) ship 943,004 bytes of DWARF.

The published 4.4.1-6 also has 2 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/make.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

4.4.1-7 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 4.4.1-6 too; the negative is the #908 check.

`cert/make.mjs` is new (homescoop#426). It passes on the published 4.4.1-6 and on this build, under users enforce on 1.110.1 (local run), so the negative is the #908 check above.
