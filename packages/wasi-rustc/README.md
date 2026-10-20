# @ai-ecoverse/wasi-rustc

`rustc` (LLVM-in-wasm) for **slicc**. Host: `wasm32-wasip1-threads`.
Default compile target: **wasm32-wasip1**.

## Layout

- `bin/rustc` — shell driver (injects `--sysroot` + `--target`, preserves PATH)
- `bin/rustc.wasm` — compiler (wasip1-threads host)
- `lib/rustlib/wasm32-wasip1/` — std/core/alloc + self-contained crt

## Environment

- `RUST_MIN_STACK=16777216` recommended (large LLVM stack)
- no `slicc.dependencies`: rustc links with the LLD inside `rustc.wasm` (since 1.98.1-7 it no longer pulls `@ai-ecoverse/wasm-clang`, homescoop#1087)

## Build (`build.sh`, ladder host build)

`build.sh` builds Rust 1.98.1 from `rustc-1.98.1-src.tar.xz` (sha256-pinned in
`recipe.yaml`; vendored crates, llvm-project and cargo included), so a ladder
build is an attested root (#876). Steps:

- apply `patches/0003-*` … `0017-*` to the Rust tree;
- install the wasi-sdk `scripts/install-wasi-sdk.sh` pins (34.0);
- fetch `@ai-ecoverse/wasi-llvm` (LLVM/clang/lld 21.1.8 static for a
  wasm32-wasip1-threads host) by sha256 (`sources.wasi_llvm`) and check its
  `llvm-config` and libraries;
- syntax-check rustc's LLVM wrapper against it;
- `make-stable-config.py` writes the bootstrap config: host
  `wasm32-wasip1-threads` with wasi-llvm's `llvm-config`, targets
  `wasm32-wasip1` and `wasm32-wasip1-threads`, the in-tree LLVM 22 only for the
  Linux build machine, `remap-debuginfo` so no build path is embedded;
- `x.py install`, then stage `bin/rustc.wasm` (without its `name` section and
  DWARF, `scripts/split-name-section.py`), `bin/rustc` (`rustc-driver.sh`) and
  `lib/rustlib/wasm32-wasip1`.

Linux x86_64 only. Stage0 comes from static.rust-lang.org, checked against
`src/stage0`'s sha256s. `cert/` holds the specs (a compile-and-run corpus,
users enforce) and `test/imports.mjs` (rustc.wasm's import set).

`patches/0003-*` adds WASI host paths and environment support, and
`patches/0004-*` embeds LLD (adding `LLVMDTLTO` only from LLVM 22) and
configures an in-tree LLVM for the WASI host. `patches/0005-*` through
`0009-*` port the in-tree LLVM 22 to the threaded WASI host; wasi-llvm carries
the same guards for 21.
`patches/0010-*` replaces `libloading` with a load error on WASI, which has no
`dlopen`: codegen-backend dylibs and libEnzyme do not load.
`patches/0011-*` skips rustc's output-writeable check on WASI: preview1 has no
permission bits, so std reports every existing file as read-only.
`rustc.wasm` itself links through wasi-sdk `clang++` with
`-Clink-self-contained=no`, libc++abi and wasi-emulated-mman, since this build
does not ship the self-contained `rust-lld`.

### Function names (`names/package`)

`build.sh` ships `rustc.wasm` without its `name` section and DWARF
(`scripts/split-name-section.py --strip-debug`): about 117 MB instead of
170 MB to store and load. The names go to the optional
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

`packages/wasi-cargo/make-proc-macro-fixture.sh` builds the offline acceptance workspace:
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

## Cargo

Cargo 0.99 is its own recipe, `packages/wasi-cargo`, built from the same
source tarball with these patches applied to its stage1 std.
