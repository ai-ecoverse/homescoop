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
