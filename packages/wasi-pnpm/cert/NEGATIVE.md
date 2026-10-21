# Negative proof (wasi-pnpm cert/, homescoop#478, #522)

**Date:** 2026-10-16. `cert/install.mjs` ran on slicc-kernel 1.94.0 with users enforce (macOS arm64 builds, `--soft`). On 12.9.1-9 every case passes, in 43 s.

## 12.9.1-8 (no 0002): build paths in pnpm.wasm (#522)

On the published 12.9.1-8, every behaviour case passes, and the build-path check fails:

```text
install.mjs:121    pnpm.wasm contains a build path ("/home/runner")
install.mjs:121#3  pnpm.wasm contains a build path ("homescoop-work/pnpm-")
```

It carries pnpm-cli's `CARGO_MANIFEST_DIR`, `/home/runner/work/_temp/homescoop-work/pnpm-5dafb098…/pnpm/crates/cli`. It also carries 7 `/home/runner/.cargo/registry/…/tree-sitter-0.26.9/…` paths, the `__FILE__` of tree-sitter's C asserts. 12.9.1-9 has neither: 0002 removes the first, and `TARGET_CFLAGS=-ffile-prefix-map=…` remaps the second. A local build has 561 `/cargo/registry/…` paths and no host path, and `build.sh`'s new strings check refuses any that comes back.

## Without 0001 (parking_lot_core's `nightly` feature)

A build of the same tree without 0001 links the panicking wasm parker. The cert fails at the 0001 check:

```text
install.mjs:122  pnpm.wasm links parking_lot_core's panicking wasm parker (0001 missing)
```

The installs alone don't catch it. In this harness, the spec's three 30-package installs never made a lock park, and neither did a stress run of three 200-package installs with 8 files each and 0–40 ms of registry latency per response. All of them passed without 0001. So 0001's runtime trap (the original reason for the patch) stays covered by the string check and by build.sh.

