# Ladder builds

Homescoope publishes `@ai-ecoverse/wasm-*` by building **inside SLICC**, using
the same delegate order as the ImageMagick ladder (`ladder.sh` / WASMaxxing).

## Flow

```text
GitHub Actions (homescoop)
  └─ packages/github-workflow (ai-ecoverse/slicc)
       ├─ start-leader   (hosted cone on the runner)
       ├─ mount / inject homescoop → /mnt/homescoop
       ├─ exec: ipk-install recipe deps
       ├─ exec: packages/<name>/build.jsh
       ├─ exec: pack → /tmp/homescoop/<pkg>.tgz
       ├─ read-file     (tarball back to the runner)
       └─ npm publish   (OIDC on the runner — trusted release.yml workflow file)
```

1. **Recipe** (`packages/<name>/recipe.yaml`) — upstream version, source
   URL/sha256, and dependencies. Deps are other `@ai-ecoverse/wasm-*`
   packages (or plain npm names) installed with `ipk` before the build.
2. **`build.jsh`** — runs in the leader’s virtual shell (JS shell). Fetches
   source, runs `emconfigure` / `emmake` like the ladder, stages artifacts
   into `package/`.
3. **Pack** — `npm pack` from `package/` inside SLICC.
4. **Publish** — the runner publishes the `.tgz` with
   `permissions.id-token: write`. npm trusted publishing is bound to this
   repo’s workflow file; the OIDC exchange happens on the runner (not inside
   the browser cone). Build-time secrets for the cone still go through
   `SLICC_SECRETS_ENV` when needed.

Higher rungs **pull lower rungs from npm** (`ipk add -g @ai-ecoverse/wasm-zlib@…`)
so only the library under build is compiled. Start with **zlib** (no wasm-*
deps); the ladder thread can open PRs or dispatch this workflow for jpeg,
png, ….

## Commands

```bash
# Local: print deps for a recipe (Node, no SLICC required)
node scripts/read-recipe.mjs zlib --deps

# CI: workflow_dispatch ladder-build.yml with package=zlib
```

## Layout

```text
packages/<name>/
  recipe.yaml    # version, source, dependencies.{build,host,run}
  build.jsh      # in-SLICC build (ladder body)
  package/       # npm package root (published)
scripts/
  read-recipe.mjs
  ladder-run.jsh   # install deps → build.jsh → npm pack
.github/workflows/
  ladder-build.yml # SLICC boot + OIDC publish
  release.yml      # stub/metadata-only publish (no build)
```

## Emcc

`build.jsh` expects `emconfigure` / `emmake` on `PATH` (same as the ladder’s
`/emscripten/slicc` prefix). Until the cone image ships that toolchain,
builds fail with a clear missing-emcc error — wire the toolchain via mount
or a follow-up skill/ipk, not by reintroducing host-only `build.sh`.
