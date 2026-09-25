# homescoop

Homebrew-shaped recipes for **emscripten / WASM** libraries published as
`@ai-ecoverse/wasm-*` for [SLICC](https://github.com/ai-ecoverse/slicc).

Two build kinds (see [`docs/ladder-builds.md`](docs/ladder-builds.md)):

| `builder` | Script | Runs |
| --- | --- | --- |
| `host` | `build.sh` | GHA runner / laptop — native `emsdk` / emcc |
| `slicc` | `build.jsh` | Inside a SLICC cone (`packages/github-workflow`) |

Base rungs start as **`host`** until an in-cone emcc exists. Higher rungs
`ipk add -g` / unpack lower `@ai-ecoverse/wasm-*` packages so only the
library under build is compiled.

## Layout

```text
packages/<name>/
  recipe.yaml     # builder: host|slicc, version, source, deps, npm id
  build.sh        # host body
  build.jsh       # slicc body
  package/        # npm package root
```

## CI

Dispatch **ladder-build** with `package=zlib`. The workflow reads
`recipe.builder` and runs the matching path, then OIDC-publishes
(`ladder-build.yml` is the trusted publisher).

```bash
bash scripts/host-run.sh zlib          # local host build + pack
node scripts/read-recipe.mjs zlib --field builder
```

## Reserve / trust

```bash
npm run reserve   # 0.0.0 stubs (NPM_TOKEN)
npm login && npm run trust   # fledgling → ladder-build.yml
```

## Upstream bumps

[Renovate](docs/renovate.md) opens PRs on recipe versions. After merge,
dispatch `ladder-build`. Versions: [docs/versioning.md](docs/versioning.md).

## Packages (ladder order)

| npm | builder | notes |
| --- | --- | --- |
| `@ai-ecoverse/wasm-zlib` | host | first rung |
| `@ai-ecoverse/wasm-libjpeg-turbo` | slicc* | stub until ported |
| `@ai-ecoverse/wasm-libpng` | slicc* | needs zlib |
| `@ai-ecoverse/wasm-lcms2` | slicc* | |
| `@ai-ecoverse/wasm-libtiff` | slicc* | zlib, jpeg |
| `@ai-ecoverse/wasm-libwebp` | slicc* | |
| `@ai-ecoverse/wasm-openjpeg` | slicc* | |
| `@ai-ecoverse/wasm-freetype` | slicc* | |
| `@ai-ecoverse/wasm-libxml2` | slicc* | |
| `@ai-ecoverse/wasm-pkgconf` | slicc* | |
| `@ai-ecoverse/wasm-imagemagick` | slicc* | delegates |

\* stub `build.jsh` / may flip to `host` when porting.

## License

Apache-2.0 (recipes and tooling). Upstream libraries keep their own licenses.
