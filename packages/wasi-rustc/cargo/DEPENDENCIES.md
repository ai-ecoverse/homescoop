# Cargo native dependencies: offline WASI baseline

Pinned source: `oligamiq/rust` `8e18c3f`, Cargo submodule `90de6d2`
(Cargo 0.84, Rust 1.83 era). This fork is the first usable baseline while the
static Rust 1.98 compiler is built. Cargo 0.99 from Rust 1.98 has a newer
compiler requirement and restores native Git and HTTP dependencies, so it
needs a separate port after the compiler is accepted.

| Area | Pinned fork on `wasm32-wasip1-threads` | Offline decision |
| --- | --- | --- |
| libcurl / curl-sys | Cargo and crates-io dependency gated off for WASI | Excluded; registry HTTP unavailable |
| libgit2 / git2-curl / libssh2 | Cargo's native Git dependency gated off for WASI; libssh2 is transitive through libgit2 | Excluded; Git dependencies unavailable |
| OpenSSL / rustls | OpenSSL dependency gated off for WASI; no rustls transport in this fork | Neither linked for offline use |
| SQLite | `rusqlite` with bundled SQLite | Retained for Cargo cache/index state; compiled by wasi-sdk |
| zlib | `flate2` with zlib backend | Retained; compiled by wasi-sdk |
| Jobserver | Fork has a WASI implementation in `crates/jobserver/src/wasi.rs` | Retained; assess behavior during the two-crate build |
| Process spawning | Fork's `rustc_runner` imports a private `extend_imports.wasm_run`; WASI std `Command::spawn` is unsupported | Replaced at Cargo's `ProcessBuilder` boundary with the generic `wasix-command` bridge for argv, env, cwd, stdio and exit code |
| Registry fetch | Fork's `fetch` crate imports a private `extend_imports.fetch_open` | Stubbed for the offline build so the wasm module loads in SLICC; later replace with realm proxy transport |

`--no-default-features` alone does not eliminate all native dependencies from
upstream Cargo: curl, Git and SQLite are direct dependencies. The pinned fork
already applies target cfg gates for curl/Git/OpenSSL. The first acceptance
uses only a path dependency and `cargo build --offline` under SLICC Bash.

The WASIX std alternative uses Wasmer's separate `wasm32-wasmer-wasi` toolchain.
The pinned fork's cfg gates target WASI p1, so that alternative needs a new
compiler/target libstd and a dependency cfg audit before Cargo's standard
`Command` path is usable. The bridge can be removed when that target is
validated against SLICC.
