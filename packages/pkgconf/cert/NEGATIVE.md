# Negative proof (pkgconf)

**Date:** 2026-10-07, updated 2026-10-16 for pkgconf 3.0.9-1
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package pkgconf` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/pc.mjs` requires `--modversion homescoop-cert` → `9.9.9` from a staged
`.pc`, and a missing package must exit non-zero.

`cert/cli.mjs` stages a `.pc` set shaped like the wasix/emscripten dev
packages (zlib, libpng16 with `Requires.private`, OpenSSL's `openssl`,
`libssl`, `libcrypto`, a relocatable `.pc` on `${pcfiledir}`) and checks the
exact output of `--modversion`, `--exists` with constraints, `--cflags`,
`--libs`, `--static`, `--*-only-*`, `--variable`, `--define-variable` and
`PKG_CONFIG_SYSROOT_DIR`, through `pkg-config` and `pkgconf`. Its first
check is that `--version` prints the manifest's `homescoop.upstream`.

## The old version: `@ai-ecoverse/wasm-pkgconf@2.5.1-1`

`run.mjs --package pkgconf --tarball ai-ecoverse-wasm-pkgconf-2.5.1-1.tgz
--users enforce --soft --spec cli.mjs` (slicc-kernel 1.94.0, the published
tarball from npm): 74 cases pass (every 2.5.1 output the spec pins is
unchanged in 3.0.9), and the spec fails on the four pkgconf 3 checks (five cases):

| line | check | 2.5.1-1 |
| --- | --- | --- |
| 173 | `--variable=prefix zlib libpng16` → `/opt/wasm /opt/wasm` | `/opt/wasm` (first module only) |
| 174 | `PKG_CONFIG_ZLIB_PREFIX=/env --variable=prefix zlib` → `/env` | `/opt/wasm` (no per-module override) |
| 175 | `--newlines --cflags --libs zlib` | exit 1, `pkgconf: unknown option -- newlines` |
| 176 | `--cflags conflict zlib` fails on `Conflicts: zlib < 2` | exit 0, prints `-I/opt/wasm/include` |

Line 175 fails twice (the exit status and the output). Line 177,
`PKG_CONFIG_IGNORE_CONFLICTS=1`, is the escape hatch and passes on 2.5.1-1
too. Without `--soft` the run stops at line 173
(`+ '/opt/wasm' - '/opt/wasm /opt/wasm'`).

## Traversal depth (homescoop#532, 3.0.9-2; 2026-10-16)

`run.mjs --package pkgconf --spec depth.mjs --kernel @ai-ecoverse/slicc-kernel@1.108.4` with the published `@ai-ecoverse/wasm-pkgconf@2.5.1-1`: FAIL, `pkg-config --libs d0: the default traversal depth is 256 levels: -ld257 -ld258 -ld259 (260 flags)`, because 2.5.1 follows the whole chain. The published 3.0.9-1 passes, and so does 3.0.9-2, which has the same bytes and adds the README note. The spec pins upstream's behaviour; it isn't patched.
