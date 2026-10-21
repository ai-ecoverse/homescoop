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
  - The same std bitcode (`.llvmbc` extracted from -6's rlibs) links natively with LLVM 21's llvm-link, so the root cause is in the wasm-hosted LLVM. -7's first CI build printed it: `failed to load bitcode of module "adler2-…": Unknown attribute kind (105) (Producer: 'LLVM22.1.8-rust-1.98.1-stable' Reader: 'LLVM 21.1.8')`. std was compiled by the stage rustc with Rust's in-tree LLVM 22, and rustc.wasm links wasi-llvm 21. `-C lto=thin` stayed silent, because ThinLTO's error comes from a worker thread. 0017 refuses fat and thin LTO on the main thread before codegen, naming the reason. A wasi-llvm 22 would make LTO work.
- **Dependencies:** `slicc.dependencies` is `["@ai-ecoverse/wasm-clang"]`.

## 1.98.1-8: the malloc refresh and the initial heap (homescoop#1287, 2026-10-21)

There's no published negative for the trap: the race (slicc-kernel#1172) didn't show in the row with 1.98.1-7, and it hits 5–12% of rounds only under heavier allocation (azw9's canary, wasi-pnpm's loop). The row is a guard. Its measurement is new: rustc.wasm's VmSize stays at its 11.5 MiB initial memory, because the main thread only waits while rustc works on a spawned thread, so the peak comes from `HOMESCOOP_WASM_PEAK` in the allocating thread. The first -8 CI build gave hello world 161 MiB, a 400-function `-O` 281 MiB, and a 1500-function one 675 MiB debug and 1.7 GB at `-O`. Hence 192 MiB, for small compiles; bigger ones grow under the refresh.

## 1.98.1-9: a failed link cleans up; LTO on an rlib (homescoop#1439, #1464, 2026-10-21)

The published 1.98.1-8 against -9's `cert/hygiene.mjs` (slicc-kernel 1.134.3, users enforce): **FAIL, 3 of 18 assertions.**
- **A failed link:** a link that fails on an undefined extern leaves `link.*.rcgu.o` (×2) and a `rustcXXXXXX` dir. 0016 raised the link failure as fatal, and on WASI 0015's fatal exit skips link_binary's cleanup.
- **LTO on an rlib:** `rustc -C lto=fat --crate-type rlib lib.rs` exits 1 with 0017's refusal (on -6 it built), and leaves an `rmetaXXXXXX` dir.

0018 reports the link failure as a plain error, so link_binary cleans up before the driver aborts, and 0017 now refuses only crate types that link upstream bitcode (bin, dylib, cdylib, staticlib).


## 1.98.1-10: a refused -C lto with an rlib among the crate types cleans up (homescoop#1543, 2026-10-21)

The published 1.98.1-9 against -10's `cert/hygiene.mjs` (slicc-kernel 1.134.3, users enforce): **FAIL, 1 assertion.** `rustc --crate-type rlib,cdylib -C lto=fat --crate-name lt lib.rs` exits 1 with 0017's refusal (both pass), but `ls -A` shows `lib.rs rmetaKqZb8B`. With an rlib among the crate types, metadata is encoded into an `rmetaXXXXXX` temp dir in the output directory before codegen starts, and 0017's refusal came at the start of codegen; on WASI, 0015's fatal exit skips the temp dir's drop.

0019 moves the refusal (same condition, same message) from `start_async_codegen` to `start_codegen`, before `encode_and_write_metadata`, so a refused build has written nothing. It applies only when codegen runs, as before (`--emit metadata` and `-Z no-codegen` aren't refused).
