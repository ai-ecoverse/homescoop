# wasi-rustc SPIKE (path B: LLVM-in-wasm)

Decision (SLICC): **LLVM-in-wasm**, not Weblings CLIF→wasm.

Addendum: **one shared libLLVM** for SLICC (`@ai-ecoverse/wasm-llvm`), not a copy
per compiler. wasm-clang / wasi-rustc / future `zig cc` depend on it.

## Goals (first acceptance)

1. `rustc --version`
2. `rustc hello.rs` → `hello.wasm` runs in SLICC (default `--target wasm32-wasip1`)
3. `-O`, and a crate using `std::fs` / `env` / `process::exit`
4. Link via WASIX spawn of `wasm-ld` from `@ai-ecoverse/wasm-clang`
5. Ship `lib/rustlib/...` (no symlinks). Publish `@ai-ecoverse/wasi-rustc@next`.

Cargo deferred. Shared libLLVM refactor of wasm-clang is **not** in this spike;
keep the rustc build shaped to move onto a PIC side module later.

## Shared libLLVM (target architecture)

```
@ai-ecoverse/wasm-llvm     # libLLVM.wasm — dylink.0, PIC; SLICC loads + resolves GOT/env
        ↑ depends
   wasm-clang / wasi-rustc / zig-cc-bridge   # thin frontends, no bundled LLVM
```

- Build with `LLVM_BUILD_LLVM_DYLIB=ON` / PIC + emscripten/WASIX SIDE_MODULE
  (today’s `build-wasm-llvm.sh` has `LLVM_LINK_LLVM_DYLIB=OFF` and `LLVM_ENABLE_PIC=OFF`).
- First rustc cut may ship a **second** LLVM (rustc’s pin) if majors don’t match;
  migrate when a shared major exists or when rustc catches tip-of-tree 24.

## LLVM major mismatch (do not force)

| Consumer | LLVM major | Notes |
|---|---|---|
| **wasm-clang** (`@ai-ecoverse/wasm-clang` 24.0.0-9) | **24.0.0git** | slicc-emscripten llvm-project |
| **rustc stable 1.98.1** (current) | **22** | in-tree `src/llvm-project` |
| rustc 1.91.0 | 21 | “Update to LLVM 21” |
| **this spike** (oligamiq rustc 1.83.0-dev) | **19.1.x** | matches rustc 1.83.0 pin |

rustc **does** accept an external LLVM via `[target.*.llvm-config]` /
bootstrap `llvm-config`, and generally supports the in-tree major plus ~1–2
preceding (tip-of-tree sometimes). **LLVM 24 is not a match** for stable
1.98.1 (22) or this spike (19). **Report: use a second LLVM for the first cut;**
do not force wasm-clang’s 24 into rustc.

## wasm-clang size → shared-LLVM win

Measured on local slicc-emscripten `build/llvm-wasm` + staged package (2026-10-01):

| Piece | Size |
|---|---|
| Static `libLLVM*.a` (76 archives) | **100.2 MiB** |
| Static `libclang*.a` | 90.8 MiB |
| Static `liblld*.a` | 9.6 MiB |
| **LLVM fraction of LLVM+clang+lld archives** | **50%** |
| Shipped `*.wasm` sum | **117.6 MiB** (clang 64.6 + lld 35.2 + llvm-* tools 17.8) |
| Package tree | ~128 MiB |

Each tool **statically** embeds LLVM (`LLVM_LINK_LLVM_DYLIB=OFF`). If one shared
libLLVM ≈ the LLVM portion of the largest tool, rough upper-bound save vs
today’s wasm sum: **~45% (~53 MiB)** of shipped tool wasm (clang stays; lld +
thin tools drop duplicated LLVM). Exact PIC side-module size TBD when
`wasm-llvm` is built.

## Spike cut numbers (published)

`@ai-ecoverse/wasi-rustc@1.83.0-0` (`next` + `latest` — first publish).
Staged: `slicc-emscripten/tmp-wasi/staging/wasi-rustc`.

| Item | Value |
|---|---|
| `bin/rustc.wasm` | 91 MB (**LLVM statically linked** in this oligamiq cut) |
| `lib/rustlib/wasm32-wasip1` | 71 MB |
| package / npm tgz | 162 MB / 54 MB |
| `rustc --version` | 0.63s, ~789 MB RSS (wasmer `--enable-threads`) |
| `rustc hello.rs` | 0.68s, ~903 MB RSS → 246 KB wasm |
| `rustc -O` stdhello (fs/env/exit) | 0.68s, ~888 MB RSS → 255 KB wasm |

oligamiq also ships `llvm_opt.wasm` (93 MB) — separate LLVM **opt** tool; **not**
required for rustc codegen in this build. Peak RSS ≫ 200 MB; module size OK.

**Shape for later shared libLLVM:** next in-tree `x.py` build should prefer
linking `rustc_llvm` against a **PIC libLLVM.wasm** (dylink side module) when
that is not much harder than static — even if the first module is rustc’s
LLVM 19/22, not clang’s 24. Avoid baking assumptions that LLVM lives inside
`rustc.wasm` forever.

## Linker / defaults (this cut)

- Linker: **rust-lld** bundled (not yet WASIX spawn of wasm-clang `wasm-ld`)
- Default target: `bin/rustc` script injects `--sysroot` + `--target wasm32-wasip1`
- Host: `wasm32-wasip1-threads`; needs wasmer `--enable-threads` or SLICC

## Upstream starting points

| Piece | Repo / branch | Notes |
|---|---|---|
| Host patches | `bjorn3/rust` `compile_rustc_for_wasm16` | host wasip1-threads, codegen llvm |
| Spike binaries | oligamiq/rust_wasm v3.0.0 | rustc 1.83.0-dev + wasip1 sysroot |
| Shared LLVM (later) | `@ai-ecoverse/wasm-llvm` | PIC dylink; not built yet |
| Linker | `@ai-ecoverse/wasm-clang` `wasm-ld` | WASIX spawn; default `-C linker=wasm-ld` |

## Status

- [x] Path B locked; research + size baselines
- [x] Spike cut staged + PRESTAGE + `@next` publish (1.83.0-0)
- [x] Default target via `bin/rustc` driver
- [x] LLVM major mismatch documented (24 ≠ 22 ≠ 19); second LLVM OK for cut 1
- [x] wasm-clang LLVM size fraction measured (~50% of static archives; ~45% dup win)
- [x] Wasi `os.rs` patch: split_paths/join_paths/temp_dir/home_dir/getpid
- [ ] CI rebuild with patch + name section → 1.83.0-2@next (run 36874107734)
- [ ] Prefer PIC libLLVM side module in next `x.py` build (shape only this spike)
- [ ] wasm-ld spawn wiring
- [ ] `@ai-ecoverse/wasm-llvm` package (not this spike)

## SLICC PATH ICE (2026-10-01)

Host std in `rustc.wasm` panics at `os.rs:106` `split_paths` when `PATH` is set.
Patch: `patches/0001-wasi-os-path-env-stubs.patch`. Host std is static → full rebuild required.
The packaging-only 1.83.0-1 driver removes PATH before exec; the default bundled
rust-lld needs no PATH. SLICC still sets PATH for the driver. The patched 1.83.0-2
restores PATH in the compiler child and removes this workaround.
