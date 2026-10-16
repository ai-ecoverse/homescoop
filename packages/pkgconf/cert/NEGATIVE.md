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
--soft --spec cli.mjs` (slicc-kernel 1.94.0, users enforce, the published
tarball from npm): 74 cases pass (every 2.5.1 output the spec pins is
unchanged in 3.0.9), and the spec fails on the five pkgconf 3 cases:

| line | check | 2.5.1-1 |
| --- | --- | --- |
| 172 | `--variable=prefix zlib libpng16` → `/opt/wasm /opt/wasm` | `/opt/wasm` (first module only) |
| 173 | `PKG_CONFIG_ZLIB_PREFIX=/env --variable=prefix zlib` → `/env` | `/opt/wasm` (no per-module override) |
| 174 | `--newlines --cflags --libs zlib` | exit 1, `pkgconf: unknown option -- newlines` |
| 175 | `--cflags conflict zlib` fails on `Conflicts: zlib < 2` | exit 0, prints `-I/opt/wasm/include` |

Without `--soft` the run stops at line 172 (`+ '/opt/wasm' - '/opt/wasm /opt/wasm'`).
