# Negative proof (wasix-f2c)

## 3.2.1-1: an f2c on PATH wins over the pinned one (3.2.1-2, #1197; 2026-10-20)

`test/f2c-path.sh` on npm 3.2.1-1: FAIL, `gfortran -c failed` (bin/gfortran ran the failing fake `f2c` first on PATH). 3.2.1-2: PASS, the pinned hoodmane/f2c built by bin/build-f2c.sh translates.

## 3.2.1-1: a new build input (homescoop A6, 2026-10-18)

There's no earlier wasix-f2c. These are the cases the spec and build.sh refuse, run locally on macOS (wasixcc 0.4.7, wasix-sysroot -38, slicc-kernel 1.124.2 Node entry).

- **An empty `lib/libf2c.a`:** bin/gfortran still translates test/fprobe.f, but the link fails with undefined `do_fio do_lio e_wsfe e_wsle main pow_di s_cmp s_copy s_wsfe s_wsle`. So the probe can't pass without libf2c's I/O, string and power routines, or its `main` (which calls f2c's `MAIN__`).
- **The libf2c symbol set:** build.sh refuses an archive that lacks `s_wsle e_wsle do_lio s_cat s_copy s_cmp pow_dd pow_di z_div i_len` and `main`. It also refuses one that defines `c_abs`/`z_abs`: patch 0005 leaves those to OpenBLAS, which defines them too, so scipy can link both archives.
- **arith.h:** build.sh compares the host's arithchk output with `arith-wasm32.h`, which is arithchk run on wasm32 (emscripten 6.0.9, node). They may differ only in the host's LP64 lines (`Long`, `Intcast`, `X64_bit_pointers`, which libf2c doesn't use) and its NaN lines. The first CI build (Linux x86_64) showed why arith.h can't be generated on the host: it printed no `NANCHECK` and `QNaN1 0xfff80000` (x86's default NaN), where wasm's is `0x7ff80000`. A host-generated arith.h, as py-scipy's build-libf2c.sh made it, would give libf2c x86's NaN. The rest (`IEEE_8087`, `Arith_Kind_ASL`, `Double_Align`) must agree.
- **meson's probes without gfortran:** build.sh runs `bin/gfortran --version`, `-dumpversion` and `-E -dM -` with no `REAL_GFORTRAN` and checks the GNU Fortran 13.2.0 answer and `__GFORTRAN__`/`__wasm32__`. Before this package, packages/py-scipy/tools/gfortran sent those to a host gfortran.
