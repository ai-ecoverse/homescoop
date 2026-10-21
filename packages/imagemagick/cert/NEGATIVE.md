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

## 7.1.2-34-9.1: failed writes keep the target, and mogrify -format over an existing target (homescoop#562, #624, #819; 2026-10-18)

- **#562 (write-temp-then-rename.patch).** `atomic-write.mjs` fails on the published 7.1.2-34-9:

  ```text
  AssertionError: orig.png changed after a failed write (homescoop#562: truncated or clobbered)
  ```

  With `-size 2000x1000 gradient: -limit memory 20MiB -limit map 0 -depth 8 orig.png`, -9 exits 1 with "cache resources exhausted". By then it has already replaced the existing 64x64 orig.png with a 2000x1000 one. With a larger image, the issue's repro, the result is a truncated file instead. -9.1 writes to `orig.png.xxxxxxxx~` and renames it over the target only after success, so the same command exits 1 and leaves orig.png byte-identical. The error message now names that temporary file.
- **#624 (mogrify-format-over-existing.patch).** `mogrify.mjs` fails on -9:

  ```text
  AssertionError: mogrify -format webp over an existing s.webp (homescoop#624)
  ```

  s.webp is `PNG 100 50`. mogrify's backup name `s.webp-xxxxxxxx~` names no format, so the input's encoder ran. -9.1 passes the -format explicitly.
- **#1244, #1245, #1207 (cert-review of the first 9.1 build).** The first version of write-temp-then-rename.patch applied to every coder, and that broke three things:
  - `-write mpr:orig` wrote and renamed an empty `orig.xxxxxxxx~` over a cwd file named `orig`, losing data, and lost the register.
  - A 0444 target was replaced by rename.
  - A HEIC write (no encoder) exited 0 and left a `HEIC:…~` file.

  The patch now takes the temp-and-rename path only for single-file raster coders that have an encoder. They are named by the target's extension or by the same explicit prefix. The target must be one the user may write. Everything else keeps upstream's direct write. `atomic-write.mjs` adds the mpr: and unknown-prefix rows, and the heif package's `atomic-write-users.mjs` adds the read-only and HEIC rows as a non-root user. The published -9 behaves the same on all four, so they're parity rows, and the first 9.1 build failed the mpr: one.
- **#819.** The cert now runs with `"users": "enforce"`, and every spec passes under it.

## 7.1.2-34-9.2: the burn-down (homescoop#561, #586, #679, #1206, #1208, #1258; 2026-10-20)

`defaults.mjs` runs each case below. The published 7.1.2-34-9.1, on slicc-kernel 1.110.1 under users enforce, gives:

