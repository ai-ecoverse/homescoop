# Negative proof (wasix-zlib)

**Date:** 2026-10-10 (1.3.1-1)
New package, so it needs human cert first.

`node scripts/wasix-lib-cert.mjs wasix-zlib --tarball <tgz>` on slicc-kernel
1.35.1's Node entry. The good tarball passes, with both `zprobe` (static-main,
`lib/`) and `zprobe-pic` (dynamic-main, `lib-pic/`).

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
