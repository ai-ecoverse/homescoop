# Negative proof (wasi-zig-libc-src)

**Date:** 2026-10-17 (0.16.0-16, the first release from its own recipe, #876).

**Supply chain.** 0.16.0-15 on npm was staged by `packages/wasi-zig/build-llvm.sh`
on a laptop. It has no provenance and no gitHead, and there was no recipe, so
cert-review's root rule can't verify it ("unverifiable input"). 0.16.0-16
comes from this recipe: the zig 0.16.0 source tarball by sha256, with no stage
or prebuilt path. Its root is attested once ladder-build publishes it.

**Behaviour.** The local build's `lib/` matches 0.16.0-15's byte for byte (per-file sha256).
The only difference is `package.json` (version, repository directory, homepage, `homescoop.recipe`).

**The spec is not vacuous.** `cert/libc.mjs` run without this package (only
@ai-ecoverse/wasi-zig 0.16.0-15 installed) fails on its first case:

```text
error: wasi-libc for this target builds from its C sources, which are not installed; install them with: ipk install @ai-ecoverse/wasi-zig-libc-src
```

With this package beside wasi-zig, the same run passes: `-mcpu=generic+simd128`
builds wasi-libc from these sources and the program prints `simd128 libc 12`.
