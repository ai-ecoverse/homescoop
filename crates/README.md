# Shared crates for Rust packages in slicc's kernel

Rust std for `wasm32-wasip1` stubs `TcpStream::connect`, `TcpListener::bind`
and `std::process::Command`. slicc's kernel implements the WASIX calls behind
them: sockets on its loopback network, `proc_spawn3` / `proc_join` /
`fd_pipe`. Its proxy at `https_proxy` takes absolute-form HTTP and does the
TLS. These crates give every Rust package that, so none of them has to
re-implement raw WASIX imports.

| crate | what | on other targets |
| --- | --- | --- |
| `wasix-net` | `TcpStream`, `TcpListener`, `ToSocketAddrs`, `resolve` over WASIX sockets; `http`, a blocking HTTP/1.1 client (proxy from the environment with `no_proxy`, chunked and length bodies, redirects, keep-alive, timeouts, `json` feature) | std's sockets; the client runs over them |
| `wasix-command` | `Command`, `Child`, `Stdio`, `ExitStatus`, `Output`: args, env, cwd, stdio inherited / piped / null / from a file, `spawn`, `output`, `status`, `wait`, `try_wait`, `kill`; a dropped `Child` keeps running | `std::process` |
| `wasix-ureq` | the part of ureq 2.12's API that impeccable uses, over `wasix_net::http`; its library is named `ureq` | (WASI only; use ureq) |
| `wasix-selftest` | checks all three in the kernel (`test/kernel`) | runs over std |

WASIX code is compiled for `target_os = "wasi", target_env = "p1"`
(wasm32-wasip1 and wasm32-wasip1-threads). Everywhere else the types are
std's, so a call site needs no cfg: change the import
(`use wasix_command::Command;`) and keep to the API both have.

Things to know:
- There is no TLS. `https://` goes through the kernel's proxy in absolute
  form; without a proxy it is an error.
- The kernel's proxy refuses the realm's own loopback, and its `no_proxy`
  (`localhost,.localhost,127.0.0.1,127.0.0.0/8`) sends loopback directly to
  the kernel's sockets, which the client honours.
- A WASI program finds its working directory in `PWD`. wasix-command sets it
  for `current_dir`, but Rust std's `current_dir()` in a plain wasip1 child
  reports `/`, because it comes from wasi-libc.
- wasix-command never imports `fd_fdflags_set`. The kernel then treats every
  descriptor above 2 as close-on-exec, as std's are on unix.

## Using them in a recipe

`build.sh` copies the crates into the source tree before patching:

```bash
homescoop_vendor_crates "$SRC_DIR" wasix-ureq wasix-command   # + their path deps
homescoop_apply_patches "$SRC_DIR"
```

The package's patch then adds them as path dependencies in
`homescoop-crates/`. ureq goes under a target, and `wasix-ureq` sits next to
it under its own name. Cargo refuses a `ureq = { package = … }` rename next
to the real ureq, and needs none: the library is called `ureq`.

```toml
[dependencies]
wasix-command = { path = "../../homescoop-crates/wasix-command" }   # std's natively

[target.'cfg(not(target_os = "wasi"))'.dependencies]
ureq = { version = "2", default-features = false, features = ["tls", "json"] }

[target.'cfg(target_os = "wasi")'.dependencies]
wasix-ureq = { path = "../../homescoop-crates/wasix-ureq", features = ["json"] }
```

`test/consumer` is such a package, and `test/consumer-smoke.sh` vendors and
builds it.

## Tests

```bash
cargo test                                         # host: parser, proxy rules, local servers
cargo build --release -p wasix-selftest --target wasm32-wasip1
cd test && npm ci && npm test                      # the self-test in slicc-kernel's Node entry
test/consumer-smoke.sh                             # vendoring and the ureq swap
```

The kernel tests use the published `@ai-ecoverse/slicc-kernel`, pinned to
the certified version, through its headless Node entry. They cover:
- HTTP through the proxy to a local server, with a transport that maps
  `https://origin.test` to it;
- TCP and HTTP between a process and its child over loopback;
- spawn with pipes, exit codes, `kill`, and a detached child.

`WASIX_SELFTEST_WASM` picks another build (CI runs both targets).
