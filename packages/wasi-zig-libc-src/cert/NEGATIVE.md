# Negative proof (wasi-zig-libc-src)

**Date:** 2026-10-17 (0.16.0-16, the first release from its own recipe, #876).

**Supply chain.** 0.16.0-15 on npm was staged by `packages/wasi-zig/build-llvm.sh`
on a laptop. It has no provenance and no gitHead, and there was no recipe, so
cert-review's root rule can't verify it ("unverifiable input"). 0.16.0-16
comes from this recipe: the zig 0.16.0 source tarball by sha256, with no stage
or prebuilt path. Its root is attested once ladder-build publishes it.

**Behaviour.** The local build's `lib/` matches 0.16.0-15's byte for byte (per-file sha256).
The only difference is `package.json` (version, repository directory, homepage, `homescoop.recipe`).

**The checks are not vacuous.**
- `test/host-build.mjs` on a copy of the package with one wasi-libc source
  removed (`wasi/libc-top-half/musl/src/errno/strerror.c`) fails:
  `error: sub-compilation of wasi libc.a failed … file_hash FileNotFound`.
  `test/identity.mjs` fails on the same copy (missing files).
- In slicc-kernel, with only @ai-ecoverse/wasi-zig 0.16.0-15 installed,
  `zig cc -target wasm32-wasi -mcpu=generic+simd128` fails at once (rc 1):
  `error: wasi-libc for this target builds from its C sources, which are not installed; install them with: ipk install @ai-ecoverse/wasi-zig-libc-src`.
  With this package beside it, it builds wasi-libc from these sources: 7 min in a laptop kernel, and the program
  prints `simd128 libc 12` with preview1 imports only. That build ran past 45 min on the CI runner (two ladder-pr timeouts),
  so the cert checks the sources on the host instead.
