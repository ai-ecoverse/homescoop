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

Dispatch **ladder-build** with `package=zlib`, or merge a PR that touches
`packages/<name>` (`ladder-merge` auto-dispatches). PRs get **ladder-pr**
host builds (no publish) for touched packages.

```bash
node scripts/read-recipe.mjs zlib --field builder
node scripts/list-touched-packages.mjs --base origin/main --head HEAD
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
| `@ai-ecoverse/wasm-pkgconf` | host | **2.3.0-2** published (ladder-build smoke) |
| `@ai-ecoverse/wasm-libpng` | host | **1.6.50** published; dep `@ai-ecoverse/wasm-zlib` |
| `@ai-ecoverse/wasm-libjpeg-turbo` | host | **3.1.2** published (emcmake, no SIMD) |
| `@ai-ecoverse/wasm-openjpeg` | host | **2.5.3** published (emcmake, codec off) |
| `@ai-ecoverse/wasm-libtiff` | host | **4.7.0** published; deps zlib + jpeg |
| `@ai-ecoverse/wasm-imagemagick` | slicc* | stub |
| `@ai-ecoverse/wasm-gmake` | slicc* | stub (ladder `rung_gmake`) |
| `@ai-ecoverse/wasm-cmake` | slicc* | stub (ladder `rung_cmake`) |
| `@ai-ecoverse/wasm-magick-native` | slicc* | stub (Magick.Native Q8) |

\* stub until ported. Published libs ship relocatable `lib/pkgconfig/*.pc`.

## License

Apache-2.0 (recipes and tooling). Upstream libraries keep their own licenses.
