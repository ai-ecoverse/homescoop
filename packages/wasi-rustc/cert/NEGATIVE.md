# Negative proof (wasi-rustc)

## 1.98.1-5: the first CI-built release, on wasi-llvm and wasi-sdk 34 (#876)

**Date:** 2026-10-17. Under the cert lane's toolchain-refresh terms for #876, the NEGATIVE is the supply-chain one, and the behaviour must be the same.

**Supply chain.**
- 1.98.1-4 (npm latest) came from a `wasi-rustc-stable.yml` artifact: Rust from a git checkout, linked against a `wasi-llvm.yml` artifact chosen by run id, then packed and published by hand. It has no provenance or gitHead, and the recipe was `builder: retired` with `sha256: skip`. cert-review's root rule gives it INCOMPLETE ("unverifiable input").
- 1.98.1-5 comes from this recipe:
  - `rustc-1.98.1-src.tar.xz` by sha256;
  - the published, attested `@ai-ecoverse/wasi-llvm` 21.1.8-1 by sha256 (`sources.wasi_llvm`);
  - wasi-sdk 34.0 by sha256;
  - stage0 checked against `src/stage0`;
  - no stage or prebuilt path.
  At this head, `repack-input.mjs --package wasi-rustc` gives `attested: true`.

**Same behaviour (the fixed corpus, `cert/corpus.mjs`).** On 1.98.1-4, slicc-kernel 1.102.6, users enforce, it passes:

| program | 1.98.1-4 size (bytes) | output |
|---|---|---|
| hello world | 297,355 | `hello from rustc` |
| -O std::fs/env/process::exit | 310,721 | `args=["a", "b c"]`, `sum=2870 first=400`, rc 7 |
| a crate with a dependency (`--extern greet`) | 271,708 | `hello, slicc!`, `fib(25)=75025` |

It also checks that an out-of-bounds panic reports the index, that a missing source fails with rc 1, and that E0308 fails with rc 1. Every program imports only `wasi_snapshot_preview1` functions. `cert/users.mjs` passes on 1.98.1-4 too. ladder-pr runs both specs on 1.98.1-5; the PR body records its sizes (they may differ: a new clang and LLVM 21 for the host) and its import sets.

**The tool's import set** (`test/imports.mjs`): 1.98.1-4's `rustc.wasm` imports `env.memory`, `wasi.thread-spawn`, `wasix_32v1.fd_pipe`, `wasix_32v1.proc_spawn3` and preview1 (33 imports). The PR body has 1.98.1-5's list and the diff. Any new import must be one slicc-kernel implements on the cert pin (1.102.6) and on the kernel-compat floor.

**Known differences:** `rustc --version` was `rustc 1.98.1-dev` on 1.98.1-4, a git build with the default dev channel. The source tarball sets the stable channel, so 1.98.1-5 may print `rustc 1.98.1 (48a229cea 2026-09-01)`. The corpus accepts both.

## 1.98.1-6: LLVM Support's notices (homescoop#1086, 2026-10-19)

The published 1.98.1-5 against `test/notices.mjs`: **FAIL.** rustc.wasm carries LLVM Support code (its data holds `llvm_regexec() failed to match`; the function names are in wasi-rustc-names), but THIRD-PARTY-NOTICES.md has neither Henry Spencer's regex notice nor BLAKE3's or xxHash's. Those came only with wasi-llvm 21.1.8-2's share/licenses/llvm-support. 1.98.1-6 pins wasi-llvm 21.1.8-2 (same libraries, plus the notices) and adds them through `homescoop_notice_llvm_support`.

## 1.98.1-7: what a compile leaves and says (homescoop#953, #1237, #1087, 2026-10-20)

The published 1.98.1-6 against -7's `cert/hygiene.mjs` (slicc-kernel 1.134.3, users enforce): **FAIL, 7 of 11 assertions.**
- **Leftovers:** a plain `rustc hi.rs -o hi.wasm` leaves `hi.*.rcgu.o` (×2) and a `rustcXXXXXX` dir, and every compile adds more. The cause is 0004's `std::process::exit(status)` straight after the in-process LLD call, which skips link_binary's cleanup and the TempDir drop.
- **LTO:** `-C lto=fat` and `-C lto=thin` exit 1 with nothing on stdout or stderr.
  - `RUSTC_LOG=info` shows fat LTO stopping at `linking "adler2-…rcgu.o"`: `LLVMRustLinkerAdd` failed, and rustc reports that as `LlvmError::LoadBitcode` through the shared emitter, on the main thread inside `catch_fatal_errors`.
  - 0015's WASI `raise` ran the session's finish and exited without draining that emitter. 0016's finish drains it first, so the cause is printed.
  - The same std bitcode (`.llvmbc` extracted from -6's rlibs) links natively with LLVM 21's llvm-link, so the root cause is in the wasm-hosted LLVM. -7's message names it.
- **Dependencies:** `slicc.dependencies` is `["@ai-ecoverse/wasm-clang"]`.

