# homescoop

Homebrew-shaped recipes for **emscripten / WASM** libraries published as
`@ai-ecoverse/wasm-*` for [SLICC](https://github.com/ai-ecoverse/slicc).

Two build kinds (see [`docs/ladder-builds.md`](docs/ladder-builds.md)):

| `builder` | Script | Runs |
| --- | --- | --- |
| `slicc` | `build.jsh` | Inside a SLICC cone (`packages/github-workflow`) |
| `host` | `build.sh` | GHA runner / laptop — native `emsdk` / emcc |
| `retired` | — | Not built or published (e.g. ffmpeg) |

Recipes stay **`slicc`** by default until an in-cone emcc exists. Flip a
package to `host` when you want the runner path. Higher rungs install forge
deps with `ipk mamba install` (into `/shared/lib/conda`) so only the library
under build is compiled; npm `@ai-ecoverse/wasm-*` specs still use `ipk add -g`.

## Layout

```text
packages/<name>/
  recipe.yaml     # builder, version, source.url ({{version}}), sha, SPDX license
  *.patch         # optional upstream patches (homescoop_apply_patches)
  build.jsh       # slicc body
  build.sh        # host body — loads recipe via homescoop_load_recipe
  package/        # npm package root (LICENSE required in files[])
shims/slicc/      # vendored slicc libc shims (spawn/exec/fork/select/jobs/signals/gaps)
```

## CI

Dispatch **ladder-build** with `package=zlib`, or merge a PR that changes
`packages/<name>/recipe.yaml` or `package/` (`ladder-merge` auto-dispatches).
ladder-build skips when that `pkg@version` is already on npm; bump `-N` to rebuild.
A `build.sh`-only change does not republish. PRs get **ladder-pr** host
builds (no publish) plus `package.tgz` artifacts for certification.

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
| `@ai-ecoverse/wasm-zlib` | host | **1.3.1-2** (libz.a + headers) |
| `@ai-ecoverse/wasm-lcms2` | host | **2.17.0-1**; dep `@ai-ecoverse/wasm-zlib` |
| `@ai-ecoverse/wasm-libwebp` | host | **1.5.0-1** |
| `@ai-ecoverse/wasm-libxml2` | host | **2.13.8-1** |
| `@ai-ecoverse/wasm-freetype` | host | **2.13.3-1** |
| `@ai-ecoverse/wasm-pkgconf` | host | **2.3.0-5** (slicc `libc_gaps` / `slicc_sigpipe`) |
| `@ai-ecoverse/wasm-libpng` | host | **1.6.50**; dep `@ai-ecoverse/wasm-zlib` |
| `@ai-ecoverse/wasm-libjpeg-turbo` | host | **3.1.2** (emcmake, no SIMD) |
| `@ai-ecoverse/wasm-openjpeg` | host | **2.5.3** (emcmake, codec off) |
| `@ai-ecoverse/wasm-libtiff` | host | **4.7.0**; deps zlib + jpeg |
| `@ai-ecoverse/wasm-gmake` | host | **4.4.1-2** (spawn/exec/select/main_envp/gaps) |
| `@ai-ecoverse/wasm-bash` | host | **5.3.0-8** (readline/history, fork + Asyncify, `/dev/fd` process subst, PIPESTATUS patch; `exec` keeps the pid on slicc-kernel with `execve`) |
| `@ai-ecoverse/wasm-coreutils` | host | **9.12.0-3** single-binary + argv0 manifest (uid 1000 via gaps; exec keeps the pid) |
| `@ai-ecoverse/wasm-sed` | host | **4.9.0-3** |
| `@ai-ecoverse/wasm-grep` | host | **3.12.0-3** |
| `@ai-ecoverse/wasm-gawk` | host | **5.3.2-3** (`gawk` + `awk`) |
| `@ai-ecoverse/wasm-less` | host | **668.0.0-1** (static ncursesw fallbacks) |
| `@ai-ecoverse/wasm-sqlite3` | host | **3.53.4** (shell amalgamation) |
| `@ai-ecoverse/wasm-imagemagick` | host | **7.1.2-31.1** (`magick` / `convert` / `identify` / `mogrify`; etc/ImageMagick-7) |
| `@ai-ecoverse/wasm-tar` | host | **1.35.0-2** (fork + Asyncify for `-z`/`-j`/`-J`, wait4/exec linked) |
| `@ai-ecoverse/wasm-gzip` | host | **1.13.0-2** (`gzip` / `gunzip` / `zcat`, `-DGNU_STANDARD=0`) |
| `@ai-ecoverse/wasm-zip` | host | **3.0.0-1** (`zip` / `unzip`) |
| `@ai-ecoverse/wasm-diffutils` | host | **3.12.0** (`diff` / `cmp` / `diff3` / `sdiff`) |
| `@ai-ecoverse/wasm-patch` | host | **2.8.0** |
| `@ai-ecoverse/wasm-xxd` | host | **9.1.1850** |
| `@ai-ecoverse/wasm-binutils` | host | **2.47.0-2** (`strings` / `size` / `readelf`; BFD x86-64/aarch64 ELF + wasm; nm/ar/strip are in wasm-clang) |
| `@ai-ecoverse/wasm-ncurses-utils` | host | **6.5.0-1** (`clear` / `tput` / `tset` / `reset`; terminfo db via `slicc.env` TERMINFO) |
| `@ai-ecoverse/wasm-mount` | host | **1.0.0-1** (`mount` / `umount`; in-tree, needs slicc-kernel ≥ 1.17.0 process mounts) |
| `@ai-ecoverse/wasm-tree` | host | **2.3.2-1** (`tree`; emcc on the plain Makefile sources) |
| `@ai-ecoverse/wasm-util-linux` | host | **2.42.4-1** (`rev` / `column` / `getopt` / `hexdump` / `colrm` / `look`; no mount/libmount/libblkid) |
| `@ai-ecoverse/wasm-qpdf` | host | **12.4.2-1** (`qpdf` / `fix-qdf` / `zlib-flate`; native crypto, zlib + libjpeg-turbo; replaces pdftk) |
| `@ai-ecoverse/wasm-poppler` | host | **26.10.0-1** (`pdftotext` / `pdftoppm` / `pdfinfo` / `pdfimages` / `pdffonts` / `pdfseparate` / `pdfunite` / `pdfdetach` / `pdfattach` / `pdftops` / `pdftohtml`, `pdftocairo` = `pdftoppm`; one multi-call wasm, Splash only, URW base-14 fonts) |
| `@ai-ecoverse/wasm-rsync` | host | **3.4.4-1** (`rsync`; local copies, fork + Asyncify for the sender/receiver pair, `select()` waits in the kernel; no remote sync yet) |
| `@ai-ecoverse/wasix-gnupg` | host | **2.4.9-2** (gpg/gpgv/gpg-agent/gpgconf/gpg-connect-agent; WASIX, no Asyncify) |
| `@ai-ecoverse/wasi-biome` | host | **2.5.15-2** (`biome`; wasm32-wasip1-threads; no daemon/LSP, `--watch` or `upgrade`) |
| `@ai-ecoverse/wasm-cmake` | slicc* | stub (ladder `rung_cmake`) |

\* stub until ported. Published libs ship relocatable `lib/pkgconfig/*.pc`.
Magick.Native packaging (`wasm-magick-native`) is retired — use
`@imagemagick/magick-wasm` or `@ai-ecoverse/wasm-imagemagick`.
CLI tools declare `package.json` → `slicc.commands` for the wasm realm.

## License

Apache-2.0 (recipes and tooling). Upstream libraries keep their own licenses.
