# @ai-ecoverse/wasi-pnpm

[pnpm](https://pnpm.io) 12 for SLICC's WASI runtime (`@ai-ecoverse/slicc-kernel` ≥ 1.7.2):
commands `pnpm` and `pn`. Older kernels can lose a sync filesystem answer under
load, which makes pnpm hang or fail with os error 73.

`bin/pnpm.wasm` is built by homescoop from pnpm's source (v12.9.1, commit
`5dafb09`) with pnpm's own `pnpm/wasm/build.mjs` (Rust nightly-2026-08-27,
WASI SDK 34, WABT 1.0.42) and three documented patches (the third only keeps
the linked module for its function names). `parking_lot_core` is
built with its `nightly` feature, so a contended lock waits with
`memory.atomic.wait32` instead of panicking ("Parking not supported on this
platform") as the upstream `@pnpm/wasm` 12.9.1 binary does under load; and
pnpm-cli doesn't compile its source checkout's path into the wasm, which
holds no build path. It is
therefore not byte-identical to `@pnpm/wasm` (MIT; see `LICENSE` and
`THIRD-PARTY-NOTICES.md`). It imports three host modules besides
WASI; `host/pnpm-host.mjs` implements them on top of slicc-kernel, which loads it
through `slicc.commands.<name>.imports`:

- `pnpm_host`: HTTP through the kernel's network transport, `git` through
  `@ai-ecoverse/wasm-git` spawned by the kernel, and terminal prompts
  (interactive prompts are not supported; pass `--otp` for npm 2FA).
- `pnpm_fs`: exclusive creation with a mode, no-follow opens, `fchmod`, modes,
  advisory locks and private lock directories, over the kernel's filesystem.
- `pnpm_atomic`: atomic waits.

What needs what:

| | plain page (`fetchTransport()`, CORS) | CORS-free transport (slicc-node, the SLICC extension or app) |
| --- | --- | --- |
| installs from registry.npmjs.org | ✓ | ✓ |
| registries with auth tokens | ✗ | ✓ |
| `pnpm publish` (up to 64 MiB) | ✗, clear error | ✓ (auth from `.npmrc`, `--otp`) |
| git dependencies over the network (https, ssh) | ✗, clear error | ✓ with `@ai-ecoverse/wasm-git` and `@ai-ecoverse/wasm-tls-engine` installed and the kernel prepared |
| `git+file:` dependencies (a repository in the kernel's file system) | ✓ with `@ai-ecoverse/wasm-git` installed | ✓ with `@ai-ecoverse/wasm-git` installed |

OPFS has no hard links and keeps symlinks only in slicc-kernel's metadata, so
the package defaults to `node-linker=hoisted`, `package-import-method=copy` and
`ignore-scripts=true` (as `PNPM_CONFIG_*` variables in `slicc.env`), and asks
the kernel for up to 256 threads.

`slicc.env` also points `PNPM_WASM_EXECUTABLE` at the package's own
`bin/pnpm.wasm`, which `pnpm add -g` / `pnpm remove -g` need to link global
bins. It sets `PNPM_CONFIG_UPDATE_NOTIFIER=false` too: pnpm's daily "Update
available!" check is a registry request with no use in slicc, where the
package, not pnpm itself, decides the version. As with every package env value,
a caller's own environment wins: `PNPM_CONFIG_UPDATE_NOTIFIER=true` brings the
check back.

## A trap's frames (12.9.1-10)

`bin/pnpm.wasm.names` holds pnpm.wasm's function names: the Rust symbols
(v0-mangled, as `rustfilt` reads them) and the C ones, at pnpm.wasm's own
function indices. pnpm.wasm has no name section of its own. Up to 12.9.1-9 it
carried one with generated names only (`f4998`), so a trap named no function.
Run pnpm with `SLICC_WASM_BACKTRACE=1` in its environment: a trap such as
`pnpm: wasm trap in thread 4: memory access out of bounds` is then followed by
up to 40 frames, named from this file. Without the variable nothing reads the
file. It's 5.9 MB on disk and 0.8 MB of the tarball. To get these names,
12.9.1-10 links with `strip=debuginfo` instead of pnpm's `strip=symbols`,
which re-links the code, so it isn't byte for byte 12.9.1-9's (the source,
toolchain and behaviour are the same), and names from one build don't fit
another (homescoop#1126).

## Updates in place

12.9.1-11 and -12 staged each imported package in a sibling directory and
renamed it into place, so a reader never saw a package half there
(homescoop#1128). On slicc-kernel up to 1.124.x a directory rename copies
the whole tree, which made installs slower and, for a large package, timed
out (`failed to rename staging directory … Operation timed out (os error 73)`)
in a quarter of the agent installs of homescoop#1127's stress loop. 12.9.1-13
goes back to pnpm's own in-place import, so a package can be seen half
replaced while an install updates it.

## Modes and the umask (12.9.1-12)

pnpm reads the process's umask from the kernel, so `umask 077; pnpm install`
gives node_modules files 700/600 (bin targets get pnpm's `+x`), and 022 gives
755/644. Up to 12.9.1-11 the host always answered 022, and files came out
755/644 whatever the umask. The wasm port also makes fewer mode calls per
file it creates: each store shard's mode is looked up once, and a created
file's mode isn't checked and re-applied once the kernel has been seen to
apply creation modes (about a third of pnpm's own per-file OPFS calls in the
kernel's trace of an install).

## Kernel copies and initial memory (12.9.1-14)

On slicc-kernel 1.128.0 or later, pnpm imports each file with the kernel's
own copy (`ctx.fs.copyFile`): one kernel call per file, and no bytes through
pnpm's memory. Older kernels keep pnpm's own copy. pnpm.wasm starts with
256 MiB of memory (up to 1 GiB), not 4.3 MiB: growing shared memory while
pnpm's worker threads allocate trapped on CI's Linux Chromium
(`pnpm: wasm trap in thread N: memory access out of bounds`, homescoop#1127),
and a warm install now rarely grows at all.

## Projects and the pin (12.9.1-15)

A directory without a `package.json` of its own is its own project: `pnpm
add <pkg>` there creates `package.json` in it, as native pnpm does. pnpm
looks for the nearest ancestor with a project marker, and in slicc the root
holds the base set's `node_modules`, so up to 12.9.1-14 every such
directory resolved to `/` and the command failed with
`ERR_PNPM_PACKAGE_MANIFEST_IO_ERROR` (os error 44), leaving a
`/.tmpXXXXXX`. `/` is a project only when pnpm runs there. `pnpm init`
pins the running pnpm in `packageManager` and `devEngines`: this pnpm can't
switch to another version, and up to 12.9.1-14 it pinned the registry's
latest, so the next command in the project failed with
`ERR_PNPM_UNSUPPORTED_RUNTIME`. A project pinned to another version still
works with `npm_config_manage_package_manager_versions=false`.

## The false trap (12.9.1-16)

Under load, pnpm could die with `pnpm: wasm trap in thread N: memory access
out of bounds` (homescoop#1127). V8 bounds-checks a thread's `memory.fill` and
`memory.copy` (memset, memcpy) against that thread's own view of the shared
memory, and that view can lag behind a `memory.grow` another thread just did.
It's a false trap: no wrong bytes are written, but the install aborts.
12.9.1-16's allocator refreshes the view (`memory.grow(0)`) before it hands
a thread memory above it, and since 12.9.1-14 pnpm starts with 256 MiB of
memory, above an agent install's peak (232 MiB cold, 96 MiB warm), so it
rarely grows at all.

## `npm`, `npx` and `i`

The package also provides `npm`, `npx` and `i` as small `#!/bin/sh` scripts
(`shims/`, slicc-kernel `script` commands; `/bin/sh` is `@ai-ecoverse/wasm-bash`)
that run pnpm, so the commands agents type every day work:

| Typed | Runs |
| --- | --- |
| `npm install` / `npm i` / `i` | `pnpm install` |
| `npm install <pkg…>` / `npm i <pkg…>` / `i <pkg…>` (`-g`, `-D`, `-O`, `-E`, `-P`) | `pnpm add <pkg…>` with the same flags |
| `npm ci` | `pnpm install --frozen-lockfile` |
| `npm uninstall` / `rm` / `remove` `<pkg…>` | `pnpm remove <pkg…>` |
| `npm run <script> [-- args]`, `npm test` / `start` / `stop` / `restart` | `pnpm run <script> [args]` |
| `npm update` / `ls` / `why` / `explain` | `pnpm update` / `list` / `why` |
| any other `npm <verb>` | `pnpm <verb>` |
| `npx <command> [args]` | the installed command; a command that is not installed is an error naming what to install (`npm i -g <pkg>`), nothing is downloaded on the fly |

`pnpm run` (and so `npm run`, `npm test`, `npm start`) runs package scripts
through the kernel's `sh` (`host/pnpm-host.mjs` answers pnpm's `shell.spawn`);
install-time lifecycle scripts stay off (`ignore-scripts=true`).

pnpm keeps its default `minimumReleaseAge` (one day, `@ai-ecoverse/*`
included): an unpinned install skips releases less than 24 h old and takes
the previous version. Pin `pkg@x.y.z-n` to install a fresh one. `npm help`,
`npm i --help` and npx's not-installed message say so, and after an unpinned
`npm i -g <pkg>` that did not get the registry's latest, npm prints one stderr
line naming the version to pin (read from pnpm's own metadata cache, no extra
request).

`npm -v` and `npx -v` print pnpm's version, with a one-line note on stderr
that this is pnpm. `npm install --no-save` is refused (pnpm has no
equivalent), as is `npm install -g` without a package name.
