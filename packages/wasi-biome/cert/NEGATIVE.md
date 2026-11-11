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

## 2.5.15-6: homescoop.patches (homescoop#1347, 2026-10-20)

The published 2.5.15-5's `package.json` lists `homescoop.patches: ["0001-wasi-cli.patch"]`, while its build applied 0001 and 0002. `scripts/check-package-meta.mjs` now compares the list with the recipe's patches, and fails 2.5.15-5's package.json. The binary doesn't change.


## 2.6.3-1: Biome 2.6.3 (Renovate #1934, 2026-11-01)

- **What failed on f1595eff (run 41309172648):** `0001-wasi-cli.patch` did not apply, `Hunk #1 FAILED at 65` in `crates/biome_cli/Cargo.toml`. Biome 2.6 has no `reqwest` in `biome_cli`, takes `self_update` 1.2 (features `github`, `rustls`, `ureq`), and calls `ureq` itself in `commands/upgrade.rs`.
- **The rebase:** the Cargo.toml hunks move `self_update` and `ureq` to the `cfg(not(target_os = "wasi"))` dependencies. `ureq` alone would still compile for wasm (`cargo check`, Rust 1.98.1), so the move is about the graph: the check's fingerprints for `wasm32-wasip1-threads` have no `ureq`, `self_update`, `rustls` or `ring`, and `upgrade_wasi.rs` needs none of them. The other hunks apply unchanged, with offsets. `0002` applies unchanged.
- **No version in the spec:** `checklist.mjs` reads the version from recipe.yaml (`recipeVersion`, `reportsVersion`), so a Renovate bump needs no cert edit (as sqlite3 in homescoop#1791, wasi-uv in homescoop#1920).
- **Negative:** the published 2.5.15-6 fails the new checklist at its first version check, `biome --version names 2.6.3, recipe.yaml's version: Version: 2.5.15` (`browser-cert --spec checklist.mjs`, slicc-kernel 1.134.3).
- **Notices on f55a6eb9 (run 41313728749):** the build stopped in `rust-crate-notices.mjs`, `no licence file in boa_ast 0.22.0 …`. Biome 2.6 links eight boa-dev/boa crates that ship no licence file. `scripts/crate-licences.json` pins the repository's `LICENSE-MIT` for `boa_ast`, `boa_engine`, `boa_gc`, `boa_interner`, `boa_parser`, `boa_string` 0.22.0 (at 337a3668) and `small_btree`, `tag_ptr` 0.1.0 (at ad8739f5), the commits in their `.cargo_vcs_info.json`. They are Unlicense OR MIT, so one text is enough. The `react_compiler` crates also ship none, but they are a git dependency: the repository's LICENSE is found as before.
- **The next crate in line:** `float16` 0.1.7 keeps its texts in a `LICENSES` directory, which matched the licence pattern and failed with `EISDIR` on the same script. `licenceFiles` (`scripts/rust-crate-notices-lib.mjs`) now reads the files inside such a directory. `scripts/test/rust-crate-notices.test.mjs` covers it. Every other crate's output is the same, and `list-touched-packages` names only wasi-biome. On the patched 2.6.3 tree, `rust-crate-notices.mjs` and `check-rust-notices.mjs` pass with 261 crates.
- **Negative:** the published 2.5.15-6 fails `cert/notices.mjs` at the new boa_ast row, as it does not link Boa (`browser-cert --spec notices.mjs`, slicc-kernel 1.134.3).
- **The summary moved to stderr (run 41318176605):** upstream's biomejs/biome#12593, in 2.6.3, prints the default reporter's summary to stderr. `checklist.mjs` read it from stdout and stopped at the clean `biome check .`. The check, ci, format and lint rows now read stderr, and the clean check also expects an empty stdout. Stdin formatting and `stop` stay on stdout. CI's 2.6.3-1 build of 6b145003 passes the whole checklist. The published 2.5.15-6 fails at the version check first; with recipe.yaml's version set to 2.5.15 in a copy of cert/, it fails at `the summary goes to stderr since 2.6.3`, since it prints `Checked 4 files` on stdout (slicc-kernel 1.134.3).

## 2.6.4-2: the working directory, not a stale PWD (2026-11-09)

- **The defect:** 0001 took `PWD` as it was. A parent that sets a child's working directory without rewriting `PWD` (Node's `spawnSync('biome', …, { cwd })`, on real Node too; `@ai-ecoverse/biome-jsh` lints that way) made Biome look for the file in the parent's directory: `/tmp/zz.ts internalError/io … No such file or directory (os error 44)`, then `No files were processed in the specified paths`.
- **What the kernel gives a wasi-libc program** (a Rust `wasm32-wasip1-threads` probe built with 1.98.1, on slicc-kernel 1.134.3 and 1.176.2 alike): `current_dir()` is `/` in every case, `stat(".")` has the real working directory's device and inode, `..` reaches its parent, `/proc/self/cwd` is `ENOENT`, and a spawn without `PWD` gets the kernel's `PWD=<cwd>`. Before any chdir, `stat("/")` is `.`'s (`/` is no preopen, so it reaches the cwd), so `PWD=/` would pass a device and inode check. Dropping the chdir is the old negative above (`extends` does not resolve with `PWD=/`), so 0001 now takes `PWD` only when it is absolute, not `/`, has no `..` and is `.`'s device and inode, and otherwise walks `..` up to the root as getcwd(3) does.
- **Negative:** the published 2.6.4-1 fails `cert/cwd.mjs` at its first case, node's `spawnSync` with `{ cwd }` and `PWD=/tmp` inherited (`browser-cert --spec cwd.mjs`, slicc-kernel 1.176.2). Run to the end, 19 of its 51 assertions fail: `PWD=/tmp` (not found), `/nonexistent`, `sub` and `/` (exit 0 with Biome's defaults: no noFloatingPromises, so the project's configuration was not found), the cwd spelt with `..` (exit 134), and cwd `/` with `PWD` naming the project (that project's file linted). PWD removed and `sh -c` pass on 2.6.4-1 too, since the kernel and the shell reset `PWD`. 2.6.4-2 passes all 51, and the whole cert (checklist, cwd, notices, stress) on slicc-kernel 1.176.2.
- **The cert kernel moves to 1.176.2:** slicc-jsh 0.64.0, whose `node` the case needs, asks for slicc-kernel >=1.172.2.