That build also showed that build.sh's old parker check, `strings … | grep -q …` under `set -o pipefail`, never fired. grep's early exit kills `strings` with SIGPIPE, and the pipeline then reads as "no match". The build without 0001 passed the check (`old-guard-MISSED`). The check now greps to `/dev/null` and catches it.

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package wasi-pnpm` fails at the first `pnpm --version`.

## 12.9.1-10: function names for a trap (2026-10-18)

The published 12.9.1-9 against 12.9.1-10's `install.mjs` (slicc-kernel 1.94.0, users enforce, `--soft`): **FAIL, 10 of 52 assertions.** There is no `bin/pnpm.wasm.names`, and pnpm.wasm has a `name` section of generated names only (`f4998` for function 5000: build.mjs's wasm2wat `--generate-names --no-debug-names` / wat2wasm `--debug-names` round trip). Under `SLICC_WASM_BACKTRACE=1`, SLICC then names no frame: the kernel reads a sidecar only for a module without a name section. That is why bios's `pnpm: wasm trap in thread 4: memory access out of bounds` named nothing.

A local 12.9.1-10-style build (same tree; macOS, so not byte-identical to CI's) passes. names.py found 32445 function names, plus the 2 imports, and checked that the exports `_start`, `malloc`, `free`, `wasi_thread_start` and `__wasm_init_tls` carry their own names at their instrumented indices.

## 12.9.1-11: no half-there packages during an update (homescoop#1128, 2026-10-18)

The published 12.9.1-10 against 12.9.1-11's `cert/update-readers.mjs` (slicc-kernel 1.124.2, users enforce, `--soft`, slicc-heavy): **FAIL.** The observations:
- `big 240 1.0.0` 665 times, `big 260 2.0.0` 7 times and `big torn` once (a sample that raced the rename, allowed);
- **`big` half there 30 times, with 0 to 234 files in lib/ and package.json still present:** upstream's stage_and_swap deletes the old tree file by file before the new one is renamed in;
- `fresh absent` 470 times and `fresh 200 1.0.0` 73 times;
- **`fresh` half there 160 times, with 0 to 200 files and no package.json:** a new package is populated in place.

A sample reads package.json, lists lib/, then reads package.json again. If the two reads disagree or the directory has gone, it counts as `torn` (the reader raced a rename). Otherwise a wrong file count, or a missing package.json, counts as half there. The spec also measures the kernel's own directory rename first: 10 plain `mv`s of a 240-file directory under the same poller. slicc-kernel moves a directory in one step where the browser can (FileSystemHandle.move), and otherwise copies it, which a reader can see half done. That window is the kernel's, and pnpm may add none: a package may be seen half there at most `ceil(mvHalf/10 × 3) + 2` times. The `+ 2` is for the kernel's directory rename, #1212 (slicc-kernel#1122): Chrome 156 OPFS has no directory `move()`, so the kernel copies the tree file by file, and a sample can land mid-copy even when the baseline caught none. CI's mv baseline was 0 of 240, yet 12.9.1-11 showed one sample of `big` with 174 of 260 files and no package.json. Locally the baseline was 0 of 296 samples. 12.9.1-10 fails with big half there 37 times and fresh 167.

12.9.1-11's patches/0004 renames the old tree aside, renames the staged one in and only then deletes the old one, and it stages a new package before renaming it into place. The pnpm deps-restorer crate's own unit tests pass with the patch (633 of 633, host `cargo test -p pnpm-deps-restorer --lib`). Upstream's RemoveExisting test (a failing remove_dir_all before the swap) is replaced by one checking that an unremovable old tree no longer fails the swap.

## 12.9.1-12: the process umask and fewer mode calls (2026-10-19)

The published 12.9.1-11 against 12.9.1-12's `cert/modes.mjs` (slicc-kernel 1.124.2, users enforce, `--soft`): **FAIL, 3 assertions.** Under `umask 077`, `node_modules/tool/bin/tool`, `lib/a.js` and `package.json` came out 755, 644 and 644. The host's `pnpm_fs.umask` answered 022 whatever the process had. pnpm computes a copied file's mode from that answer, and its post-copy `fchmod` then widened what the kernel had created under 077.

The same tarball with only 12.9.1-12's `host/pnpm-host.mjs` (the umask read from the kernel, `proc-umask`, once per process) gives 711/600/600 and passes. The 711 is pnpm's bin linking adding `+x`. patches/0005 (the lookups the KC's trace counted: the shard mode once per directory, no per-file `fstat`/`fchmod` once the kernel is seen to apply creation modes) must give the same modes, which the -12 build is certified on.

## 12.9.1-13: 0004 dropped (homescoop#1127's loop, 2026-10-19)

Not a negative proof but the reason for this release. pnpm-agent-loop run 39181721981 ran 12.9.1-11 on slicc-kernel 1.124.2: bios's agent lockfile, 8 shards of 40 rounds each, under users enforce. **41 of the 160 rounds that reported failed**, every one with `failed to rename staging directory "…/node_modules/openai_pacquet-stage_…" to "…/node_modules/openai": Operation timed out (os error 73)`. There were no wasm traps. On this kernel and Chrome 156 OPFS, a directory rename is a file-by-file copy (slicc-kernel#1122, partly addressed in 1.126.1), and for openai's tree the synchronous call ran out of time. 12.9.1-10 had no rename there. So 12.9.1-13 drops 0004, keeps 12.9.1-12's umask and mode-call fixes, and moves update-readers.mjs to stress/. homescoop#1128 is open again for a design that needs no directory rename.

## 12.9.1-14: kernel copies and 256 MiB of initial memory (homescoop#1127, 2026-10-19)

- **#1127:** pnpm-agent-loop run 39204855613 ran 12.9.1-13 on kernel 1.124.2 (CI Linux Chromium, users enforce) and got **11 traps in 240 rounds**: `pnpm: wasm trap in thread 3..6: memory access out of bounds`. All were warm-store rounds, on rayon workers in `pnpm_tarball::prefetch::prefetch_cas_paths_blocking`, and each was the first write into a fresh allocation. 12.9.1-13 imports 68 pages (4.3 MiB) of memory and grows it constantly there; 12.9.1-14 imports 4096 pages. The kernel lane is checking the browser side (`--no-sandbox` on Linux, and V8's trap handler). The loop on 12.9.1-14 is the comparison.
- **0006:** there's no behaviour to refuse; this is a speed change. On cert kernel 1.128.0 every install spec copies through `ctx.fs.copyFile`, and modes.mjs and large-package.mjs must hold as on 12.9.1-13. `test/pnpm-host.test.mjs` checks ENOSYS, EEXIST, EXDEV and EINVAL.

## 12.9.1-15: the project directory and the pin (patches/0007, 0008; thr_r75dacjwyi, 2026-10-19)

The published 12.9.1-13 against `cert/project-dir.mjs` (slicc-kernel 1.128.0, users enforce, as root with a `/node_modules`, `--soft`): **FAIL, 6 of 9 assertions.**
- `pnpm add tiny` in `/tmp/empty`, which has no package.json, exits 1 with `ERR_PNPM_PACKAGE_MANIFEST_IO_ERROR … No such file or directory (os error 44)`, and `/tmp/empty/package.json` has no `tiny`. pnpm walked up to `/`, whose `node_modules` is a project marker.
- `pnpm init`, with a registry whose latest pnpm is 99.0.0, pins `packageManager: pnpm@99.0.0` and `devEngines.packageManager: {version: 99.0.0, onFail: download}`. The next `pnpm add tiny` fails with **`ERR_PNPM_UNSUPPORTED_RUNTIME` × This WebContainer runtime cannot install or switch to pnpm v99.0.0**, the live seven's error (there it was 12.14.0).

A local build of 12.9.1-15 (macOS, the same patches) passes all 9. pnpm resolves its own pin, the running 12.9.1, from the default registry whatever `--registry` says, so the spec's stub answers registry.npmjs.org's `/pnpm` too (12.9.1 and 99.0.0). 0007 pins the running pnpm on wasm, and 0008 stops the prefix walk below `/` unless pnpm runs in `/`.

## 12.9.1-17: the initial heap from the measured peak (homescoop#1287, 2026-10-20)

This is a sizing change, so there's no behaviour to refuse. pnpm-agent-loop run 39330831811 (12.9.1-16, kernel 1.124.2, hosted, 120 rounds, 0 traps) recorded pnpm's peak memory with the host's PNPM_SLICC_PEAK_FILE: **280 MiB** on cold-store agent installs, above -16's 256 MiB initial heap, and 96 MiB warm. recipe.yaml now records `wasm: { initial-memory: 320MiB, measured-peak: 280MiB, measured-by: … }`. build.sh links `--initial-memory` from it (recipe-env's WASM_INITIAL_MEMORY) and checks it in pnpm.wasm's import section. scripts/check-threaded-heap.mjs (#1287's guard) checks the linked size against the recipe, and wasi-pnpm leaves its allowlist. 0009's allocator refresh stays as the backstop.

## 12.9.1-18: the hoisted swap, gated on cheap directory renames (homescoop#1128, 2026-10-20)

The published 12.9.1-17 against 12.9.1-18's `cert/update-readers.mjs` (slicc-kernel 1.134.3, users enforce, `--soft`): **FAIL, 1 of 6 assertions.**
- The kernel's mv baseline shows 0 half-there samples in 312, so the kernel moves directories atomically for its readers.
- **`big` was seen half there 25 times** (0–234 files in lib/), against 405 complete 1.0.0 samples and 7 complete 2.0.0 ones. That's upstream's file-by-file delete before the rename.
- `fresh`, a package new to node_modules, was half there 81 times. It's still imported in place in -18 and is only logged.

12.9.1-18's 0010 renames the old tree aside and the new one in where the host's `directory_rename_cheap` says so (slicc-kernel >= 1.134.3 in /proc/version), and keeps upstream's path below that. That's the gate the 12.9.1-11/-12 timeouts called for.

## 12.9.1-19: a project's commands, a pinned project's registry, the notices (2026-10-20)

- **`cert/project-bins.mjs`** (homescoop#1247, #667): 12.9.1-18 (PR #1346's CI tarball) **fails 20 of 24 assertions** on slicc-kernel 1.134.3, users enforce. `npm run`/`pnpm run` in a project with a `file:` dependency exit 1 with "Lifecycle scripts cannot run in slicc yet": the host refused pnpm's re-run of itself (`process.spawn` of `/node_modules/@ai-ecoverse/wasi-pnpm/bin/pnpm.wasm install --verify-deps-before-run-install`). `pnpm exec hello-bin` and `pnpm hello-bin` fail the same way. `npx hello-bin` exits 127 ("not installed"). With -19's host and npx shim on the same pnpm.wasm, it passes.
- **`cert/pinned-registry.mjs`** (homescoop#1256) documents upstream behaviour and passes on -18 too. That's not a fix but the README's "A private registry and the pin", checked: pnpm's own pin resolves from the user's registry settings only (pnpm-config's `build_package_manager_bootstrap` takes the trusted `.npmrc` files and `pnpm_config_*`; the CLI's `--registry` and the project's `.npmrc` don't reach it).
- **Notices** (homescoop#1325): `grep -c tokio THIRD-PARTY-NOTICES.md` is 0 in 12.9.1-18, which ships upstream's Yarn notices only.

## 12.9.1-20: a failed update keeps the old package; node-shebang bins (homescoop#1384, #1441, 2026-10-21)

- **`cert/swap-edges.mjs`:** the published 12.9.1-19 on slicc-kernel 1.132.1 (below 0010's gate) **fails**.
  - The update over a read-only entry exits 1 ("… prior to swap: Permission denied") and leaves `node_modules/big` as `0 1.0.0`: lib/ was deleted, and only package.json and the read-only directory are left.
  - With -20, the update succeeds on 1.132.1 and 1.134.3 alike: the old tree is renamed aside. The aside copy can't be deleted (the read-only entry), so a `big_pacquet-stage_*` sibling holding the old tree stays in node_modules. (This said "with a warning"; there was none, and no later install removed it: homescoop#1532, fixed in 12.9.1-21.)
- **`cert/project-bins.mjs`:** 12.9.1-19 fails both new assertions.
  - `pnpm exec jsbin` says only "could not start: ENOENT".
  - `npx jsbin` gives "/usr/bin/env: bad interpreter" (126).


## 12.9.1-21: a leftover old tree is named and cleaned up (homescoop#1532, 2026-10-21)

The published 12.9.1-20 (npm latest) against 12.9.1-21's `cert/swap-edges.mjs` (slicc-kernel 1.134.3, users enforce, `--soft`, slicc-heavy): **FAIL, 5 of 18 assertions.**
- The update to big@2.0.0 succeeds (`50 2.0.0`), and `node_modules/big_pacquet-stage_1_…_3` is left. stderr is empty: nothing names it (`swap-edges.mjs:83`).
- A second `pnpm install` while it's still read-only says "Already up to date" and nothing else (`:86`).
- After `chmod -R u+w .`, `pnpm install` says "Already up to date" and the sibling is still there (`:93`).
- Hand-made leftovers, `old_pacquet-stage_1_2_3` and `@s/pkg_pacquet-stage_1_2_4`, survive the next install along with the big one (`:105`), and the kept one holding a `node_modules` isn't named (`:106`).

12.9.1-21's 0012 names the leftover on stderr (` WARN  Could not delete the replaced copy of …/node_modules/big (…). It stays at …/node_modules/big_pacquet-stage_…; a later pnpm install removes it once it can be deleted.`), records it in `node_modules/.pacquet-stage-leftovers`, and sweeps the root's and each project's node_modules at the start of every install that touches them, before the "Already up to date" check. pnpm's deps-restorer unit tests pass with it (634 of 634, host `cargo test -p pnpm-deps-restorer --lib`): the existing unremovable-tree test now also checks the record, a sweep that still can't delete (kept, still recorded) and one after the chmod (gone, record dropped); a new one checks unrecorded leftovers in node_modules and a scope directory, the kept one holding a node_modules, and that a record line leaving node_modules (`../…`, `/…`) or without the stage mark is never followed.
