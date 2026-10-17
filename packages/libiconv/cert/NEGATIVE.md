# Negative proof (wasm-libiconv)

## 1.19.0-3: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs libiconv` (host-run's #908 check) fails on the published 1.19.0-2: 2 file(s) ship 264,543 bytes of DWARF.

The published 1.19.0-2 also has 5 occurrence(s) of the CI build directory `/tmp/homescoop-work` in lib/libcharset.a, lib/libiconv.a (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

1.19.0-3 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 1.19.0-2 too; the negative is the #908 check.

`cert/` is new (homescoop#426). The published 1.19.0-2 passes `em-lib-cert.mjs libiconv` too, because the library code is the same; the negative is the #908 check above.
