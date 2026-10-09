# @ai-ecoverse/wasi-biome

[Biome](https://biomejs.dev) 2.5, the formatter and linter, as a WASI preview1
command for SLICC: `biome`.

```sh
biome check .
biome format --write .
biome lint src
```

`bin/biome.wasm` is Biome's CLI (`biome_cli`) built by homescoop from
biomejs/biome 2.5.15 for `wasm32-wasip1-threads`, with the toolchain Biome
pins. `@biomejs/wasm-web` is a library for a JavaScript host, not a CLI, and
Biome publishes no WASI build.

One patch (`0001-wasi-cli.patch` in the recipe):

- There is no Biome daemon or language server: they need sockets and child
  processes. `start`, `lsp-proxy` and `--use-server` refuse with a message.
- `--watch` needs file system events and refuses with a message.
- `biome upgrade` is not available; upgrade the package instead.
- The working directory comes from `PWD`, as the kernel sets it, so
  `extends` resolves shared configs such as
  `@ai-ecoverse/slicc-shared-web/biome` from the project's `node_modules`.
- The cache directory is `$TMPDIR` or `/tmp` (WASI has no temp dir).

Certified: `check`, `ci`, `format` (files and stdin) and `lint`, including
type-aware rules across files, `.gitignore`, and configuration errors.

2.5.15-1 hangs on `--watch` and `__run_server` (Ctrl-C recovers it);
2.5.15-2 refuses them with a message.

MIT OR Apache-2.0; see `LICENSE`.
