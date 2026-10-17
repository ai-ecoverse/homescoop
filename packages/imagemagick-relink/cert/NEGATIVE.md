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
