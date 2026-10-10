# Negative proof (wasix-zlib)

**Date:** 2026-10-10 (1.3.1-2)
New package, so it needs human cert first.

`node scripts/wasix-lib-cert.mjs wasix-zlib --tarball <tgz>` on slicc-kernel
1.35.1's Node entry. The good tarball passes, with both `zprobe` (static-main,
`lib/`) and `zprobe-pic` (dynamic-main, `lib-pic/`).

## Unconfigured zconf.h (the 1.3.1-1 defect)

1.3.1-1 shipped upstream's pristine `zconf.h` while `libz.a` was compiled
with `-D_LARGEFILE64_SOURCE=1`: the library's `z_off_t` was 64-bit `off_t`,
a consumer's `long`. wasm-ld only warned and linked trapping stubs
(`crc32_combine` → `wasm trap: unreachable`). 1.3.1-2 configures `zconf.h`
as zlib's `./configure` does, compiles with it and ships it. The cert now
compiles probes with nothing but the `.pc` flags and links with
`-Wl,--fatal-warnings`; the -2 tarball with the pristine `zconf.h` put back:

```text
wasm-ld: error: function signature mismatch: adler32_combine
wasm-ld: error: function signature mismatch: gztell
wasm-ld: error: function signature mismatch: gzoffset
wasm-ld: error: function signature mismatch: gzseek
```

## A flavour missing an object

The same tarball with `inflate.o` deleted from `lib-pic/libz.a`: the PIC
probe does not link.

```text
wasm-ld: error: …/package/lib-pic/libz.a(uncompr.o): undefined symbol: inflateInit_
wasm-ld: error: …/package/lib-pic/libz.a(uncompr.o): undefined symbol: inflate
wasm-ld: error: …/package/lib-pic/libz.a(uncompr.o): undefined symbol: inflateEnd
```

## Empty probe

A 0-byte `zprobe.wasm` fails at `WebAssembly.compile` (`BufferSource
argument is empty`), as with every package's empty-wasm check.
