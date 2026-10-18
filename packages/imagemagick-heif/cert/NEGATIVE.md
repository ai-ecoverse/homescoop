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

## Resource policy (7.1.2-33-1)

`policy.mjs` against the #315 artifact of `@ai-ecoverse/wasm-imagemagick-heif` 7.1.2-32-1 (sha256 6317432812945b4bf93edc1846850954507b6c23165348c3be5ad79e74d42ded), which ships upstream's open policy, fails at its
first check, before any large allocation (slicc-kernel 1.81.0, 2026-10-14):

```
browser-cert: FAIL packages/zzneg/cert/policy.mjs
AssertionError [ERR_ASSERTION]: default limits: Resource limits:
  Width: 8.38861MP
+   '8.38861MP',
+   '8.38861MP',
+   '8.58993GP',
+   '2GiB',
```

With that policy `magick -size 30000x30000 xc:white` would start allocating
a 900 MP pixel cache, which is what hung the tab. On 7.1.2-33-1 the same spec
refuses it in about 60 ms and the 81 MP canvas in about 50 ms.

## 7.1.2-34-1: disk pixel cache and in-place mogrify

Against the certified, unpublished 7.1.2-33-1 artifact of run 38603486003
(`host-imagemagick-heif-pr330`, sha256 `a7a78fd5230837b0cbe0adf290a111cb70dc29cfdba28fcd29a5fd59ec34ab84`), slicc-kernel 1.81.0, 2026-10-15:

