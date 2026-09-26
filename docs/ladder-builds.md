# Ladder builds

Homescoope publishes `@ai-ecoverse/wasm-*` in the ImageMagick delegate order.
Each recipe declares **where** it builds:

| `builder` | Script | Where | Emcc |
| --- | --- | --- | --- |
| `slicc` | `build.jsh` | SLICC cone via `packages/github-workflow` | In-cone `/emscripten/slicc` (or future `@ai-ecoverse/emcc`) |
| `host` | `build.sh` | GHA runner (or a laptop) | Native toolchain (`emsdk` npm / system emcc) |

Default is **`slicc`**. Flip a recipe to `host` when you want the runner
path (e.g. before in-cone emcc is ready). The dual-script framework is
always present; CI only runs the script matching `builder`.

## Flow (`ladder-build.yml`)

```text
workflow_dispatch(package)
  └─ read recipe.builder
       ├─ slicc → start-leader → ipk mamba / ipk add deps → build.jsh →
       │          pack → fetch tgz → OIDC publish
       └─ host  → npm i emsdk → (npm deps only) → build.sh → npm pack →
                  OIDC publish
```

OIDC publish always runs **on the runner** (`id-token: write`). One workflow
file keeps a single `npm trust` target.

## Recipe shape

```yaml
name: libpng
builder: slicc         # slicc | host
version: "1.6.50"
npm: "@ai-ecoverse/wasm-libpng"
source:
  url: "…"
  sha256: "…"
dependencies:
  build:
    - zlib             # forge → ipk mamba install (slicc)
    # - "@ai-ecoverse/wasm-zlib@1.3.1-1"  # npm → ipk add -g
  host: []
  run: []
```

- **`build.jsh`** — required when `builder: slicc`.
- **`build.sh`** — required when `builder: host`.
- A package may keep both scripts while migrating; CI only runs the one
  matching `builder`.

### Dependency specs

| Spec form | Slicc | Host |
| --- | --- | --- |
| `zlib` / `zlib=1.3.1` | `ipk mamba install` → `/shared/lib/conda` | skipped (forge-only) |
| `@scope/pkg` / `pkg@1.0` | `ipk add -g` → `/shared/lib/node_modules` | `npm pack` into `$PREFIX` |

`ipk mamba` landed in SLICC ([#3493](https://github.com/ai-ecoverse/slicc/pull/3493)):
emscripten-forge / conda-forge into `/shared/lib/conda`. Builds run with
`PREFIX=/shared/lib/conda` so higher rungs link forge headers and `.a` files.

## Commands

```bash
node scripts/read-recipe.mjs libpng --deps
node scripts/read-recipe.mjs libpng --deps-mamba
node scripts/read-recipe.mjs zlib --field builder

# Slicc path — CI (or a live cone with HOMESCOOP_ROOT mounted)
jsh scripts/ladder-run.jsh libpng

# Host path — after flipping recipe.builder to host
bash scripts/host-run.sh zlib
```

## Layout

```text
packages/<name>/
  recipe.yaml      # includes builder: slicc|host
  build.jsh        # slicc body
  build.sh         # host body (emconfigure / emmake on the runner)
  package/         # npm package root
scripts/
  read-recipe.mjs
  ladder-run.jsh   # mamba/npm deps → build.jsh → npm pack
  host-run.sh      # npm deps → build.sh → npm pack
.github/workflows/
  ladder-build.yml # branches on recipe.builder; OIDC publish
  release.yml      # metadata-only
```

## Higher rungs

Only the library under build is compiled. Lower forge packages come from
`ipk mamba install` (or published `@ai-ecoverse/wasm-*` npm specs when you
prefer the homescoop tarball over forge).
