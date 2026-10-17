# Negative proof (wasi-zig)

## 0.16.0-16: the first CI-built release, on wasi-llvm and wasi-sdk 34 (#876)

**Date:** 2026-10-17. Under the cert lane's toolchain-refresh terms for #876, the NEGATIVE is the supply-chain one, and the behaviour must be the same.

**Supply chain.**
- 0.16.0-15 (npm latest) was built by `build-llvm.sh` on a laptop. It took a `wasi-llvm.yml` artifact and an unpinned host zig, and the recipe was `builder: retired`. It has no provenance or gitHead, so cert-review's root rule gives it INCOMPLETE ("unverifiable input").
- 0.16.0-16 comes from this recipe, with no stage or prebuilt path:
  - zig 0.16.0's source by sha256;
  - the host zig 0.16.0 from ziglang.org by sha256 per host;
  - the published, attested `@ai-ecoverse/wasi-llvm` 21.1.8-1 by sha256;
  - wasi-sdk 34.0 by sha256.

  At this head, `repack-input.mjs --package wasi-zig` gives `attested: true`.
- `build-llvm.sh` and the no-LLVM `build.sh` (the -11 path) are gone, so the ladder can't republish either. wasi-zig-libc-src has its own recipe (#936).

**Same behaviour (the fixed corpus, `cert/corpus.mjs`).** On 0.16.0-15, slicc-kernel 1.102.6, users enforce, it passes in 39 s:

| program | 0.16.0-15 size (bytes) | output |
|---|---|---|
| `zig build-exe hello.zig -OReleaseSmall` | 47,550 | `hello from zig` |
| `zig cc -O2 hello.c` | 944,073 | `hello from zig cc, argc=2 len=5`, rc 3 |
| `zig c++ -O2 hello.cpp` | 3,597,970 | `sum=55` |
| `zig build -Doptimize=ReleaseSafe` (build.zig) | 1,004,960 | `triangle=78`; `zig build test` passes |

A u8 overflow is a compile error (rc 1). Every program has no start section, exports `_start` and imports only `wasi_snapshot_preview1`. `cert/users.mjs` passes on 0.16.0-15 too. ladder-pr runs both specs on 0.16.0-16; the PR body records its sizes and import sets.

**The tool's import set** (`test/imports.mjs`): 0.16.0-15's `zig.wasm` (90,693,545 bytes) has 41 imports: preview1, `env.memory`, `wasi.thread-spawn` and `wasix_32v1.{proc_signal, proc_join, proc_spawn3, fd_pipe, proc_id}`. The PR body has 0.16.0-16's list and the diff. Any new import must be one slicc-kernel implements on the cert pin and on the kernel-compat floor.

**Known, pre-existing:** a refused source leaves an empty output `.wasm` (#954).
