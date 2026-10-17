# Negative proof (wasm-freetype)

## 2.13.3-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs freetype` (host-run's #908 check) fails on the published 2.13.3-3: 1 file(s) ship 2,498,332 bytes of DWARF.

The published 2.13.3-3 also has 84 occurrence(s) of the CI build directory `/tmp/homescoop-work` in lib/libfreetype.a (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

2.13.3-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 2.13.3-3 too; the negative is the #908 check.

`cert/` is new (homescoop#426). The published 2.13.3-3 passes `em-lib-cert.mjs freetype` too, because the library code is the same; the negative is the #908 check above.
