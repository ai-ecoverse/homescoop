# Negative proof (wasi-biome)

**Date:** 2026-10-09 (2.5.15-1; 2.5.15-2 the same day)

## Patch removed (0001-wasi-cli.patch)

biome_cli does not build for wasm32-wasip1(-threads) without it. With
`cargo check -p biome_cli` (toolchain 1.98.1):

- without `--cfg tokio_unstable`: `error: Only features
  sync,macros,io-util,rt,time are supported on wasm.` (tokio);
- with it, reqwest (pulled in by `biome upgrade`) fails:
  `no method named abort_with_reason found for struct AbortController`,
  `no method named set_cache found for struct RequestInit`;
- biome_cli itself has no daemon transport for a target that is neither
  unix nor windows (service/mod.rs), which service/wasi.rs provides.

## biome_fs temp_dir hunk

The first CI build (run 37937547107, tarball af4e9bbc…, without that hunk)
on slicc-kernel 1.23.0's Node entry: every command, `biome --version`
included, aborts with exit 134:

```text
Source Location: /rustc/48a229ce…/library/std/src/sys/paths/wasi.rs:44:5
Message: not supported by WASI yet
biome: wasm trap: unreachable
```

## PWD hunk

std::env::current_dir() is `/` for a wasi-libc program on slicc-kernel
1.23.0 (checked with a probe: `current_dir=Ok("/")`, `PWD=Ok("/home/app")`).
The working directory the patch takes from PWD is what the unpatched
build would see when PWD is `/`. `cert/checklist.mjs` with `PWD=/` on every
biome run fails at the first project case:

```text
biome check . → 1
× Failed to resolve the configuration from @ai-ecoverse/slicc-shared-web/biome
  Caused by: Could not resolve @ai-ecoverse/slicc-shared-web/biome: module not found
```

## run_server and --watch hunks (2.5.15-2)

Published 2.5.15-1 (CI artifact 111ce5e3…, run 37942614733) does not have
them; Ctrl-C recovers the hang. That build on
slicc-kernel 1.23.0's Node entry: `biome __run_server` printed nothing and
was still running when the 180 s guard stopped it (it starts the file
watcher on a blocking thread, and dropping the tokio runtime waits for it),
and `biome check --watch .` printed nothing in 60 s, not even the first
run. The cert's refusal cases fail on a hang after 60 s.

## Empty wasm

`bin/biome.wasm` replaced with an empty file (what `prove-negative.mjs`
does), `cert/checklist.mjs` on slicc-kernel 1.23.0's Node entry → FAIL
(`CompileError: WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output cases (in-spec)

The checklist asserts exit statuses, file counts, the rules and files
reported, exact formatter output (files and stdin) and the refusal
messages.

## THIRD-PARTY-NOTICES.md names the wrong wasi-sdk (2.5.15-3, homescoop#472)

`cert/notices.mjs` against the published `@ai-ecoverse/wasi-biome@2.5.15-3` on
slicc-kernel 1.23.0:

```text
browser-cert: FAIL packages/wasi-biome/cert/notices.mjs
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+   "## wasi-libc (wasi-sdk-31; Rust's self-contained wasm32-wasip1-threads libc)"
-   "## wasi-libc (wasi-sdk-33; Rust's self-contained wasm32-wasip1-threads libc)"
```

Rust 1.98.1 builds its self-contained wasm32-wasip1-threads libc with
`WASI_SDK_PATH=/tmp/wasi-sdk-33.0-x86_64-linux`. The four licence files are
the same at both tags, so only the heading and the URLs were wrong.
`scripts/check-rust-wasi-sdk.mjs` now checks the table against that
Dockerfile on every build.

## 2.5.15-5: the allocator refresh and the initial heap (homescoop#1287, 2026-10-20)

There's no published negative for the trap: the 2.5.15-4 stress probe (3 × biome check of 400 files and 1 × 3000 files, kernel 1.132.1) didn't trap, and the trap is a V8 race (slicc-kernel#1172) that azw9's canary and wasi-pnpm's loop showed at 5–12% of rounds under heavier allocation. The row fixes 0 traps in 8 rounds and the memory staying within the recorded initial heap. Probes: 400 files peak at 21 MB (VmSize), 3000 files at 98,496 kB, hence 128 MiB.

