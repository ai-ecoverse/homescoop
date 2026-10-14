# Negative proof (imagemagick-heif)

**Date:** 2026-10-13 (slicc-kernel 1.72.0), and again on 2026-10-14 against the build on top of wasm-imagemagick 7.1.2-32-4 (slicc-kernel 1.81.0, where the checklist passes).
This is a new package, so it needs human cert first and is not in `scripts/ci-certified.json`.

## Empty wasm

```
browser-cert: FAIL packages/imagemagick-heif/cert/checklist.mjs
Error: Error: WebAssembly.compile(): BufferSource argument is empty
prove-negative: ok — cert failed on bad imagemagick-heif tarball (status 1)
```

## The HEVC-free default

Running the checklist against the published `@ai-ecoverse/wasm-imagemagick`
7.1.2-32-3, the same ImageMagick built `--without-heic`, fails at the first
check:

```
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Delegates \(built-in\):.*\bheic\b/.
  'Delegates (built-in): jng jp2 jpeg lcms png tiff\n'
```

There are no patches. Each pixel case hashes the decoded samples and compares
them with host libheif 1.23.6, and the identify cases compare exact sizes,
orientations and EXIF fields. So a wrong pixel, a missed rotation or a lost
frame fails.

## umask

The umask case (`umask 027` → mode 640) passes on slicc-kernel 1.81.0 and on
1.72.0 alike (in both, a default umask gives 644, 027 gives 640, and 077
gives 600), so it is not a negative for the kernel pin. The pin to 1.81.0
(engines >= 1.78.0) follows the kernel umask fix for Emscripten-created
files that wasm-libheif's cert ran into.
