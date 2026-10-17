# Negative proof (wasm-zlib)

**Date:** 2026-10-17, for 1.3.1-4, the package's first cert (homescoop#426). This is `node packages/zlib/test/run-zlib.mjs` with emsdk 4.0.23 on darwin-arm64.

1.3.1-4 is a CI build of the same pinned source. It exists so the library has provenance (homescoop#864), because 1.3.1-2 and -3 were published without any. A local build of this recipe is byte-identical to the published 1.3.1-3, so -3 passes the spec too. The negative is therefore a planted defect.

## Unconfigured zconf.h

The build's tarball, with `include/zconf.h` swapped for upstream's pristine one (the `HAVE_UNISTD_H` / `HAVE_STDARG_H` lines that `./configure` sets to `#if 1` put back), fails to link:

```text
wasm-ld: error: function signature mismatch: adler32_combine
wasm-ld: error: function signature mismatch: gztell
wasm-ld: error: function signature mismatch: gzoffset
wasm-ld: error: function signature mismatch: gzseek
wasm-ld: error: function signature mismatch: crc32_combine
```

A consumer's `z_off_t` would be `long` (4 bytes) while `libz.a` was built with the 8-byte `off_t`. Without `--fatal-warnings`, wasm-ld links trapping stubs. This is the 1.3.1-1 defect of wasix-zlib.

## The spec isn't vacuous

The probe compiles from the `.pc` flags alone. It checks the known CRC-32 and Adler-32 vectors and their `_combine`, a 64 KiB compress2/uncompress round trip, and a gzip file written, read and seeked through `gz*`. Node's own zlib must then inflate that file to the same bytes.
