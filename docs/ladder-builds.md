# Ladder builds

Homescoope publishes `@ai-ecoverse/wasm-*` in the ImageMagick delegate order.
Each recipe declares **where** it builds:

| `builder` | Script | Where | Emcc |
| --- | --- | --- | --- |
| `slicc` | `build.jsh` | SLICC cone via `packages/github-workflow` | In-cone `/emscripten/slicc` (or future `@ai-ecoverse/emcc`) |
| `host` | `build.sh` | GHA runner (or a laptop) | Native toolchain (`emsdk` npm / system emcc) |
| `retired` | — | — | Not built or published (kept for history / cleanup) |

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
file (`ladder-build.yml`) keeps a single `npm trust` target.

## PR and merge automation

| Workflow | When | What |
| --- | --- | --- |
| `ladder-pr.yml` | pull_request touching `packages/**` | Host-build each touched package (no publish) |
| `ladder-merge.yml` | push to `main` under `packages/**` | `workflow_dispatch` each touched package on `ladder-build.yml` |
| `ladder-build.yml` | `workflow_dispatch` only | Single-package build + OIDC publish |

`ladder-merge` must **not** `uses:` `ladder-build` as a reusable workflow: npm
OIDC validates the *calling* workflow filename, and fledgling trusts only
`ladder-build.yml`. Merge therefore calls `createWorkflowDispatch` so each
publish runs as a real `ladder-build` workflow.

`scripts/list-touched-packages.mjs` maps changed paths → recipe names.
`scripts/sync-package-version.mjs` sets `package.json` version from the
recipe when Renovate bumps upstream (leaves existing `X-N` packaging revs).

## Recipe shape

```yaml
name: libpng
builder: slicc         # slicc | host
version: "1.6.50"
npm: "@ai-ecoverse/wasm-libpng"
source:
  url: "https://…/libpng-{{version}}.tar.gz"
  sha256: "…"
about:
  license: libpng-2.0   # SPDX; package.json must match; LICENSE shipped in pack
dependencies:
  build:
    - zlib             # forge → ipk mamba install (slicc)
    # - "@ai-ecoverse/wasm-zlib@1.3.1-1"  # npm → ipk add -g
  host: []
  run: []
```

Recipe is SSOT for version, URL (`{{version}}` expanded by
`homescoop_load_recipe` / `recipe-env.mjs`), sha256, and SPDX license.
`host-run.sh` runs `check-package-meta.mjs` before `npm pack`. Refresh
sha after Renovate with `node scripts/refresh-recipe-sha.mjs <pkg>`.

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

## Retired recipes

`builder: retired` means the package must not be built or published.
`list-packages`, `list-touched-packages`, `host-run`, `ladder-build`, and
`reserve-names` all skip or refuse it. Example: `packages/ffmpeg` — SLICC
owns `ffmpeg`; `@ai-ecoverse` must not distribute MPEG codecs. Cleanup
commands for historical npm versions:

```bash
node scripts/list-semver-cleanup.mjs   # includes remove-codec-distribution
```

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
```

## Higher rungs

Only the library under build is compiled. Lower forge packages come from
`ipk mamba install` (or published `@ai-ecoverse/wasm-*` npm specs when you
prefer the homescoop tarball over forge).

## slicc libc shims (`shims/slicc/`)

Vendored C/JS shims so CI can link spawn/exec/fork/SIGPIPE without a local
slicc tree. See [`shims/slicc/README.md`](../shims/slicc/README.md).

```bash
homescoop_slicc_archive "$WORK/libslicc.a" gaps   # or spawn|make|fork
LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $WORK/libslicc.a"
# keep_exports: -Wl,-u,slicc_raise|slicc_sig_mask|slicc_sigpipe
# fork profile also needs:
#   $(homescoop_slicc_fork_js_flags)  # --js-library + ASYNCIFY
```

GNU userland recipes (coreutils, sed, grep, gawk) share
`scripts/build-gnu-cli.sh`. Patches live in `patches/`.

## CLI tools and the slicc wasm realm

Static libraries (`lib`, `include`, `.pc`) need no special link flags. **CLI
tools** (pkgconf, gmake, bash, coreutils, …) must be loadable in slicc's
plain DedicatedWorker realm ([slicc#3535](https://github.com/ai-ecoverse/slicc/issues/3535))
and in the existing node-realm `run-tool.js` path.

### Link flags

Use `homescoop_em_cli_ldflags` from `scripts/build-common.sh`:

| Flag | Why |
| --- | --- |
| `-sENVIRONMENT=web,worker,node` | Glue must run without `require`/`process` in a worker; `node` keeps the node-realm path |
| `-sEXIT_RUNTIME=1` | `main` return runs `atexit` (e.g. gnulib `close_stdout` flush) |
| `-sALLOW_MEMORY_GROWTH=1` | Tools that grow beyond the initial heap |

Optional extras via `HOMESCOOP_EM_CLI_LDFLAGS_EXTRA` (pkgconf uses
`-sSTACK_SIZE=1MB` because `pkgconf_trace` keeps a 64 KiB stack buffer).

```bash
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1MB"   # if needed
emconfigure ./configure … LDFLAGS="$(homescoop_em_cli_ldflags)"
```

### `package.json` `slicc` manifest

CLI packages declare command → glue/wasm pairing so the realm does not guess:

```json
"slicc": {
  "abi": "emscripten",
  "commands": {
    "pkgconf": { "glue": "bin/pkgconf", "wasm": "bin/pkgconf.wasm" },
    "pkg-config": { "glue": "bin/pkgconf", "wasm": "bin/pkgconf.wasm" },
    "convert": {
      "glue": "bin/magick",
      "wasm": "bin/magick.wasm",
      "argv0": "convert"
    }
  }
}
```

- **`abi`:** `"emscripten"` now; `"wasi"` / `"wasix"` later.
- **`argv0`:** multi-call binaries (ImageMagick utilities, GNU coreutils
  `--enable-single-binary=symlinks`).
- Stubs (gmake, cmake, imagemagick) already carry the planned `commands`
  block; update paths when the real `bin/` layout lands.