- mogrify.mjs fails (homescoop#353, fixed upstream in 7.1.2-34):

  ```
  AssertionError [ERR_ASSERTION]: mogrify in place: rc 1 mogrify: no encode delegate for this image format `' @ warning/constitute.c/WriteImage/1473.
  ```

- The time-bound resize fails at the first 48 MP case (homescoop#356: with
  disk 512MiB the pixel cache went to the browser's storage). With the
  limits check removed, so that the bound is what fails:

  ```
  AssertionError [ERR_ASSERTION]: magick -size 8064x6048 gradient:red-blue -resize 50% -quality 85 photo-48-50.jpg: no result within 30 s (pixel cache on disk? homescoop#356)
  ```

  The full policy.mjs fails earlier, at its limits table (768MiB/512MiB/512MiB
  instead of 1.5GiB/256MiB/0B). On 7.1.2-34-1 the same 48 MP resize takes
  about 2.5 s, and 12 MP about 0.6 s.

## 7.1.2-34-2: panoramas, name section

Against the published `@ai-ecoverse/wasm-imagemagick-heif` 7.1.2-34-1 (npm
`latest`), slicc-kernel 1.81.0, `--users enforce`, 2026-10-16:

- policy.mjs (wasm-imagemagick's) fails at its limits table (`Width:
  16000P`). Its homescoop#445 case alone:

  ```
  identify -format: rc 1 "" identify: width or height exceeds limit `pano.jpg' (18000x3000) > (16000x16000) @ error/cache.c/OpenPixelCache/3813.
  magick pano.jpg -resize 2000x thumb.jpg: rc 1 magick: width or height exceeds limit `pano.jpg' (18000x3000) > (16000x16000) @ error/cache.c/OpenPixelCache/3813.
  ```

- `cert/lib/relink-check.mjs` (homescoop#396): the kit relinks (same imports
  and exports as the shipped binary), then

  ```
  Error: shipped magick.wasm has no name section (homescoop#396)
  ```

  7.1.2-34-1 configured with `CXXFLAGS="-g1 -O2"`, and utilities/magick is a
  C++ link, so emcc stripped the name section and the line tables. With
  `-g` (wasm-imagemagick's default) both stay.

- relink-check's docs check (homescoop#564), on this PR's first build (the
  kit list named the libraries by project, without `libslicc_cred.a`):

  ```
  Error: README.md, Relinking does not name libfreetype.a, libiconv.a, libjpeg.a, liblcms2.a, libopenjp2.a, libpng16.a, libsharpyuv.a, libslicc_cred.a, libtiff.a, libwebp.a, libwebpdemux.a, libwebpmux.a, libxml2.a, libz.a of the kit
  ```

## 7.1.2-34-3: in-place WebP over 16383 px (homescoop#585)

inplace-webp.mjs (wasm-imagemagick's) against the published
`@ai-ecoverse/wasm-imagemagick-heif` 7.1.2-34-2, slicc-kernel 1.81.0,
`--users enforce`, 2026-10-16:

```
browser-cert: FAIL packages/imagemagick-heif/cert/inplace-webp.mjs
AssertionError [ERR_ASSERTION]: w.webp after the refused write (homescoop#585: truncated)
+ ''
- 'WEBP 9000 100'
```

The spec sorts before side-by-side.mjs, which leaves the plain
wasm-imagemagick 7.1.2-32-4 providing `magick` on kernels before 1.94.0.

## 7.1.2-34-4: relink overrides (homescoop#594)

relink-check.mjs's override case against the local 7.1.2-34-3 build, whose
`relink.sh` takes only libheif, libde265 and dav1d from its directory
(2026-10-16):

```
Error: relink.sh did not take libiconv.a from .../override (homescoop#594):
relinked: .../relinked/magick(.wasm)
```

## 7.1.2-34-5: name section only, no kit (homescoop#593)

wasm-check.mjs (wasm-imagemagick's) against the local 7.1.2-34-4 build
(2026-10-16):

```
Error: @ai-ecoverse/wasm-imagemagick-heif: bin/magick.wasm has DWARF, .debug_loc 2092872, .debug_abbrev 265209, .debug_info 4117164, .debug_ranges 229902, .debug_str 1111445, .debug_line 2886203, .debug_aranges 199 (homescoop#593: name section only)
```

## 7.1.2-34-7: attested delegate libraries (homescoop#864; 2026-10-17)

7.1.2-34-7 changes only the build inputs. They're now zlib 1.3.1-4, libjpeg-turbo 3.1.2-4, libpng 1.6.59-3, lcms2 2.19.1-3, libtiff 4.7.2-3, libwebp 1.6.0-3, openjpeg 2.5.3-1, freetype 2.13.3-3, libxml2 2.15.4-2, libiconv 1.19.0-2 and (heif, relink) libheif 1.23.6-4. Each is the attested latest. libwebp moves from upstream 1.5.0 to 1.6.0 and libiconv from 1.18 to 1.19, and the notices follow them.

The ImageMagick code is unchanged, so the negatives above still stand. The first ladder-pr run of homescoop#929 is a negative for its inputs too. With libwebp 1.6.0-2, whose `libwebp.pc` lacks libsharpyuv, the magick link failed with `undefined symbol: SharpYuvInit / SharpYuvGetConversionMatrix / SharpYuvConvert`. libwebp 1.6.0-3 (homescoop#930) fixes that, and the second run is green.

## 7.1.2-34-8: configure.xml without build paths (homescoop#937; 2026-10-17)

`cert/lib/wasm-check.mjs` against the published 7.1.2-34-7 fails:

```text
@ai-ecoverse/wasm-imagemagick: build paths in the tarball (homescoop#937):
  package/etc/ImageMagick-7/configure.xml: .homescoop-out
  package/etc/ImageMagick-7/configure.xml: /home/runner/work
  package/etc/ImageMagick-7-open/configure.xml: .homescoop-out
  …
```

The CFLAGS, LDFLAGS, LIBS, CC/CXX and DISTCHECK_CONFIG_FLAGS entries held the runner's checkout path (`…/.homescoop-out/prefix`) and its emsdk cache. In 34-8, build.sh rewrites them to `/prefix` and `/emsdk`, and the build fails if a build path is left. The local build passes wasm-check (darwin-arm64), with `LIBS … -L/prefix/lib/…` and `CC /emsdk/emscripten/emcc`.

## 7.1.2-34-9: no DWARF, no build paths (homescoop#908; 2026-10-17)

The release itself only adds the README note on writing `.heic`/`.avif` (homescoop#940). Its version moves with imagemagick-relink, whose kit archives are stripped in this wave. The published 34-8 has no DWARF and no build path, so it passes every spec, and the negatives above still stand.

## 7.1.2-34-10: failed writes keep the target, and mogrify -format over an existing target (homescoop#562, #624, #819; 2026-10-18)

- **#562 (write-temp-then-rename.patch).** `atomic-write.mjs` fails on the published 7.1.2-34-9:

  ```text
  AssertionError: orig.png changed after a failed write (homescoop#562: truncated or clobbered)
  ```

  With `-size 2000x1000 gradient: -limit memory 20MiB -limit map 0 -depth 8 orig.png`, -9 exits 1 with "cache resources exhausted". By then it has already replaced the existing 64x64 orig.png with a 2000x1000 one. With a larger image, the issue's repro, the result is a truncated file instead. -10 writes to `orig.png.xxxxxxxx~` and renames it over the target only after success, so the same command exits 1 and leaves orig.png byte-identical. The error message now names that temporary file.
- **#624 (mogrify-format-over-existing.patch).** `mogrify.mjs` fails on -9:

  ```text
  AssertionError: mogrify -format webp over an existing s.webp (homescoop#624)
  ```

  s.webp is `PNG 100 50`. mogrify's backup name `s.webp-xxxxxxxx~` names no format, so the input's encoder ran. -10 passes the -format explicitly.
- **#819.** The cert now runs with `"users": "enforce"`, and every spec passes under it.
