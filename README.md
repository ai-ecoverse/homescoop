# homescoop

Homebrew-shaped recipes for **emscripten / WASM** libraries built for
[SLICC](https://github.com/ai-ecoverse/slicc), published as
`@ai-ecoverse/wasm-*` on npm.

Companion to the in-slicc ImageMagick delegate ladder
(`ladder.sh` in the WASMaxxing work) and to SLICC's `ipk mamba` conda path.
This repo owns **npm distribution** of ladder artifacts; recipes stay small
(`recipe.yaml` + `build.sh`).

## Layout

```text
packages/<name>/
  recipe.yaml     # name, version, source, deps, npm package id
  build.sh        # emconfigure / emmake / install into $PREFIX
  package/        # npm package root (published as @ai-ecoverse/wasm-<name>)
    package.json
    README.md
```

## Reserve / publish names

```bash
# one-time: claim 0.0.0 stubs on npm (needs NPM_TOKEN)
export NPM_TOKEN=…   # or source .env.npm
node scripts/reserve-names.mjs
```

Real builds and OIDC trusted publishing come later (`fledgling` / `npm trust`
against `.github/workflows/release.yml`).

## Packages (ladder set)

| npm | upstream |
| --- | --- |
| `@ai-ecoverse/wasm-zlib` | zlib |
| `@ai-ecoverse/wasm-libjpeg-turbo` | libjpeg-turbo |
| `@ai-ecoverse/wasm-libpng` | libpng |
| `@ai-ecoverse/wasm-lcms2` | lcms2 |
| `@ai-ecoverse/wasm-libtiff` | libtiff |
| `@ai-ecoverse/wasm-libwebp` | libwebp |
| `@ai-ecoverse/wasm-openjpeg` | openjpeg |
| `@ai-ecoverse/wasm-freetype` | freetype |
| `@ai-ecoverse/wasm-libxml2` | libxml2 |
| `@ai-ecoverse/wasm-pkgconf` | pkgconf |
| `@ai-ecoverse/wasm-imagemagick` | ImageMagick |

## License

MIT (recipe wrappers). Upstream libraries keep their own licenses inside each package.