| case | 7.1.2-34-9.1 | 7.1.2-34-9.2 |
|---|---|---|
| `label:hi`, `-annotate` without `-font` (#586) | rc 1: `unable to read font `'` | rc 0: Nimbus Sans as Helvetica (etc/fonts, type.xml) |
| `xc:red out.mpc` (#1208) | rc 1: `cache resources exhausted … unable to persist pixel cache` | rc 1: `not authorized by the security policy `MPC'`; magick-open writes and reads MPC |
| `identify rose:` (#679) | `4294967295:10.000` | `0:00.0xx` |
| `16000x3000 gradient: g16.jp2` (#561) | rc 1: `unable to encode image file` | rc 0, JP2 16000x3000 |

- **#679, the cause:** ImageMagick's timer prefers `CLOCK_MONOTONIC_RAW`. Emscripten's `clock_gettime` accepts only the four WASI clocks and returns EINVAL for it, so the `timespec` was left uninitialized. `timer-monotonic-emscripten.patch` uses `CLOCK_MONOTONIC` there and returns 0 on failure.
- **#561, the cause:** openjpeg encodes an untiled image as a single tile, and at 48 MP that no longer fits the 2 GiB wasm heap. `jp2-tile-large.patch` encodes images above 16 MP in 1024x1024 tiles unless `-extract` sets a tile size. 64 MP and up is refused by the tab policy's area limit as before (`cache resources exhausted`).
- **#1206:** fixed by the version scheme. 7.1.2-34-9.1 and this 9.2 sort above -9, per docs/versioning.md, and `npm-parity`/`sync-package-version` enforce it.
- **#1258** (a target another user owns is rewritten in place): its row is in wasm-imagemagick-heif's `atomic-write-users.mjs`, since that live pair has a shell for the second user. The patch is shared.

## 7.1.2-34-9.3: the delegate pins (2026-10-20)

A pin-only release, with no ImageMagick change. The delegates move to their npm `latest` builds: libpng 1.6.59-4, libwebp 1.6.0-4, libtiff 4.7.2-4, libxml2 2.15.4-3, lcms2 2.19.1-4, freetype 2.13.3-4 and libiconv 1.19.0-3, plus libheif 1.23.6-7 for the heif build and the kits. Those builds fixed #941 (build paths), #925 (libwebp.pc lacked `Requires: libsharpyuv`) and #970 (libheif's plugin directory named the build dir). Their own NEGATIVE.md entries hold the before and after. Here, every spec passes as on 9.2, and `magick.wasm` names no build path.

## 7.1.2-34-9.4: shim drift (homescoop#1491; 2026-10-20)

7.1.2-34-9.4 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 7.1.2-34-9.3 in `bin/magick` and `bin/magick.wasm`, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## 7.1.2-34-9.5: in-place mogrify keeps mode, group and owner; the gsfonts exception (homescoop#1381, #1382; 2026-10-21)

- **#1381 (mogrify-inplace-keep-mode-owner.patch, write-temp-then-rename.patch).** `mogrify-users.mjs` against the published 7.1.2-34-9.4, slicc-kernel 1.110.1, `--users enforce`, fails 6 of 11 assertions:

  | case | 7.1.2-34-9.4 | 7.1.2-34-9.5 |
  |---|---|---|
  | kim, `mogrify -resize 50%` over her own 0644 kim:users a.png and 0640 b.png | `kim kim 600`, `kim kim 600` | `kim users 644`, `kim kim 640` |
  | root, over kim's 0644 a.png and 0664 kim:users c.jpg | `root root 600`, `root root 600` | `kim users 644`, `kim users 664` |
  | kim, over root's 0666 w.png in a sticky /tmp/msk | rc 1, w.png unchanged, `w.png-df0894cd~` left behind | rc 0, resized, `root root 666`, no stray file |
  | kim, over root's 0666 w.png in an open /tmp/mop | `kim kim 600` | rc 0, resized, `root root 666` |
  | kim, a failing `magick … -depth 8` write over root's 0666 big.png | rc 1, big.png truncated (the #1258 in-place write) | rc 1, big.png byte-identical, `root root 666` |
  | kim, `mogrify` over a symlink l.png -> real.png (0640 kim:users) | the link replaced by a 0600 regular file | the link kept; real.png resized, `kim users 640` |

  A failed mogrify encode (`-limit memory 24MiB -limit map 0 -depth 8`, "cache resources exhausted") leaves kim's own file and root's file in both directories byte-identical on 9.5. 9.4 keeps the bytes there too (its backup is renamed only on success), so these are parity rows. Its row for root's file still fails, because the earlier sticky-dir backup is left in /tmp/msk.

  The cause: upstream mogrify writes the new image to a `<file>-xxxxxxxx~` backup that it creates 0600, owned by the caller, and renames it over the file. The first head of this PR (499b5a82) gave the backup the file's metadata and fell back to writing the file in place when it couldn't. The Grok review (review 5604380547) found that that fallback, like #1258's in-place write in write-temp-then-rename.patch, opens the file with `O_TRUNC` before the new image exists, so a failed encode destroyed the only copy. 9.5 never writes the target before the new image is complete:
  - `HomescoopPrepareReplace` (in constitute.c, used by both patches) gives the new temporary file the target's owner, group and mode (`fchown`, `fchmod` on the descriptor), and checks the result with `fstat`.
  - `HomescoopReplaceFile` renames the finished file over the target only if that held, the target is still the same inode (`lstat` dev/ino) and it has one link. Otherwise (another user's file as non-root, a group or mode that can't be set, a hard-linked file, a symlink) the finished image is copied into the target. The target is opened without `O_TRUNC` (and `O_NOFOLLOW` unless it was a symlink), its dev/ino is checked with `fstat`, and then it's `ftruncate`d to the new size.
- **#1382 (gsfonts' exception).** `cert/lib/wasm-check.mjs` against the published 7.1.2-34-9.4:

  ```text
  Error: @ai-ecoverse/wasm-imagemagick: etc/fonts has n019003l.pfb, n019004l.pfb, n019023l.pfb, n019024l.pfb but no README with gsfonts' font exception (homescoop#1382)
  ```

  9.5 ships gsfonts' README (which states the exception: "GPL with an exception that you can put these fonts in your own non-GPLed documents") as `etc/fonts/README` next to COPYING (GPL version 2), and the notice carries both. package.json `license` adds `GPL-2.0-only WITH Font-exception-2.0`, the nearest SPDX expression; README.md says the README's wording is the grant.
