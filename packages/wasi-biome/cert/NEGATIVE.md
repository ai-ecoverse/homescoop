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
