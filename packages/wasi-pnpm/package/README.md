# @ai-ecoverse/wasi-pnpm

[pnpm](https://pnpm.io) 12 for SLICC's WASI runtime (`@ai-ecoverse/slicc-kernel` ≥ 1.7.0):
commands `pnpm` and `pn`.

`bin/pnpm.wasm` is pnpm's own `wasm32-wasip1-threads` build from
[`@pnpm/wasm`](https://www.npmjs.com/package/@pnpm/wasm), unchanged (MIT; see
`LICENSE` and `THIRD-PARTY-NOTICES.md`). It imports three host modules besides
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
| git dependencies | ✗, clear error | ✓ with `@ai-ecoverse/wasm-git` and `@ai-ecoverse/wasm-tls-engine` installed and the kernel prepared |

OPFS has no hard links and keeps symlinks only in slicc-kernel's metadata, so
the package defaults to `node-linker=hoisted`, `package-import-method=copy` and
`ignore-scripts=true` (as `PNPM_CONFIG_*` variables in `slicc.env`), and asks
the kernel for up to 256 threads.