## 2.6.5-1: grit-pattern-matcher / grit-util 0.5.2 (Renovate #2036, 2026-11-11)

- **What failed on c1f4e983 (run 43039218150):** the notices step in host-build and rebuild threw `no licence file in grit-pattern-matcher 0.5.2 (…), and no scripts/licence-texts/MIT.txt`. Biome 2.6.5 bumps `grit-pattern-matcher` and `grit-util` from 0.5.1 to 0.5.2; both crates still ship no licence file in their crates.io package (same as 0.5.1). The other Cargo.lock changes vs 2.6.4 (`libmimalloc-sys`, `libz-sys`) ship licence files.
- **The pin:** `scripts/crate-licences.json` adds `grit-pattern-matcher 0.5.2` and `grit-util 0.5.2` to getgrit/gritql's `LICENSE` at `b3e9e54f` (the commit in each crate's `.cargo_vcs_info.json`). That text adds `Copyright (c) 2025-present Biome Developers and Contributors.` on top of Iuvo AI; sha256 `dbc45000…`. The 0.5.1 pins stay (commit `0de0cdbe`, Iuvo-only copyright).
- **Negative:** the published 2.6.4-2 fails `cert/notices.mjs` at the new grit-pattern-matcher row (`Copyright (c) 2025-present Biome Developers`), because it still links 0.5.1 whose pinned text has only Iuvo AI (`browser-cert --spec notices.mjs`).
- **Patches / cert version / README:** `0001` and `0002` still apply on 2.6.5; `checklist.mjs` already reads the version from `recipe.yaml`; the README's older packaging lines are packaging revisions or already carry a historical cue the check accepts.
