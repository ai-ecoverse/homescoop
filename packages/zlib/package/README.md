# `@ai-ecoverse/wasm-zlib`

zlib **1.3.1** built for WebAssembly / emscripten inside
[SLICC](https://github.com/ai-ecoverse/slicc), packaged by
[homescoop](https://github.com/ai-ecoverse/homescoop).

| | |
| --- | --- |
| Upstream | [madler/zlib](https://github.com/madler/zlib) `v1.3.1` |
| Recipe | [`packages/zlib`](https://github.com/ai-ecoverse/homescoop/tree/main/packages/zlib) |
| Build | `build.jsh` (ladder `emconfigure` / `emmake`) |

## Contents

After a ladder build:

- `lib/libz.a` — static archive
- `include/zlib.h`, `include/zconf.h`

## Versioning

npm version tracks the recipe upstream (`1.3.1`). Packaging-only rebuilds use
`1.3.1-1`, `1.3.1-2`, … — see homescoop [`docs/versioning.md`](https://github.com/ai-ecoverse/homescoop/blob/main/docs/versioning.md).

## License

Homescoope packaging is [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
zlib itself remains under the
[zlib license](https://github.com/madler/zlib/blob/master/LICENSE).
