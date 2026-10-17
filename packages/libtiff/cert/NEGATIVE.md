# Negative proof (wasm-libtiff)

**Date:** 2026-10-17, for 4.7.2-3, the package's first cert (homescoop#426). This is `node scripts/em-lib-cert.mjs libtiff`, using emsdk 4.0.23 on darwin-arm64.

4.7.2-3 is a CI rebuild of the same pinned source. Its only change is the build input, now wasm-zlib 1.3.1-4 (it was the unattested 1.3.1-2, homescoop#864). libjpeg-turbo moves from 3.1.2-3 to the latest, 3.1.2-4; both have provenance. The library code doesn't change, so the published 4.7.2-2 passes the spec too, and the negative is a planted defect.

## A broken .pc

The build's tarball, with `lib/pkgconfig/libtiff-4.pc` changed so that its `Requires: zlib libjpeg` is emptied, fails the cert. A consumer that builds from the `.pc` alone can't build:

```text
fatal error: 'zlib.h' file not found
```

## The spec isn't vacuous

`test/probe.c` is compiled from the `.pc` flags alone and linked with `-Wl,--fatal-warnings`. It runs real work through the library and checks the results; see the checklist in `meta.json`. `test/check.mjs` then reads the file the probe wrote, independently in Node, and checks it.
