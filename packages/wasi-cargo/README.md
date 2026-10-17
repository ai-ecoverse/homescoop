# wasi-cargo (recipe)

Cargo 0.99 is Rust 1.98.1's own `src/tools/cargo` (rust-lang/cargo `797e8a9`).
`build.sh` takes it from the sha256-pinned `rustc-1.98.1-src.tar.xz` that
`packages/wasi-rustc` builds from, applies `packages/wasi-rustc/patches` to the
Rust tree and builds the stage1 compiler and its wasm32-wasip1-threads std
(`x.py build library --stage 1`), so Cargo links the same patched std as
wasi-rustc's. Cargo is then built for wasm32-wasip1-threads with stage0's
cargo, `--locked --offline` against the tarball's `vendor/`.

- `patches/cargo.patch` is applied, and `wasix-command/` (the WASIX Command bridge) is added.
- `git2`, `home`, `filetime`, `tar` and `jobserver` come from the tarball's
  `vendor/` with one small WASI patch each (`patches/<name>.patch`,
  `[patch.crates-io]` in cargo.patch).
- libgit2 builds with the headers in `wasi-compat/`. Cargo uses it only for
  local repositories, and git fetch fails with a message that names the realm.
- Registry HTTP: on WASI, `util/network/http_async.rs` is a plain HTTP/1.1
  client that talks to the realm proxy (`https_proxy`) with absolute-form
  `https://` targets. The proxy does TLS, so there is no curl or TLS stack.
  It handles chunked or sized bodies and redirects. Requests run on 6
  worker threads, each with a keep-alive connection; set
  `CARGO_HTTP_MAX_CONNECTIONS` to change that, and `http.multiplexing =
  false` means one. With 350 ms of proxy latency per request (the browser's
  fetch path), a cold serde + serde_json + clap 4.6 lockfile takes 4.0 s
  instead of 10.7 s serially, and fetching 28 crates takes 5.4 s instead of
  10.7 s.
- Processes go through `wasix-command/`.
- WASI has no cross-process jobserver, so the jobserver is not handed to
  children.
- File locks are skipped, because WASI std reports them unsupported.

`cert/` builds a path workspace with a build script in slicc-kernel under
users enforce. `DEPENDENCIES.md` is the native-dependency audit from the
Cargo 0.84 groundwork.
