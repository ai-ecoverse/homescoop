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
- **#1258:** `atomic-write-users.mjs`, as cone, writes over root's 0666 `w.png`. On 9.1 it gives `rc=1 … Operation not permitted` in the sticky `/tmp/sk`. In the open `/tmp/op` the write succeeds, but the file becomes cone's. On 9.2, `write-temp-then-rename.patch` keeps upstream's in-place write for a target another user owns: rc 0 in both, and the file stays root's 0666.

## 7.1.2-34-9.3: the delegate pins (2026-10-20)

A pin-only release, with no ImageMagick change. The delegates move to their npm `latest` builds: libpng 1.6.59-4, libwebp 1.6.0-4, libtiff 4.7.2-4, libxml2 2.15.4-3, lcms2 2.19.1-4, freetype 2.13.3-4 and libiconv 1.19.0-3, plus libheif 1.23.6-7 for the heif build and the kits. Those builds fixed #941 (build paths), #925 (libwebp.pc lacked `Requires: libsharpyuv`) and #970 (libheif's plugin directory named the build dir). Their own NEGATIVE.md entries hold the before and after. Here, every spec passes as on 9.2, and `magick.wasm` names no build path.

## 7.1.2-34-9.4: shim drift (homescoop#1491; 2026-10-20)

7.1.2-34-9.4 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 7.1.2-34-9.3 in `bin/magick` and `bin/magick.wasm`, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## 7.1.2-34-9.5: in-place mogrify keeps mode, group and owner; the gsfonts exception (homescoop#1381, #1382; 2026-10-21)

