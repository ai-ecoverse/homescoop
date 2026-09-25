# Ladder builds

Homescoope publishes `@ai-ecoverse/wasm-*` in the ImageMagick delegate order.
Each recipe declares **where** it builds:

| `builder` | Script | Where | Emcc |
| --- | --- | --- | --- |
| `host` | `build.sh` | GHA runner (or a laptop) | Native toolchain (`emsdk` npm / system emcc) |
| `slicc` | `build.jsh` | SLICC cone via `packages/github-workflow` | In-cone `/emscripten/slicc` (or future `@ai-ecoverse/emcc`) |

There is no usable in-cone `emcc` on npm yet, so the **base rungs start as
`host`**. Move a recipe to `slicc` when the in-cone toolchain exists.

## Flow (`ladder-build.yml`)

```text
workflow_dispatch(package)
  └─ read recipe.builder
       ├─ host  → npm i emsdk → build.sh → npm pack → OIDC publish
       └─ slicc → start-leader → ipk deps → build.jsh → pack →
                  fetch tgz → OIDC publish
```

OIDC publish always runs **on the runner** (`id-token: write`). One workflow
file keeps a single `npm trust` target.

## Recipe shape

```yaml
name: zlib
builder: host          # host | slicc
version: "1.3.1"
npm: "@ai-ecoverse/wasm-zlib"
source:
  url: "https://zlib.net/zlib-1.3.1.tar.gz"
  sha256: "…"
dependencies:
  build: []            # ipk specs (slicc) or npm packs extracted under $PREFIX (host)
  host: []
  run: []
```

- **`build.jsh`** — required when `builder: slicc`.
- **`build.sh`** — required when `builder: host`.
- A package may keep both scripts while migrating; CI only runs the one
  matching `builder`.

## Commands

```bash
node scripts/read-recipe.mjs zlib --field builder   # host | slicc
node scripts/read-recipe.mjs zlib --deps

# Host path (local or CI)
bash scripts/host-run.sh zlib

# Slicc path — CI only (or a live cone with HOMESCOOP_ROOT mounted)
jsh scripts/ladder-run.jsh zlib
```

## Layout

```text
packages/<name>/
  recipe.yaml      # includes builder: host|slicc
  build.sh         # host body (emconfigure / emmake on the runner)
  build.jsh        # slicc body (same ladder steps in-cone)
  package/         # npm package root
scripts/
  read-recipe.mjs
  host-run.sh      # deps → build.sh → npm pack
  ladder-run.jsh   # ipk deps → build.jsh → npm pack
.github/workflows/
  ladder-build.yml # branches on recipe.builder; OIDC publish
  release.yml      # metadata-only
```

## Higher rungs

Deps listed under `dependencies.*` are `@ai-ecoverse/wasm-*` (or other npm)
specs. Host builds unpack them into `$PREFIX`; slicc builds `ipk add -g` them.
Only the library under build is compiled.
