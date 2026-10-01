# @ai-ecoverse/wasi-cargo

Offline Cargo 0.84 prototype for SLICC's WASI realm. It uses the installed
`@ai-ecoverse/wasi-rustc` driver, targets `wasm32-wasip1`, and supports
`cargo build --offline` of workspaces with path dependencies. Registry fetching
and Git dependencies are not yet enabled.

The package sets `CARGO_BUILD_JOBS=1` because WASI std cannot query host CPU
parallelism. It disables incremental compilation because the realm filesystem
does not provide the file locks rustc requires. It also sets
`CARGO_BUILD_TARGET=wasm32-wasip1`.

Rust 1.83's WASI-hosted `rustc -vV` prints metadata and then panics while
looking up a native dynamic library path. `bin/rustc-for-cargo` supplies that
metadata from `rustc --version`; it delegates every compilation call to the
installed rustc driver. Remove it when the stable compiler handles `-vV`.

The package sets `CARGO` to its installed Bash driver, which Cargo uses for
subprocesses. Its WASIX Command bridge sends captured child stdin to
`/dev/null`, so rustc probes do not wait on a live terminal.
