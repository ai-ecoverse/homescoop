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
npm run reserve
```

## OIDC trusted publishing

```bash
npm login                 # 2FA required (bypass-2FA tokens cannot configure trust)
npm run trust             # fledgling sync → npm trust for every workspace package
```

CI: dispatch [`.github/workflows/release.yml`](.github/workflows/release.yml)
(`id-token: write`, no `NPM_TOKEN`). Details: [`docs/OIDC.md`](docs/OIDC.md).

## Upstream version bumps

[Renovate](https://docs.renovatebot.com/) opens PRs when recipe upstreams
release (see [`docs/renovate.md`](docs/renovate.md) / `renovate.json`).
npm versions track the recipe (`1.3.1`, or `1.3.1-1` for packaging fixes —
[`docs/versioning.md`](docs/versioning.md)).

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
