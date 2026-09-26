# homescoop

Homebrew-shaped recipes for **emscripten / WASM** libraries published as
`@ai-ecoverse/wasm-*` for [SLICC](https://github.com/ai-ecoverse/slicc).

Two build kinds (see [`docs/ladder-builds.md`](docs/ladder-builds.md)):

| `builder` | Script | Runs |
| --- | --- | --- |
| `slicc` | `build.jsh` | Inside a SLICC cone (`packages/github-workflow`) |
| `host` | `build.sh` | GHA runner / laptop — native `emsdk` / emcc |

Recipes stay **`slicc`** by default until an in-cone emcc exists. Flip a
package to `host` when you want the runner path. Higher rungs install forge
deps with `ipk mamba install` (into `/shared/lib/conda`) so only the library
under build is compiled; npm `@ai-ecoverse/wasm-*` specs still use `ipk add -g`.

## Layout

```text
packages/<name>/
  recipe.yaml     # builder: slicc|host, version, source, deps, npm id
  build.jsh       # slicc body
  build.sh        # host body (optional until builder: host)
  package/        # npm package root
```

## CI

Dispatch **ladder-build** with `package=zlib`. The workflow reads
`recipe.builder` and runs the matching path, then OIDC-publishes
(`ladder-build.yml` is the trusted publisher).

```bash
node scripts/read-recipe.mjs zlib --field builder
jsh scripts/ladder-run.jsh zlib        # slicc path (in-cone)
bash scripts/host-run.sh zlib          # only after flipping builder: host
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
| `@ai-ecoverse/wasm-zlib` | host | **1.3.1-2** published (libz.a + headers) |
| `@ai-ecoverse/wasm-lcms2` | host | **2.17.0-1** published; dep `@ai-ecoverse/wasm-zlib` |
| `@ai-ecoverse/wasm-libwebp` | host | **1.5.0-1** published |
| `@ai-ecoverse/wasm-libxml2` | host | **2.13.8-1** published |
| `@ai-ecoverse/wasm-freetype` | host | **2.13.3-1** published |
| `@ai-ecoverse/wasm-pkgconf` | host | **2.3.0-1** published |
| `@ai-ecoverse/wasm-libpng` | host | **1.6.50** published; dep `@ai-ecoverse/wasm-zlib` |
| `@ai-ecoverse/wasm-libjpeg-turbo` | slicc* | stub (needs cmake) |
| `@ai-ecoverse/wasm-libtiff` | slicc* | stub (needs jpeg) |
| `@ai-ecoverse/wasm-openjpeg` | slicc* | stub (needs cmake) |
| `@ai-ecoverse/wasm-imagemagick` | slicc* | stub |

\* stub until ported. Leaf `configure`/`make` rungs ship as `builder: host`.

## License

Apache-2.0 (recipes and tooling). Upstream libraries keep their own licenses.
