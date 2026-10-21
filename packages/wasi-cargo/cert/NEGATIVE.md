# Negative proof (wasi-cargo)

## 0.99.0-3: the first CI-built release, on wasi-sdk 34 (#876)

**Date:** 2026-10-17. Under the cert lane's toolchain-refresh terms for #876, the NEGATIVE is the supply chain one, and the behaviour must be the same.

**Supply chain.**
- 0.99.0-2 (npm latest) came from a `wasi-rustc-stable.yml` artifact, packed and published by hand. It has no recipe, provenance or gitHead, so cert-review's root rule gives it INCOMPLETE ("unverifiable input").
- 0.99.0-3 comes from this recipe: `rustc-1.98.1-src.tar.xz` by sha256 (Cargo is its `src/tools/cargo`), with every crate from the tarball's `vendor/` (`--locked --offline`), wasi-sdk 34.0 by sha256, and no stage or prebuilt path. At this head, `repack-input.mjs --package wasi-cargo` gives `attested: true`.
- The five crates Cargo patches (git2 0.21.0, home 0.5.12, filetime 0.2.29, tar 0.4.46, jobserver 0.1.34) now come from `vendor/`, not a `curl` of static.crates.io without a hash.

**Same behaviour.**
- `cert/build.mjs` and `cert/users.mjs` pass on 0.99.0-2, with wasi-rustc 1.98.1-4, on slicc-kernel 1.102.6 under users enforce. They are the fixed corpus: a two-crate path workspace with a build.rs (`count=12 triangle=78 by=build.rs`), a fresh rebuild, a rerun-if-changed rebuild (`count=20 triangle=210`), a type error with rc 101, and users enforce cases. ladder-pr runs the same specs on 0.99.0-3. The PR body records both sides.
- **The import set** of 0.99.0-2's `bin/cargo.wasm` (24,626,898 bytes): 44 imports from `wasi_snapshot_preview1`, `env.memory`, `wasi.thread-spawn` and `wasix_32v1.{sock_open, sock_connect, proc_spawn3, proc_join}`. The PR body records 0.99.0-3's size and imports against this. Any new import must be one slicc-kernel implements on the cert pin (1.102.6) and on the kernel-compat floor.

## 0.99.0-4: cargo test, the allocator refresh and the initial heap (homescoop#1043, #1287, 2026-10-20)

- **cargo test:** with the cert's previous `wasi-rustc@1.98.1-4`, `cargo test` in a new project fails on slicc-kernel 1.134.3 with `rust-lld: error: …libstd-d774a4aed4fca25e.rlib(…): undefined symbol: pthread_join` (and `pthread_detach`). With 1.98.1-6, the published cargo 0.99.0-3 passes. The fix is in wasi-rustc 1.98.1-5+, which ships wasi-sdk 34's wasm32-wasip1 libc with its pthread stubs; cargo's part is the cert's rustc pin and the README.
- **Doc tests** (not a regression): `cargo test` on a library runs rustdoc after the unit tests, and fails with "could not execute process `rustdoc`" because rustdoc isn't packaged. The README says to pass `--lib`/`--tests` or set `doctest = false`.
- **#1287:** the published 0.99.0-3 gives 0 traps in the 4 builds and peaks at 52 MiB, so the row is a guard and the initial heap is sized from it.

## 0.99.0-5: no rustdoc (homescoop#1463, 2026-10-21)

The published 0.99.0-4 runs `cargo test` on a library with a doc test (wasi-rustc 1.98.1-6/-8): the unit test passes, then `could not execute process \`rustdoc …\` (never executed) … No such file or directory (os error 44)`, exit 101. `cargo test --doc` and `cargo doc` fail the same way, without saying that rustdoc isn't packaged. Packaging rustdoc (an optional wasi-rustdoc from the rustc tree) is filed as an unscheduled enhancement.


## 0.99.0-6: cargo rustdoc without rustdoc (homescoop#1540, 2026-10-21)

The published 0.99.0-5 covers `cargo doc`, `cargo test --doc` and `cargo test`, but `cargo rustdoc --offline` in a `cargo new --lib` crate still fails with `could not execute process \`rustdoc …\` (never executed)` … `No such file or directory (os error 44)`, rc 101, without saying that rustdoc isn't packaged (0.99.0-4 fails the same way, so it isn't a regression). The new cert/test.mjs row expects "cargo rustdoc needs rustdoc: rustdoc isn't available in slicc" and no os error 44, so 0.99.0-5 fails it. doc, rustdoc and test are the only cargo subcommands that run rustdoc (src/bin/cargo/commands at 797e8a9bc).
