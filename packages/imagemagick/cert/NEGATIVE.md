# Negative: wasm-imagemagick 7.1.2-32-3

7.1.2-32-3 fails `checklist.mjs` at its first assertion: `magick -version` lists only `jng jp2 jpeg lcms png tiff` as built-in delegates, with no freetype, webp, xml or zlib. The `.pc` files that `homescoop_ensure_prefix_pcs` synthesized for wasm-zlib, wasm-libwebp and wasm-freetype said `Version: 0`, so configure's `libwebp >= 0.4.1` and `freetype2 >= 2.8.0` checks failed, and -2/-3 configured `--without-xml`.

## Resource policy (7.1.2-33-1)

`policy.mjs` against the published `@ai-ecoverse/wasm-imagemagick` 7.1.2-32-4, which ships upstream's open policy, fails at its
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
(`host-imagemagick-pr330`, sha256 `c8b68b9cf7a9f628f492da46d367d3a787819d391d6c54714289a281aa24e94f`), slicc-kernel 1.81.0, 2026-10-15:

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

## 7.1.2-34-2: panoramas, relink kit

Against the published `@ai-ecoverse/wasm-imagemagick` 7.1.2-34-1 (npm
`latest`), slicc-kernel 1.81.0, `--users enforce`, 2026-10-16:

- policy.mjs fails at its limits table (`Width: 16000P` where 64000P is
  expected). Its homescoop#445 case alone (an 18000x3000 JPEG made with
  `magick-open`, then plain `identify -format` and `magick -resize`):

  ```
  identify -format: rc 1 "" identify: width or height exceeds limit `pano.jpg' (18000x3000) > (16000x16000) @ error/cache.c/OpenPixelCache/3813.
  magick pano.jpg -resize 2000x thumb.jpg: rc 1 magick: width or height exceeds limit `pano.jpg' (18000x3000) > (16000x16000) @ error/cache.c/OpenPixelCache/3813.
  AssertionError [ERR_ASSERTION]: identify -format pano.jpg: rc 1 identify: width or height exceeds limit `pano.jpg' (18000x3000) > (16000x16000) @ error/cache.c/OpenPixelCache/3813.
  ```

  The same binary with 7.1.2-34-2's `policy-tab.xml` in place of its
  `etc/ImageMagick-7/policy.xml` passes the whole policy.mjs (identify 0.3 s,
  thumbnail 1.1 s): the change is the policy, not the build.

- `cert/lib/relink-check.mjs` (homescoop#395):

  ```
  Error: ai-ecoverse-wasm-imagemagick-7.1.2-34-1.tgz has no share/imagemagick/relink/relink.sh (homescoop#395)
  ```

- relink-check's docs check (homescoop#564), on this PR's first build
  (README section "Licences and relinking (LGPL)", no `libslicc_cred.a`):

  ```
  Error: THIRD-PARTY-NOTICES.md cites README.md, Relinking, which has no such section
  ```

- relink-check's override case (Codex P2 on #545): its override directory
  also holds copies of `libslicc_cred.a` (named in `ldflags.txt`) and
  `libMagickCore-7.Q16HDRI.a`. On this PR's earlier `relink.sh`, which only
  took the delegate libraries from there:

  ```
  Error: relink.sh did not take libslicc_cred.a from .../override:
  ```

## 7.1.2-34-3: in-place WebP over 16383 px (homescoop#585)

inplace-webp.mjs against the published `@ai-ecoverse/wasm-imagemagick`
7.1.2-34-2 (npm `latest`), slicc-kernel 1.81.0, `--users enforce`,
2026-10-16. `magick w.webp -resize 200% w.webp` exits 1, but the input is gone:

```
browser-cert: FAIL packages/imagemagick/cert/inplace-webp.mjs
AssertionError [ERR_ASSERTION]: w.webp after the refused write (homescoop#585: truncated)
+ actual - expected

+ ''
```

webp-check-size-before-open.patch moves upstream's 16383 px check in
WriteWEBPImage before OpenBlob.

## 7.1.2-34-5: name section only, no kit (homescoop#593)

wasm-check.mjs against the local 7.1.2-34-4 build (2026-10-16):

```
Error: @ai-ecoverse/wasm-imagemagick: bin/magick.wasm has DWARF, .debug_loc 1916466, .debug_abbrev 220780, .debug_info 3201567, .debug_ranges 187294, .debug_str 511055, .debug_line 2618988, .debug_aranges 199 (homescoop#593: name section only)
```

Without DWARF the 7.1.2-34-4 tarball would still fail on `ships share/`.

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

