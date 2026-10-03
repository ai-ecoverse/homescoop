# @ai-ecoverse/wasi-cargo

Cargo 0.99 (Rust 1.98.1) for SLICC's WASI realm. It uses the installed
`@ai-ecoverse/wasi-rustc` driver and targets `wasm32-wasip1`.

- **Registry access.** crates.io dependencies come through the realm's HTTP
  proxy, the one `https_proxy` names, over the sparse index. The proxy does
  TLS, so Cargo needs none. Index files and crates are fetched over 6
  connections at once (`CARGO_HTTP_MAX_CONNECTIONS` changes the count). Without
  a proxy, use `--offline` with vendored or path dependencies.
- **Proc macros.** Derives such as serde, clap and thiserror need wasi-rustc
  1.98.1-1 or later, which runs proc macros as child processes.
- **Unsupported on WASI.** Git dependencies need a git network transport,
  and they fail with a message that names the realm.
- **Untested.** `cargo search`, `publish`, `login`, `owner` and `yank` use
  the same proxy client.

The package sets `CARGO_BUILD_JOBS=1` because WASI std cannot query host CPU
parallelism. It disables incremental compilation because the realm filesystem
does not provide the file locks rustc requires. It also sets
`CARGO_BUILD_TARGET=wasm32-wasip1`.

Cargo runs the installed `@ai-ecoverse/wasi-rustc` driver found on `PATH`.
It needs wasi-rustc 1.98.1 or later: the 1.83 compiler panicked on
`rustc -vV`, which Cargo runs to probe the compiler.

The package sets `CARGO` to its installed Bash driver, which Cargo uses for
subprocesses. Its WASIX Command bridge sends captured child stdin to
`/dev/null`, so rustc probes do not wait on a live terminal.
