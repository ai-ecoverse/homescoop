# Negative: wasm-imagemagick-relink

New package (homescoop#593). Before 7.1.2-34-5 the kits shipped inside the
runtime packages, in share/. These are the failures of what was there before.

## A kit whose relink.sh still links with -g

The first local build of this package (2026-10-16, macOS, Emscripten
4.0.23) still used the -34-4 `relink.sh` (`em++ -g -O2`), while the build
linked with `-g2`. relink-check.mjs caught it at the size check: DWARF came
back.

```
Error: imagemagick: relinked magick.wasm is 16459977 bytes, the kit's build 7591652
```

## kit.json, override and docs cases

- `kit.json` is new. A runtime tarball of 7.1.2-34-4 has `share/imagemagick/relink`
  but no `kit.json`, so relink-check has nothing to compare against and fails
  reading it.
- The override case is #594's: on the 7.1.2-34-3 heif kit it fails with
  `relink.sh did not take libiconv.a from .../override` (packages/imagemagick-heif/cert/NEGATIVE.md).
- The docs case is #564's: on 7.1.2-34-2's first build it fails with
  `THIRD-PARTY-NOTICES.md cites README.md, Relinking, which has no such section`
  (packages/imagemagick/cert/NEGATIVE.md).

## 7.1.2-34-6: a mismatched pair (homescoop#678)

relink-check.mjs against the local 7.1.2-34-6 build of this package
(2026-10-16). With the same run's runtime artifacts (peers) it passes: both
`bin/magick.wasm` are the binaries kit.json names (`15bad72a…`, `16204822…`).
Each pair below fails:

- **Same version, other bytes.** A runtime artifact whose `bin/magick.wasm`
  has one extra custom section:

  ```
  Error: @ai-ecoverse/wasm-imagemagick@7.1.2-34-6 bin/magick.wasm from this run's host-imagemagick-pr0 (e9420b43…) is 3e4beb31827351ef216ef85edbe98248e80bbfe96c15d55fa5ab9d9c3aed8a5c, but share/imagemagick/relink/kit.json names 15bad72a983dd5df66801b7e75aa4802411b6a408bc3015ff28d7e84d5d16707: the kit is not that binary's build (homescoop#678)
  ```

- **Other version.** The published runtime 7.1.2-34-5 against the -34-6 kits:

  ```
  Error: …/ai-ecoverse-wasm-imagemagick-7.1.2-34-5.tgz is @ai-ecoverse/wasm-imagemagick@7.1.2-34-5, share/imagemagick/relink/kit.json @ai-ecoverse/wasm-imagemagick@7.1.2-34-6
  ```

- **No runtime of that version.** Not built in the run, and not on the registry:

  ```
  Error: @ai-ecoverse/wasm-imagemagick@7.1.2-34-6 is neither built in this run (no …/host-imagemagick-prN) nor on the registry: share/imagemagick/relink would ship without its runtime (homescoop#678)
  ```

Before -34-6, ladder-pr ran relink-check without `--runtime`, so none of these
pairs failed anything. The published 7.1.2-34-5 runtime also fails
wasm-check.mjs: `package.json homescoop.relink is (none), not @ai-ecoverse/wasm-imagemagick-relink`.

## 7.1.2-34-7: attested delegate libraries (homescoop#864; 2026-10-17)

7.1.2-34-7 changes only the build inputs. They're now zlib 1.3.1-4, libjpeg-turbo 3.1.2-4, libpng 1.6.59-3, lcms2 2.19.1-3, libtiff 4.7.2-3, libwebp 1.6.0-3, openjpeg 2.5.3-1, freetype 2.13.3-3, libxml2 2.15.4-2, libiconv 1.19.0-2 and (heif, relink) libheif 1.23.6-4. Each is the attested latest. libwebp moves from upstream 1.5.0 to 1.6.0 and libiconv from 1.18 to 1.19, and the notices follow them.

The ImageMagick code is unchanged, so the negatives above still stand. The first ladder-pr run of homescoop#929 is a negative for its inputs too. With libwebp 1.6.0-2, whose `libwebp.pc` lacks libsharpyuv, the magick link failed with `undefined symbol: SharpYuvInit / SharpYuvGetConversionMatrix / SharpYuvConvert`. libwebp 1.6.0-3 (homescoop#930) fixes that, and the second run is green.

## 7.1.2-34-8: configure.xml without build paths (homescoop#937; 2026-10-17)

The runtime packages' `configure.xml` no longer holds build paths. The kit's version follows them, because the three packages are one version. The kit itself is unchanged. Its delegate archives, copied from the attested packages, still carry their own build paths in debug info. That belongs to those packages, not this release.

## 7.1.2-34-9: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs imagemagick-relink` (host-run's #908 check) fails on the published 7.1.2-34-8: 20 file(s) ship 19,309,880 bytes of DWARF.

The published 7.1.2-34-8 also has 652 occurrence(s) of the CI build directory `/tmp/homescoop-work` in share/imagemagick/relink/liblcms2.a, share/imagemagick/relink/libxml2.a, share/imagemagick/relink/libfreetype.a (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

7.1.2-34-9 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 7.1.2-34-8 too; the negative is the #908 check.

## 7.1.2-34-9.1: the #562 and #624 patches in the kits (2026-10-18)

The kits ship wasm-imagemagick(-heif) 7.1.2-34-9.1's objects, built with write-temp-then-rename.patch and mogrify-format-over-existing.patch. The published -9 kits relink programs that clobber an existing target on a failed write, and that write PNG bytes for `mogrify -format webp` over an existing .webp. See packages/imagemagick/cert/NEGATIVE.md. relink-check.mjs relinks both kits.

## 7.1.2-34-9.2: the burn-down patches in the kits (2026-10-20)

The kits ship wasm-imagemagick(-heif) 7.1.2-34-9.2's objects: the timer fix (#679), JP2 tiling above 16 MP (#561), and the owner check in the atomic write (#1258). The default font and the MPC policy are runtime files (etc/), not in the kits. See packages/imagemagick/cert/NEGATIVE.md.

## 7.1.2-34-9.3: the delegate pins (2026-10-20)

A pin-only release, with no ImageMagick change. The delegates move to their npm `latest` builds: libpng 1.6.59-4, libwebp 1.6.0-4, libtiff 4.7.2-4, libxml2 2.15.4-3, lcms2 2.19.1-4, freetype 2.13.3-4 and libiconv 1.19.0-3, plus libheif 1.23.6-7 for the heif build and the kits. Those builds fixed #941 (build paths), #925 (libwebp.pc lacked `Requires: libsharpyuv`) and #970 (libheif's plugin directory named the build dir). Their own NEGATIVE.md entries hold the before and after. Here, every spec passes as on 9.2, and `magick.wasm` names no build path.

## 7.1.2-34-9.4: version kept with imagemagick (homescoop#1491; 2026-10-20)

imagemagick and imagemagick-heif go to 7.1.2-34-9.4 for the shim drift on #1491, and imagemagick-relink's build.sh requires the same version (`bump them together`), so it moves with them. Its relink kit picks up the same updated `shims/slicc`. The package's own code is unchanged.

## 7.1.2-34-9.5: the kits follow wasm-imagemagick(-heif) 9.5 (homescoop#1381; 2026-10-21)

The kits ship 9.5's objects: mogrify.o carries mogrify-inplace-keep-mode-owner.patch and constitute.o the metadata copy in write-temp-then-rename.patch, and the heif kit takes wasm-libheif 1.23.6-8's archives. relink-check.mjs checks that each kit's kit.json names this version's `bin/magick.wasm`, so a 9.4 kit can't pass for 9.5. The behaviour negatives are wasm-imagemagick's (NEGATIVE.md there).
