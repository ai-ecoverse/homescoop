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

## 0.16.0-17: LLVM Support's notices (homescoop#1046 inherited, 2026-10-19)

The published 0.16.0-16 against `test/notices.mjs`: **FAIL.** zig.wasm carries LLVM Support code, but THIRD-PARTY-NOTICES.md names none of Henry Spencer's regex, BLAKE3 or xxHash. 0.16.0-17 pins wasi-llvm 21.1.8-2 (the same libraries, plus share/licenses/llvm-support) and adds them through `homescoop_notice_llvm_support`.

## 0.16.0-18: @cImport, translate-c, C++ without -fno-exceptions (homescoop#1061, #1062, 2026-10-20)

The published 0.16.0-17 against -18's `cert/cimport.mjs` (slicc-kernel 1.134.3, users enforce): **FAIL, 12 of 22 assertions.**
- **@cImport and translate-c:** `zig build-exe ci.zig -lc` and `zig translate-c api.h` both exit 1 with `error: unable to find self exe path: OperationUnsupported`, from jitCmdInner's `executablePathAlloc`, which 0003 didn't cover.
- **C++:** `zig c++ -O2 e.cpp` fails with `wasm-ld: error: …e.o: undefined symbol: __cxa_allocate_exception` / `__cxa_throw`.

homescoop#1060 (the prebuilt archives' DWARF paths) was fixed by c56dc1ed, which builds the prebuilt runtimes at one fixed path. `reproducible (wasi-zig)` passed on #1234 (0.16.0-17).

## 0.16.0-19: the malloc refresh and the initial heap (homescoop#1287, 2026-10-20)

There's no published negative for the trap: the race (slicc-kernel#1172) didn't show in this row's rounds with 0.16.0-17/-18, and it hits 5–12% of rounds only under heavier allocation (azw9's canary, wasi-pnpm's loop). The row is a guard. Its measurement is new: `HOMESCOOP_WASM_PEAK` comes from the allocating thread, because zig's main-thread VmSize can be a stale view. A first -19 with a 256 MiB initial heap gave a 73 MiB malloc peak, with zig's 57 MiB of data and stack below it, hence 96 MiB.

## 0.16.0-20: the README on exceptions (homescoop#1428, 2026-10-21)

A docs fix: zig.wasm is unchanged. 0.16.0-18/-19's README said that with the `-fno-exceptions` default, "code that throws aborts instead". In fact `throw`/`try` in user code doesn't compile ("cannot use 'throw' with exceptions disabled"), and only exceptions thrown inside libc++ abort at run time. The new rows in `cert/cimport.mjs` check both behaviours, which 0.16.0-19 already has, so the README now says what they check.

