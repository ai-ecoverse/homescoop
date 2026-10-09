# @ai-ecoverse/wasi-pnpm

[pnpm](https://pnpm.io) 12 for SLICC's WASI runtime (`@ai-ecoverse/slicc-kernel` ≥ 1.7.2):
commands `pnpm` and `pn`. Older kernels can lose a sync filesystem answer under
load, which makes pnpm hang or fail with os error 73.

`bin/pnpm.wasm` is built by homescoop from pnpm's source (v12.9.1, commit
`5dafb09`) with pnpm's own `pnpm/wasm/build.mjs` (Rust nightly-2026-08-27,
WASI SDK 34, WABT 1.0.42) and one documented patch: `parking_lot_core` is built
with its `nightly` feature, so a contended lock waits with
`memory.atomic.wait32` instead of panicking ("Parking not supported on this
platform") as the upstream `@pnpm/wasm` 12.9.1 binary does under load. It is
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

`npm -v` and `npx -v` print pnpm's version, with a one-line note on stderr
that this is pnpm. `npm install --no-save` is refused (pnpm has no
equivalent), as is `npm install -g` without a package name.
