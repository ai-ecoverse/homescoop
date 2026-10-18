# @ai-ecoverse/wasix-f2c

Fortran 77 for wasm32-wasix through [f2c](https://www.netlib.org/f2c/): a
**build input** (no slicc commands) that py-scipy compiles its Fortran with,
fetched by sha256. It follows Pyodide's scipy build.

- `lib/libf2c.a`: static and **PIC** (the ehpic tree's legacy wasm exceptions,
  as scipy's side modules), built from CLAPACK 3.2.1's `F2CLIBS/libf2c` with
  Pyodide's patches 0001–0007 on wasix-sysroot 2025.9.30-38. 0005 leaves
  `c_abs`/`z_abs` to OpenBLAS (`@ai-ecoverse/wasix-openblas`), so the two
  link together. `lib/pkgconfig/f2c.pc` has a relocatable prefix.
- `include/f2c.h`: the header f2c output is compiled against (hoodmane/f2c's).
- `share/f2c/src`: the f2c translator's source (hoodmane/f2c `caa9abc`, f2c
  20240504). It's a **host tool**, so `bin/build-f2c.sh [<out-dir>]` builds it
  with the host `cc` and prints its path. Without an out dir, it builds it
  once into `$WASIX_F2C_CACHE`, else `~/.cache/wasix-f2c/<version>`. One
  tarball serves every build host.
- `bin/gfortran`: a gfortran for meson and other build systems (Python 3).
  - **Fortran sources:** `.f`/`.F` are translated with `f2c -R` next to the
    source (`.F` through the C preprocessor first), then compiled with
    `$WASIX_CC` (default `wasixcc`) and `-I<package>/include`.
  - **Links:** link-only calls go to `$WASIX_CC`. An executable link from
    Fortran adds `libf2c.a`, as gfortran adds libgfortran.
  - **Identity probes:** meson's (`--version`, `-v`, `-dumpversion`,
    `-dumpfullversion`, `-E -dM -`) are answered as GNU Fortran 13.2.0 for
    wasm32, so no host gfortran is needed. Other queries without a source go
    to `$REAL_GFORTRAN` if set.
  - **Project fixes:** `$F2C_FIXES` can name a Python file with
    `fix_f2c_input(path)`, `fix_f2c_output(path)` and `fix_args(args)` hooks,
    for scipy's f2c fixes.
  - **Overrides:** `$F2C_PATH` sets the f2c to run, and `$F2C_INCLUDE` the
    directory for f2c.h.

libf2c and f2c are under the AT&T/Lucent/Bellcore notice (SMLNJ), and
`bin/gfortran` follows pyodide-build (MPL-2.0). See `LICENSE` and
`THIRD-PARTY-NOTICES.md`.
