# @ai-ecoverse/wasi-pnpm

[pnpm](https://pnpm.io) 12 for SLICC's WASI runtime (`@ai-ecoverse/slicc-kernel`):
commands `pnpm` and `pn`.

`bin/pnpm.wasm` is pnpm's own `wasm32-wasip1-threads` build from
[`@pnpm/wasm`](https://www.npmjs.com/package/@pnpm/wasm), unchanged (MIT; see
`LICENSE` and `THIRD-PARTY-NOTICES.md`). It imports three host modules besides
WASI; `host/pnpm-host.mjs` implements them on top of slicc-kernel, which loads it
through `slicc.commands.<name>.imports`:

- `pnpm_host`: HTTP through the kernel's network transport (browser `fetch`,
  so registries must allow CORS, as registry.npmjs.org does). Uploads, lifecycle
  scripts and interactive prompts are not supported yet.
- `pnpm_fs`: exclusive creation with a mode, no-follow opens, `fchmod`, modes,
  advisory locks and private lock directories, over the kernel's filesystem.
- `pnpm_atomic`: atomic waits.

OPFS has no hard links and keeps symlinks only in slicc-kernel's metadata, so
the package defaults to `node-linker=hoisted`, `package-import-method=copy` and
`ignore-scripts=true` (as `PNPM_CONFIG_*` variables in `slicc.env`).
