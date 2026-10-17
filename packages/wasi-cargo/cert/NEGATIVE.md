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