- **#1381 (mogrify-inplace-keep-mode-owner.patch, write-temp-then-rename.patch).** `mogrify-users.mjs` (shared with wasm-imagemagick) against the published wasm-imagemagick 7.1.2-34-9.4, slicc-kernel 1.110.1, `--users enforce`, fails 6 of 11 assertions:

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
  Error: @ai-ecoverse/wasm-imagemagick-heif: etc/fonts has n019003l.pfb, n019004l.pfb, n019023l.pfb, n019024l.pfb but no README with gsfonts' font exception (homescoop#1382)
  ```

  9.5 ships gsfonts' README (which states the exception: "GPL with an exception that you can put these fonts in your own non-GPLed documents") as `etc/fonts/README` next to COPYING (GPL version 2), and the notice carries both. package.json `license` adds `GPL-2.0-only WITH Font-exception-2.0`, the nearest SPDX expression; README.md says the README's wording is the grant.

## 7.1.2-34-9.6: a failed write in a directory the caller can't write leaves the file (homescoop#1608; 2026-10-22)

`mogrify-users.mjs` (shared with imagemagick) against the published 7.1.2-34-9.5, slicc-kernel 1.110.1, `--users enforce`, fails at its new #1608 row exactly as wasm-imagemagick 9.5 does. As kim, over root's 0666 big.png, big2.png and w.png in root's 0755 /tmp/rd:

```text
AssertionError [ERR_ASSERTION]: kim over root's 0666 files in root's 0755 /tmp/rd, where no temporary file can go beside the target (homescoop#1608): ...
mogrify: cache resources exhausted `/tmp/rd/big.png' @ error/cache.c/OpenPixelCache/4044.
mogrify: No IDATs written into file `/tmp/rd/big.png' @ error/png.c/MagickPNGError/1308.
magick: cache resources exhausted `/tmp/rd/big2.png' @ error/cache.c/OpenPixelCache/4044.
+ 'rc=1\nroot root 666\nrc=1\nroot root 666\nrc=0\n20 20\nroot root 666\nbig.png\nbig2.png\nw.png\n0\n'
- 'rc=1\nsame\nroot root 666\nrc=1\nsame\nroot root 666\nrc=0\n20 20\nroot root 666\nbig.png\nbig2.png\nw.png\n0\n'
```

Neither failed write keeps the file: with no temporary file possible beside the target, both patches fell back to upstream's in-place write. The 9.6 change (a temporary file in `$MAGICK_TEMPORARY_PATH`, `$TMPDIR` or `/tmp`, copied in only after a complete encode, or a refusal when none can be created) and the full table are in packages/imagemagick/cert/NEGATIVE.md.

## 7.1.2-34-9.7: mogrify goes on after a failed file, and the temporary file tries each directory (homescoop#1655, #1656; 2026-10-22)

Against the published `@ai-ecoverse/wasm-imagemagick-heif` 7.1.2-34-9.6 (npm `latest`), slicc-kernel 1.110.1, `--users enforce`, both new rows fail.

- **#1655, `mogrify.mjs`.** `mogrify -resize 50% missing.png o1.png o2.png` exits 1 and reports only missing.png, and o1.png and o2.png are left as they were:

  ```text
  AssertionError [ERR_ASSERTION]: mogrify goes on after a missing first file: o1.png and o2.png resized (homescoop#1655): mogrify: unable to open image 'missing.png': No such file or directory @ error/blob.c/OpenBlob/3684.
  +   'PNG 40 20',
  +   'PNG 40 20'
  -   'PNG 20 10',
  -   'PNG 20 10'
  ```

  The cause: MogrifyImageCommand's `status` is cumulative (`status&=`), and every later file's rename of its finished temporary file runs only `if (status != MagickFalse)`, so after one failure each later file was encoded and then thrown away without a word (upstream behaviour). `mogrify-per-file-status.patch` starts each file with its own status: before a file is read, a failed status or a pending error is remembered for the exit code (`mogrify_failed`), the errors are printed (`CatchException`, which also clears the severity that write-temp-then-rename.patch checks), and the status is reset. Each failed file is reported where it fails, the rest are written, and the command still exits 1.

- **#1656, `mogrify-users.mjs`.** As kim in root's 0755 /tmp/rd, the good writes with `MAGICK_TEMPORARY_PATH=/nonexistent` (mogrify), `TMPDIR=/tmp/rd` (magick) and `MAGICK_TEMPORARY_PATH=/tmp/rd TMPDIR=/nonexistent` (mogrify) are all refused, though `/tmp` would take the temporary file:

  ```text
  AssertionError [ERR_ASSERTION]: with $MAGICK_TEMPORARY_PATH or $TMPDIR missing or unwritable, the temporary file goes to the next of $MAGICK_TEMPORARY_PATH, $TMPDIR, /tmp: ... (homescoop#1656): rc=1
  mogrify: unable to create temporary file `/tmp/rd/w.png': No such file or directory @ error/mogrify.c/MogrifyImageCommand/3971.
  magick: unable to create temporary file '/tmp/rd/w.png': Permission denied @ error/constitute.c/WriteImages/1986.
  mogrify: unable to create temporary file `/tmp/rd/w.png': Permission denied @ error/mogrify.c/MogrifyImageCommand/3971.
  + 'rc=1\nsame\nrc=1\n20 20\nroot root 666\nrc=1\n20 20\nroot root 666\nrc=1\n20 20\nroot root 666\n...'
  - 'rc=1\nsame\nrc=0\n10 10\nroot root 666\nrc=0\n5 5\nroot root 666\nrc=0\n10 10\nroot root 666\n...'
  ```

  The cause: 9.6's `HomescoopFallbackTemp` used only the first of `$MAGICK_TEMPORARY_PATH`, `$TMPDIR` and `/tmp` that was set. In 9.7 it tries each in turn (skipping unset, empty and repeated ones), and when none takes the file the refusal names each directory and its error: `unable to create temporary file '/tmp/rd/w.png': tried /nonexistent (No such file or directory), /tmp/rd (Permission denied), /tmp (Permission denied)`. The row that makes all three unwritable (as root, `chmod 755 /tmp` for the duration of one command, restored in a `finally`) also checks that the refused file doesn't stop the other files of the same mogrify.

- **Coverage rows (#1209, #1383).** kim's own 0600 file in /tmp/rd keeps `kim kim 600` (9.6 fails it, because `TMPDIR=/tmp/rd` was refused and the next file skipped); a two-frame GIF keeps both frames through mogrify and magick on the copy path; magick keeps kim's group `users` on her own 0640 file, and root's magick leaves it kim's; wasm-check.mjs finds no libheif plugin directory in `bin/magick.wasm`. The last three pass on 9.6 too (parity rows).
