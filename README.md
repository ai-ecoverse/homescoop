# homescoop

Homebrew-shaped recipes for **emscripten / WASM** libraries built **inside
[SLICC](https://github.com/ai-ecoverse/slicc)** and published as
`@ai-ecoverse/wasm-*` on npm.

Companion to the ImageMagick delegate ladder (WASMaxxing `ladder.sh`) and to
SLICC’s `ipk mamba` path. Homescoope owns **npm distribution**; each rung is
a small `recipe.yaml` + `build.jsh`. Higher rungs install lower ones with
`ipk add -g @ai-ecoverse/wasm-…` so only the library under build is compiled.

## Layout

```text
packages/<name>/
  recipe.yaml     # version, source, deps (ipk specs), npm id
  build.jsh       # in-SLICC ladder body (emconfigure / emmake)
  package/        # npm package root (@ai-ecoverse/wasm-<name>)
scripts/
  ladder-run.jsh  # ipk deps → build.jsh → npm pack
  read-recipe.mjs
```

Build pipeline: [`docs/ladder-builds.md`](docs/ladder-builds.md).

## Ladder CI

```bash
# Dispatch: boots SLICC via packages/github-workflow, builds, OIDC-publishes
# Actions → ladder-build → package=zlib
```

Requires repo secrets `SLICC_CONE_CONFIG` / `SLICC_SECRETS_ENV` when the cone
needs accounts; the build itself uses `exec` (no model). Emcc must be on the
cone `PATH` (ladder toolchain). npm OIDC publish runs on the GHA runner
(`id-token: write`), bound to `ladder-build.yml` via `npm run trust`.

## Reserve names / trust

```bash
export NPM_TOKEN=…   # or source .env.npm — stubs only
npm run reserve
npm login            # 2FA; bypass-2FA tokens cannot configure trust
npm run trust        # fledgling → npm trust for ladder-build.yml
```

Metadata-only republish without a SLICC build:
[`.github/workflows/release.yml`](.github/workflows/release.yml) (also needs
a matching `npm trust` entry if you use it).

## Upstream version bumps

[Renovate](https://docs.renovatebot.com/) opens PRs when recipe upstreams
release ([`docs/renovate.md`](docs/renovate.md)). After merge, dispatch
`ladder-build` for that package. Version scheme:
[`docs/versioning.md`](docs/versioning.md).

## Packages (ladder order)

| npm | upstream | deps |
| --- | --- | --- |
| `@ai-ecoverse/wasm-zlib` | zlib | — |
| `@ai-ecoverse/wasm-libjpeg-turbo` | libjpeg-turbo | — |
| `@ai-ecoverse/wasm-libpng` | libpng | zlib |
| `@ai-ecoverse/wasm-lcms2` | lcms2 | — |
| `@ai-ecoverse/wasm-libtiff` | libtiff | zlib, jpeg |
| `@ai-ecoverse/wasm-libwebp` | libwebp | — |
| `@ai-ecoverse/wasm-openjpeg` | openjpeg | — |
| `@ai-ecoverse/wasm-freetype` | freetype | — |
| `@ai-ecoverse/wasm-libxml2` | libxml2 | — |
| `@ai-ecoverse/wasm-pkgconf` | pkgconf | — |
| `@ai-ecoverse/wasm-imagemagick` | ImageMagick | delegates |

## License

Apache-2.0 (recipes, tooling, and package metadata). Upstream libraries keep
their own licenses (see each recipe / shipped artifacts).
