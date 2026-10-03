# @ai-ecoverse/wasi-rustc

`rustc` (LLVM-in-wasm) for **slicc**. Host: `wasm32-wasip1-threads`.
Default compile target: **wasm32-wasip1**.

## Patched cut `1.83.0-2`

- Works: `rustc --version`, `rustc hello.rs` → `hello.wasm`, `-O`,
  `std::fs` / `env` / `process::exit`
- Linker: **rust-lld** (bundled). Next: spawn `wasm-ld` from
  `@ai-ecoverse/wasm-clang` over WASIX (`-C linker=wasm-ld` in target spec).
- PATH reaches rustc.wasm. The host std patch supports PATH splitting, TMPDIR,
  and HOME; bundled rust-lld links quietly.
- Cargo: deferred
- Provenance: the pinned Rust 1.83 fork, built with in-tree `x.py` by
  `.github/workflows/wasi-rustc-patched.yml`, plus two local patches in `patches/`.

## Layout

- `bin/rustc` — shell driver (injects `--sysroot` + `--target`, preserves PATH)
- `bin/rustc.wasm` — compiler (wasip1-threads host)
- `lib/rustlib/wasm32-wasip1/` — std/core/alloc + self-contained crt

## Environment

- `RUST_MIN_STACK=16777216` recommended (large LLVM stack)
- Run dep: `@ai-ecoverse/wasm-clang` (for upcoming wasm-ld spawn)

## Sizes (this cut)

See SPIKE.md / publish report.

## Stage from CI

Download the `wasi-rustc-patched` or `wasi-rustc-stable` artifact, then run
`python3 packages/wasi-rustc/stage-patched.py <artifact.tgz> --expected-version <package-version>`.
The script stages only the compiler and `wasm32-wasip1` rustlib, excluding
the Linux host rustlib and duplicate debug copy. The recipe is
`builder: retired` so ladder-merge does not OIDC-publish the 1.83 spike;
`build.sh` is a refuse stub. Certified cuts come from `wasi-rustc-stable.yml`.

## Rust 1.98.1 static build

`.github/workflows/wasi-rustc-stable.yml` builds Rust 1.98.1 from the pinned
upstream tag. The compiler links the external LLVM 21 from `packages/wasi-llvm`
(the `wasi-llvm` artifact of `.github/workflows/wasi-llvm.yml`, chosen by run
id when the workflow is dispatched); the in-tree LLVM 22 is built only for the
x86_64 build machine. `rustc.wasm` keeps LLVM and LLD inside it.
`make-stable-config.py` generates the bootstrap config from an absolute
wasi-sdk path and, with `--llvm-config`, points the WASI host at the external
LLVM. `patches/0003-*` adds WASI host paths and environment support, and
`patches/0004-*` embeds LLD (adding `LLVMDTLTO` only from LLVM 22) and
configures an in-tree LLVM for the WASI host. `patches/0005-*` through
`0009-*` port the in-tree LLVM 22 to the threaded WASI host; wasi-llvm carries
the same guards for 21.
`patches/0010-*` replaces `libloading` with a load error on WASI, which has no
`dlopen`: proc-macro crates, codegen-backend dylibs and libEnzyme do not load.
`patches/0011-*` skips rustc's output-writeable check on WASI: preview1 has no
permission bits, so std reports every existing file as read-only.
`rustc.wasm` itself links through wasi-sdk `clang++` with
`-Clink-self-contained=no`, libc++abi and wasi-emulated-mman, since this build
does not ship the self-contained `rust-lld`.
The workflow emits `wasi-rustc-stable.tgz` for staging and SLICC acceptance.
Cargo follows acceptance of this compiler; the PIC LLVM side module follows
Cargo.

### Function names (`names/package`)

`stage-patched.py` ships `rustc.wasm` without its `name` section and DWARF
(`scripts/split-name-section.py --strip-debug`): 116.6 MB instead of
169.7 MB to store and load. The names go to the optional
`@ai-ecoverse/wasi-rustc-names` package of the same version, as
`bin/rustc.wasm.names`. Nothing depends on it. With it installed and
`SLICC_WASM_BACKTRACE=1`, SLICC names a compiler trap's frames from it;
without it, frames stay `wasm-function[N]`. The helper checks the split
round-trips byte for byte before staging writes anything.

