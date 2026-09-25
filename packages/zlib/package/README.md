# `@ai-ecoverse/wasm-zlib`

zlib **1.3.1** built for WebAssembly / emscripten, packaged for
[SLICC](https://github.com/ai-ecoverse/slicc) and the
[homescoop](https://github.com/ai-ecoverse/homescoop) ladder.

| | |
| --- | --- |
| Upstream | [madler/zlib](https://github.com/madler/zlib) `v1.3.1` |
| Recipe | [`packages/zlib`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/zlib) |
| npm version | Matches the upstream recipe version (`1.3.1`) |

## Versioning

The npm version tracks the **upstream zlib release** in
`packages/zlib/recipe.yaml`.

Packaging-only fixes (same zlib, rebuilt or repackaged) use a numeric
suffix: `1.3.1-1`, `1.3.1-2`, …. Upstream bumps (e.g. zlib 1.3.2) reset to
the bare upstream number.

## Status

WASM / SIDE_MODULE artifacts from the homescoop `build.sh` ladder are not
in this tarball yet — this release aligns the published version and docs
with zlib 1.3.1. Depend on a later `1.3.1` / `1.3.1-N` once binaries ship.

## License

Package metadata is MIT. zlib itself remains under the
[zlib license](https://github.com/madler/zlib/blob/master/LICENSE).
