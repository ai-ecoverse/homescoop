# Negative proof (wasi-bat)

## 0.26.1-1

**Date:** 2026-10-25. slicc-kernel 1.167.1 (the browser harness,
`scripts/browser-cert/run.mjs`), `users: enforce`, `cert/*.mjs` against
locally built `package.tgz` files. The real build passes all four specs.
Recorded failures:

- **Empty wasm** (`prove-negative.mjs`): `checklist.mjs`, `notices.mjs` and
  `users.mjs` FAIL (`WebAssembly.compile(): BufferSource argument is
  empty`); `syntax.mjs` FAIL (`bat exited non-zero: rc=126`).

- **Without `patches/console-wasi-winsize.patch`** (console's WASI
  `terminal_size` is `None`, so bat takes 80 columns): `checklist.mjs` FAIL
  on the 60-column pty. The other three specs pass; they don't use a tty.

  ```text
  AssertionError [ERR_ASSERTION]: pty 60: top rule
  + '─────┬──────────────────────────────────────────────────────────────────────────'
  - '─────┬──────────────────────────────────────────────────────'
  ```

- **Without `patches/etcetera-wasi-home.patch`** (`std::env::home_dir()` is
  always `None` on WASI): every bat run, `--version` included, panics
  before it reads anything, so all four specs FAIL.

  ```text
  AssertionError [ERR_ASSERTION]: rc=134 stdout="" stderr="
  thread 'main' (1) panicked at src/bin/bat/directories.rs:51:40:
  Could not get home directory
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
  bat: wasm trap: unreachable
  "
  ```

- **Without `patches/clircle-wasi.patch`**: the build fails, clircle has
  only Unix and Windows implementations.

  ```text
  error: Neither cfg(unix) nor cfg(windows) was true, aborting.
    --> clircle-0.6.1/src/lib.rs:55:9
  error: could not compile `clircle` (lib) due to 1 previous error
  ```

- **Without `patches/bat-wasi-no-builtin-pager.patch`**: the build fails.
  bat's `paging` feature, which its binary needs, pulls in minus and
  crossterm, and crossterm has no WASI backend.

  ```text
  error[E0432]: unresolved import `sys::position`
    --> crossterm-0.27.0/src/cursor.rs:52:9
  error[E0425]: cannot find function `enable_raw_mode` in module `sys`
     --> crossterm-0.27.0/src/terminal.rs:123:10
  error: could not compile `crossterm` (lib) due to 9 previous errors
  ```

- **With the first `patches/etcetera-wasi-home.patch`, which read only
  `$HOME`** (homescoop#1895, b4123c9d's build): `checklist.mjs` and
  `users.mjs` FAIL on the rows without `$HOME`. `env -u HOME bat
  --config-dir` and `HOME= bat t.rs` panic, where native bat falls back to
  the passwd entry. The patch now does the same, from `$USER` or `$LOGNAME`,
  and falls back to `/` without one.

  ```text
  AssertionError [ERR_ASSERTION]: no HOME: rc=134 stdout="" stderr="
  thread 'main' (1) panicked at src/bin/bat/directories.rs:51:40:
  Could not get home directory
  ...
  134 !== 0
  ```

## Wrong-output cases (in-spec)

`cert/checklist.mjs` asserts exact bytes, taken from native bat 0.26.1
(aarch64-apple-darwin, the same .crate and features): the highlighted
output of Rust, a Dockerfile and JSON in two themes, the full style's
header and grid at a given width, `-r`, `-H`, `-A`, and the output and
exit status around a missing file. `cert/syntax.mjs` compares 196 files
with upstream's own expected output. A build with a wrong regex engine, a
missing syntax, a theme change or a wrong width fails them.

## Harness note

On slicc-kernel 1.167.1, a file the spec writes with `ctx.write` after a
process has looked it up and found it missing stays missing for later
processes: `ls` lists it and `ctx.read` reads it, but `cat` (and bat) get
`ENOENT`. A name never looked up before is fine. So the spec writes bat's
config and syntax files through the kernel (`bash -c 'cat > file'`), which
later processes see at once.