### Proc macros (`patches/0012-*`)

WASI has no `dlopen`, so a proc-macro crate becomes a program, and the
compiler runs each one as a child process for the whole session. It's the
same RPC as the dylib bridge, carried over a pipe:

- **Linking.** On a WASI target, `--crate-type proc-macro` links as a program
  (`rustc_session` output check, `link_output_kind`, `entry_fn`). The
  proc-macro harness adds `#[rustc_main] fn main()`, which calls
  `proc_macro::bridge::process::serve(_DECLS)`. Crate metadata goes in the wasm
  custom section, as for any wasm dylib.
- **Loading.** On a WASI host, `dlsym_proc_macros` starts the program with
  WASIX `fd_pipe` + `proc_spawn3` (pipes dup2'd onto its stdin and stdout) and
  gets back one client per macro.
- **Running.** The bridge's request and reply buffers travel as frames over
  the pipe. The macro runs in the child, and every call it makes comes back to
  the compiler's dispatcher. Handles stay the compiler's, so spans and hygiene
  are exactly as with a dylib. A client is only a function pointer, so each
  process-backed macro gets a function of its own: 256 slots per session.
- **Panics.** A panic aborts the child (WASI has no unwinding). Its hook sends
  the message first, and the compiler reports `proc-macro derive panicked`
  with that message, then restarts the program on its next use.
- **Stray output.** A macro's own stdout output is passed to stderr.

`cargo/make-proc-macro-fixture.sh` builds the offline acceptance workspace:
serde/serde_json, thiserror, clap derive, and a panicking derive.

Only a compiler that itself runs on WASI accepts `--crate-type proc-macro` for
a WASI target. Other hosts refuse it, as upstream does, so bootstrap's
`-Zdual-proc-macros` doesn't try to build rustc's own proc macros for wasm.

`patches/0013-*`: on WASI, `env::current_dir` is `$PWD` when that names a
directory. wasi-libc starts every process at `/`, while SLICC passes the real
working directory in `PWD`. `set_current_dir` keeps `PWD` current.

`patches/0014-*`: `set_permissions` succeeds without doing anything on WASI,
which has no permission bits (wasi-libc's chmod is ENOSYS). Cargo unpacks
`.crate` files with modes.

`patches/0015-*` covers rustc's normal error exit. A compile error ends with
`FatalError::raise`, which unwinds back to the driver, and under WASI's
panic=abort that would trap. On WASI, `run_compiler` registers a hook that
finishes the session's diagnostics ("aborting due to N previous errors")
and exits with status 1.

## Cargo 0.99 (`cargo-0.99/`)

Cargo 0.99 is Rust 1.98.1's own submodule (rust-lang/cargo `797e8a9`). The
stable workflow builds it right after rustc, with the stage1 compiler, so it
links this recipe's wasm32-wasip1-threads std.

- `prepare.sh` applies `cargo.patch` and adds the WASIX Command bridge.
- `git2`, `home`, `filetime`, `tar` and `jobserver` come from crates.io with one small WASI
  patch each (`[patch.crates-io]`).
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
- Processes go through `cargo/wasix-command`.
- WASI has no cross-process jobserver, so the jobserver is not handed to
  children.
- File locks are skipped, because WASI std reports them unsupported.

## Offline Cargo groundwork

`.github/workflows/wasi-cargo.yml` builds the pinned Cargo 0.84 fork for
`wasm32-wasip1-threads` with Rust 1.83 and wasi-sdk 24. `prepare-cargo.py`
replaces its private `extend_imports.wasm_run` runner with a generic
`cargo/wasix-command` adapter for SLICC's `proc_spawn3`/`proc_join`. The
first Cargo acceptance disables the fork's private HTTP import and uses `--offline`;
registry access will be added over the realm proxy after the path dependency
workspace builds in SLICC. The adapter captures child output through
pre-created files under TMPDIR, preserving argv, environment, cwd, streams,
and exit status without filling a pipe.
The native dependency audit and the offline exclusions are in
[`cargo/DEPENDENCIES.md`](cargo/DEPENDENCIES.md).
